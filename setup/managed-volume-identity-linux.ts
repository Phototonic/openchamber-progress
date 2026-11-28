import {createHash} from 'node:crypto';
import fs, {type BigIntStats} from 'node:fs';
import {posix as path} from 'node:path';
import type {ManagedVolumeIdentityReader,ManagedVolumeTarget} from './managed-volume-identity.ts';

const BTRFS_MAGIC=0x9123683en, SUBVOLUME_ROOT_INODE=256n;
const MOUNTINFO='/proc/self/mountinfo', BTRFS_SYS='/sys/fs/btrfs', BY_ID='/dev/disk/by-id';
const MAX_MOUNT_BYTES=1024*1024, MAX_MOUNTS=8192, MAX_COMPONENTS=64, MAX_PATH_BYTES=4095;
const MAX_FILESYSTEMS=64, MAX_DEVICE_LINKS=4096, PROBE_MS=100;
const uuidPattern=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const blockNamePattern=/^[A-Za-z0-9][A-Za-z0-9_.!+-]{0,127}$/;
const wwnPattern=/^wwn-(0x[0-9a-f]{16}(?:[0-9a-f]{2}){0,8})(?:-part([1-9][0-9]{0,9}))?$/i;
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const unavailable=Symbol();

function need(ok:unknown):asserts ok {if(!ok)throw unavailable;}
function absolute(value:string):boolean {
  return value.startsWith('/')&&!value.includes('\0')&&Buffer.byteLength(value)<=MAX_PATH_BYTES&&
    (value==='/'||value.slice(1).split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
}
function unsigned(value:string):bigint {
  need(/^(?:0|[1-9][0-9]{0,19})$/.test(value));
  const n=BigInt(value);
  need(n<=0xffffffffffffffffn);
  return n;
}
function within(root:string,file:string):boolean {
  return file===root||file.startsWith(root==='/'?'/':`${root}/`);
}
function decode(value:string,option=false):string {
  // Replace each kernel escape once: a literal "\040" in a name stays literal.
  return value.replace(/\\([0-7]{3}|.)?/g,(_match,code:string|undefined)=>{
    switch(code){
      case '011':return '\t';
      case '012':return '\n';
      case '040':return ' ';
      case '134':return '\\';
      case '054':if(option)return ',';
    }
    throw unavailable;
  });
}
function same(a:BigIntStats,b:BigIntStats):boolean {
  return a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
}

/** Bound work between syscalls. A synchronous kernel call cannot be preempted
 * here; the enclosing Setup worker still owns the request/effect deadlines. */
class Probe {
  private readonly until=performance.now()+PROBE_MS;

  check():void {need(performance.now()<this.until);}

  io<T>(call:()=>T):T {
    this.check();
    return call();
  }

  text(file:string,max=256):string {
    const fd=this.io(()=>fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK));
    try{
      const buf=Buffer.allocUnsafe(max+1);
      for(let offset=0;offset<=max;){
        const count=this.io(()=>fs.readSync(fd,buf,offset,buf.length-offset,null));
        if(!count)return utf8.decode(buf.subarray(0,offset));
        offset+=count;
      }
      throw unavailable;
    }finally{fs.closeSync(fd);}
  }

  attr(file:string):string {
    const text=this.text(file);
    need(text.endsWith('\n')&&!text.slice(0,-1).includes('\n'));
    return text.slice(0,-1);
  }

  *entries(dir:string,limit:number):Generator<fs.Dirent> {
    const handle=this.io(()=>fs.opendirSync(dir,{bufferSize:16}));
    try{
      for(let i=0;;i++){
        const entry=this.io(()=>handle.readSync());
        if(!entry)return;
        need(i<limit);
        yield entry;
      }
    }finally{handle.closeSync();}
  }

  lstat(file:string):BigIntStats|undefined {
    return this.io(()=>fs.lstatSync(file,{bigint:true,throwIfNoEntry:false}));
  }

  realpath(file:string):string {
    return this.io(()=>fs.realpathSync.native(file));
  }

  withDirectory<T>(file:string,fn:(fd:number)=>T):T {
    const fd=this.io(()=>fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK));
    try{return fn(fd);}finally{fs.closeSync(fd);}
  }

  directoryMount(fd:number,observed:BigIntStats):string {
    const stat=this.io(()=>fs.fstatSync(fd,{bigint:true}));
    need(stat.isDirectory()&&same(stat,observed));
    const ids=this.text(`/proc/self/fdinfo/${fd}`,1024).split('\n').filter(line=>line.startsWith('mnt_id:'));
    const id=ids.length===1&&/^mnt_id:\s+([1-9][0-9]{0,19})$/.exec(ids[0]);
    need(id);
    return id[1];
  }
}

interface Mount {id:string;root:string;point:string;type:string;source:string;options:string;line:string}

function targetMount(probe:Probe,id:string,target:string):Mount {
  const text=probe.text(MOUNTINFO,MAX_MOUNT_BYTES);
  need(text.endsWith('\n'));
  const seen=new Set<string>(), mounts:Mount[]=[];
  let selected:Mount|undefined;
  for(const line of text.slice(0,-1).split('\n')){
    probe.check();
    need(seen.size<MAX_MOUNTS);
    const fields=line.split(' '), separator=fields.indexOf('-',6);
    need(separator>=6&&fields.length===separator+4&&/^[1-9][0-9]{0,19}$/.test(fields[0])&&!seen.has(fields[0]));
    seen.add(fields[0]);
    const point=decode(fields[4]);
    need(absolute(point));
    if(!within(point,target))continue;
    const mount={id:fields[0],root:decode(fields[3]),point,type:fields[separator+1],
      source:decode(fields[separator+2]),options:fields[separator+3],line};
    if(mount.id===id)selected=mount;
    mounts.push(mount);
  }
  need(selected&&selected.type==='btrfs');
  // A directory mount ID determines the entry; paths only veto ambiguous
  // stacking/intervening mounts, notably an overmount on a regular file.
  for(const mount of mounts)need(mount===selected||!within(selected.point,mount.point));
  return selected;
}

function subvolume(mount:Mount):string {
  const options=mount.options.split(',');
  const ids=options.filter(opt=>opt.startsWith('subvolid='));
  const names=options.filter(opt=>opt.startsWith('subvol='));
  need(ids.length===1&&names.length===1&&!options.some(opt=>
    opt==='subvolid'||opt==='subvol'||opt==='degraded'||opt.startsWith('degraded=')));
  const id=ids[0].slice('subvolid='.length), n=unsigned(id);
  const name=decode(names[0].slice('subvol='.length),true);
  // btrfs reports its enclosing subvolume even for a bind of a subdirectory.
  need((n===5n||n>=256n)&&absolute(name)&&mount.root===name);
  return id;
}

function blockNumber(rdev:bigint):string {
  // Linux gnu_dev_major/minor, including minor numbers beyond eight bits.
  const major=((rdev>>8n)&0xfffn)|((rdev>>32n)&0xfffff000n);
  const minor=(rdev&0xffn)|((rdev>>12n)&0xffffff00n);
  return `${major}:${minor}`;
}

function mountBlock(probe:Probe,source:string) {
  need(absolute(source)&&source.startsWith('/dev/'));
  const node=probe.realpath(source);
  const name=path.basename(node);
  need(blockNamePattern.test(name)&&node===`/dev/${name}`);
  const stat=probe.lstat(node);
  need(stat&&stat.isBlockDevice());
  const number=blockNumber(stat.rdev);
  const sys=probe.realpath(`/sys/dev/block/${number}`);
  need(sys.startsWith('/sys/devices/')&&!sys.startsWith('/sys/devices/virtual/')&&
    path.basename(sys)===name&&probe.attr(`${sys}/dev`)===number);
  return {node,name,sys,number};
}

function singleMember(probe:Probe,uuid:string,block:ReturnType<typeof mountBlock>):boolean {
  const root=`${BTRFS_SYS}/${uuid}`;
  const members=[...probe.entries(`${root}/devices`,1)];
  need(members.length===1&&members[0].isSymbolicLink()&&members[0].name===block.name&&
    probe.realpath(`${root}/devices/${block.name}`)===block.sys);
  const ids=[...probe.entries(`${root}/devinfo`,1)];
  need(ids.length===1&&ids[0].isDirectory()&&unsigned(ids[0].name)>0n);
  const info=`${root}/devinfo/${ids[0].name}`;
  // Equality with the device FSID rules out a sprouted seed. A seed mounted
  // alone has no writable member. Require positive evidence of an ordinary FSID.
  return probe.attr(`${info}/fsid`)===uuid&&probe.attr(`${info}/in_fs_metadata`)==='1'&&
    probe.attr(`${info}/missing`)==='0'&&probe.attr(`${info}/replace_target`)==='0'&&
    probe.attr(`${info}/writeable`)==='1'&&probe.attr(`${root}/temp_fsid`)==='0'&&
    probe.attr(`${root}/metadata_uuid`)===uuid&&probe.attr(`${root}/exclusive_operation`)==='none';
}

function partition(probe:Probe,sys:string) {
  if(!probe.lstat(`${sys}/partition`))return {number:undefined,extent:['whole']};
  const number=probe.attr(`${sys}/partition`), start=probe.attr(`${sys}/start`), size=probe.attr(`${sys}/size`);
  need(/^[1-9][0-9]{0,9}$/.test(number));
  unsigned(start);
  need(unsigned(size)>0n);
  return {number,extent:['partition',start,size]};
}

function exactDiskLink(probe:Probe,file:string,block:ReturnType<typeof mountBlock>):boolean {
  const target=probe.io(()=>fs.readlinkSync(file));
  // Do not lexically normalize arbitrary ".." chains: symlinks in an
  // intermediate component could make them resolve to a different device.
  return (target===`../../${block.name}`||target===block.node)&&probe.realpath(file)===block.node;
}

function backing(probe:Probe,mount:Mount):{uuid:string;wwn:string;extent:string[]} {
  const block=mountBlock(probe,mount.source);
  const part=partition(probe,block.sys);
  need([...probe.entries(`${part.number?path.dirname(block.sys):block.sys}/slaves`,0)].length===0);
  let uuid:string|undefined;
  for(const entry of probe.entries(BTRFS_SYS,MAX_FILESYSTEMS)){
    if(!entry.isDirectory()||!uuidPattern.test(entry.name))continue;
    const member=`${BTRFS_SYS}/${entry.name}/devices/${block.name}`;
    if(!probe.lstat(member))continue;
    need(!uuid&&singleMember(probe,entry.name,block));
    uuid=entry.name;
  }
  need(uuid);

  let wwn:string|undefined, link:string|undefined;
  for(const entry of probe.entries(BY_ID,MAX_DEVICE_LINKS)){
    const match=wwnPattern.exec(entry.name);
    if(!match||!entry.isSymbolicLink())continue;
    const file=`${BY_ID}/${entry.name}`;
    // udev's by-id links point directly to the block node; do not follow any
    // secondary alias or read the node.
    if(!exactDiskLink(probe,file,block))continue;
    need(!wwn&&match[2]===part.number&&!/^0x0+$/.test(match[1]));
    wwn=match[1].toLowerCase();
    link=file;
  }
  need(wwn&&link);
  const current=mountBlock(probe,mount.source), currentPart=partition(probe,block.sys);
  need(current.sys===block.sys&&current.number===block.number&&current.node===block.node&&
    currentPart.number===part.number&&currentPart.extent.join()===part.extent.join()&&
    exactDiskLink(probe,link,block)&&singleMember(probe,uuid,block));
  return {uuid,wwn,extent:part.extent};
}

function targetStat(probe:Probe,target:ManagedVolumeTarget):BigIntStats|undefined {
  const stat=probe.lstat(target.path), claim=target.object;
  if(target.kind==='absent'){need(claim===null&&!stat);return undefined;}
  need(stat&&claim&&(target.kind==='directory'?stat.isDirectory():target.kind==='file'&&stat.isFile())&&
    String(stat.dev)===claim.device&&String(stat.ino)===claim.inode&&String(stat.birthtimeNs)===claim.birthNs);
  return stat;
}

function observe(target:ManagedVolumeTarget):string {
  need(absolute(target.path)&&target.path.split('/').length<=MAX_COMPONENTS+1);
  const probe=new Probe(), stat=targetStat(probe,target);
  let anchor=target.path, anchorStat=stat;
  while(!anchorStat?.isDirectory()){
    need(!anchorStat||anchor===target.path&&target.kind==='file');
    need(anchor!=='/');
    anchor=path.dirname(anchor);
    anchorStat=probe.lstat(anchor);
  }
  const dir=anchorStat;
  need(dir);
  const type=probe.io(()=>fs.statfsSync(anchor,{bigint:true})).type;
  need(type===BTRFS_MAGIC||type===BigInt.asIntN(32,BTRFS_MAGIC));

  return probe.withDirectory(anchor,fd=>{
    const id=probe.directoryMount(fd,dir), mount=targetMount(probe,id,target.path), subvolid=subvolume(mount);
    need(within(mount.point,anchor));
    const root=probe.lstat(mount.point);
    need(root&&root.isDirectory()&&root.ino===SUBVOLUME_ROOT_INODE&&root.dev===dir.dev);
    return probe.withDirectory(mount.point,rootFd=>{
      need(probe.directoryMount(rootFd,root)===id);
      const chain=new Map<string,BigIntStats>([[mount.point,root]]);
      for(let current=anchor;current!==mount.point;current=path.dirname(current)){
        const s=probe.lstat(current);
        // Nested subvolumes do not have their own mountinfo entry, but their
        // root inode is 256, even if reached via the parent's mount ID.
        need(s&&s.isDirectory()&&s.dev===root.dev&&s.ino!==SUBVOLUME_ROOT_INODE);
        chain.set(current,s);
      }
      need(same(chain.get(anchor)!,dir)&&(!stat||stat.dev===root.dev));
      const identity=backing(probe,mount);
      need(targetMount(probe,id,target.path).line===mount.line);
      for(const [file,previous] of chain){
        const fresh=probe.lstat(file);
        need(fresh?.isDirectory()&&same(fresh,previous));
      }
      targetStat(probe,target);
      // The nearest directory used for absence must still be the nearest one.
      if(!stat)for(let current=path.dirname(target.path);current!==anchor;current=path.dirname(current)){
        need(!probe.lstat(current));
      }
      probe.check();
      return createHash('sha256').update(JSON.stringify(['linux-btrfs-v1',identity.uuid,subvolid,identity.wwn,...identity.extent])).digest('hex');
    });
  });
}

/** Positive placement proof only. Never opens the target file or block device. */
export const readLinuxManagedVolumeIdentity:ManagedVolumeIdentityReader=target=>{
  if(process.platform!=='linux')return {kind:'unavailable'};
  try{return {kind:'verified',fingerprint:observe(target)};}catch{return {kind:'unavailable'};}
};
