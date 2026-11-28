import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, {type TestContext} from 'node:test';
import {describeLinuxManagedVolumeEligibility as describeEligibility,readLinuxManagedVolumeIdentity as read} from '../../setup/managed-volume-identity-linux.ts';
import type {ManagedVolumeTarget} from '../../setup/managed-volume-identity.ts';

const UUID='aabbccdd-1122-3344-5566-778899aabbcc';
const FS=`/sys/fs/btrfs/${UUID}`, MEMBER=`${FS}/devices`, INFO=`${FS}/devinfo/1`;
const BY_ID='/dev/disk/by-id', MI='/proc/self/mountinfo';
const WWN='wwn-0x6000000000000001';
const ROOT='/reviewed mount\\040';
const ROOT_FIELD='/reviewed\\040mount\\134040';
const STORE=`${ROOT}/store`, DB=`${STORE}/db`;
const SRC='/dev/sdz', SYS='/sys/devices/fake-target/block/sdz', DEVICE='/sys/dev/block/8:300';
const ROOT_ROW='10 1 8:1 / / rw - ext4 /dev/base rw';
const UNAVAILABLE={kind:'unavailable'};
const BTRFS=0x9123683en;

function stat(kind:'dir'|'file'|'link'|'block',ino=0n,dev=99n,birthtimeNs=48n,rdev=0n) {
  return {dev,ino,birthtimeNs,rdev,isDirectory:()=>kind==='dir',isFile:()=>kind==='file',
    isBlockDevice:()=>kind==='block',isSymbolicLink:()=>kind==='link'} as fs.BigIntStats;
}
function dirent(name:string,kind:'dir'|'link'|'file') {
  return {name,isDirectory:()=>kind==='dir',isSymbolicLink:()=>kind==='link'} as fs.Dirent;
}
function missing() {return Object.assign(new Error('missing fixture entry'),{code:'ENOENT'});}
function setPlatform(platform:string) {Object.defineProperty(process,'platform',{value:platform});}

function fixture(t:TestContext) {
  // Replace only the production module's native fs calls during this test.
  // No test hook, metadata or alternate roots are accepted by the reader.
  const platform=process.platform;
  setPlatform('linux');
  t.after(()=>setPlatform(platform));
  let statfs=BTRFS, clock=0, expireOnOpen=false;
  t.mock.method(performance,'now',()=>clock);
  const texts=new Map<string,string>(), stats=new Map<string,fs.BigIntStats>(), ids=new Map<string,string>();
  const paths=new Map<string,string>(), links=new Map<string,string>(), dirs=new Map<string,fs.Dirent[]>();
  const mountReads:string[]=[], opened:string[]=[], listingReads=new Map<string,number>();
  const fds=new Map<number,{file:string;offset:number;data?:Buffer;stat?:fs.BigIntStats;id?:string}>();
  const handles=new Set<string>();
  let nextFd=20;

  function mount({id='41',subvolid='300',root='/original,one',name='/original\\054one',point=ROOT_FIELD,
    source=SRC,type='btrfs',options='',extra=''}={}) {
    const line=`${id} 10 0:92 ${root} ${point} rw shared:17 - ${type} ${source} rw,subvolid=${subvolid},subvol=${name}${options}`;
    texts.set(MI,`${ROOT_ROW}\n${line}\n${extra}`);
    return line;
  }
  function whole({wwn=WWN,src=SRC,sys=SYS,device=DEVICE,rdev=0x10082cn}={}) {
    const name=src.slice('/dev/'.length);
    paths.set(src,src);
    paths.set(device,sys);
    stats.set(src,stat('block',0n,0n,0n,rdev));
    stats.set(`${MEMBER}/${name}`,stat('link'));
    paths.set(`${MEMBER}/${name}`,sys);
    texts.set(`${sys}/dev`,`${device.slice('/sys/dev/block/'.length)}\n`);
    dirs.set(`${sys}/slaves`,[]);
    dirs.set(MEMBER,[dirent(name,'link')]);
    dirs.set(BY_ID,[dirent(wwn,'link')]);
    links.set(`${BY_ID}/${wwn}`,`../../${name}`);
    paths.set(`${BY_ID}/${wwn}`,src);
  }
  function partition(start='2048',size='1000',number='1') {
    const device='/sys/dev/block/8:301', src=`${SRC}1`, sys=`${SYS}/sdz1`;
    const wwn=`${WWN}-part${number}`;
    whole({device,src,sys,wwn,rdev:0x10082dn});
    for(const [attr,value] of Object.entries({partition:number,start,size}))texts.set(`${sys}/${attr}`,`${value}\n`);
    stats.set(`${sys}/partition`,stat('file'));
    mount({source:src});
  }
  mount();
  whole();
  dirs.set('/sys/fs/btrfs',[dirent(UUID,'dir'),dirent('features','dir')]);
  dirs.set(`${FS}/devinfo`,[dirent('1','dir')]);
  for(const [file,data] of Object.entries({
    [`${FS}/temp_fsid`]:'0',[`${FS}/metadata_uuid`]:UUID,[`${FS}/exclusive_operation`]:'none',
    [`${INFO}/fsid`]:UUID,[`${INFO}/in_fs_metadata`]:'1',[`${INFO}/missing`]:'0',
    [`${INFO}/replace_target`]:'0',[`${INFO}/writeable`]:'1',
  }))texts.set(file,`${data}\n`);
  stats.set(ROOT,stat('dir',256n));
  stats.set(STORE,stat('dir',257n));
  stats.set(DB,stat('file',258n));
  ids.set(ROOT,'41');
  ids.set(STORE,'41');

  t.mock.method(fs,'lstatSync',((file:string)=>stats.get(file))as typeof fs.lstatSync);
  t.mock.method(fs,'statfsSync',(()=>({type:statfs}))as unknown as typeof fs.statfsSync);
  t.mock.method(fs.realpathSync,'native',((file:string)=>paths.get(file)??(()=>{throw missing();})())as typeof fs.realpathSync.native);
  t.mock.method(fs,'readlinkSync',((file:string)=>links.get(file)??(()=>{throw missing();})())as typeof fs.readlinkSync);
  t.mock.method(fs,'openSync',((file:string)=>{
    opened.push(file);
    const fd=nextFd++, item={file,offset:0} as NonNullable<ReturnType<typeof fds.get>>;
    if(stats.get(file)?.isDirectory()){
      item.stat=stats.get(file);
      item.id=ids.get(file);
      assert.ok(item.stat?.isDirectory()&&item.id,`unexpected directory open: ${file}`);
    }else{
      const match=/^\/proc\/self\/fdinfo\/([0-9]+)$/.exec(file);
      const dir=match&&fds.get(Number(match[1]));
      const data=dir?`pos:\t0\nflags:\t0100000\nmnt_id:\t${dir.id}\n`:file===MI&&mountReads.length?mountReads.shift():texts.get(file);
      if(data===undefined)throw missing();
      item.data=Buffer.from(data);
    }
    fds.set(fd,item);
    if(expireOnOpen)clock=1000;
    return fd;
  })as typeof fs.openSync);
  t.mock.method(fs,'fstatSync',((fd:number)=>fds.get(fd)?.stat??(()=>{throw missing();})())as typeof fs.fstatSync);
  t.mock.method(fs,'readSync',((fd:number,buffer:Buffer,offset:number,length:number)=>{
    const item=fds.get(fd);
    assert.ok(item?.data);
    // Split reads so EOF/byte limits cannot depend on one successful read().
    const copied=item.data.copy(buffer,offset,item.offset,item.offset+Math.min(length,16*1024));
    item.offset+=copied;
    return copied;
  })as typeof fs.readSync);
  t.mock.method(fs,'closeSync',(fd:number)=>{assert.ok(fds.delete(fd),'closed unknown descriptor');});
  t.mock.method(fs,'opendirSync',((file:string)=>{
    const entries=dirs.get(file);
    if(!entries)throw missing();
    handles.add(file);
    let i=0;
    return {readSync(){listingReads.set(file,(listingReads.get(file)??0)+1);return entries[i++]??null;},
      closeSync(){assert.ok(handles.delete(file),'closed unknown directory handle');}};
  })as typeof fs.opendirSync);

  function target(file=DB,kind:ManagedVolumeTarget['kind']='file'):ManagedVolumeTarget {
    const s=stats.get(file);
    return {path:file,kind,object:s&&kind!=='absent'?
      {device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)}:null};
  }
  function observe(file=DB,kind:ManagedVolumeTarget['kind']='file') {
    const result=read(target(file,kind));
    assert.equal(fds.size,0,'leaked file descriptor');
    assert.equal(handles.size,0,'leaked directory handle');
    assert.ok(!opened.includes(DB)&&!opened.some(name=>name.startsWith('/dev/')),'opened target file or raw device');
    if(result.kind==='verified')assert.match(result.fingerprint,/^[0-9a-f]{64}$/);
    return result;
  }
  return {target,observe,mount,whole,partition,texts,stats,ids,dirs,links,paths,mountReads,opened,listingReads,
    nonBtrfs(){statfs=0xef53n;},expireOnOpen(){expireOnOpen=true;}};
}

test('native QA reports eligibility rules without paths, identifiers or fingerprints',t=>{
  const f=fixture(t),target=f.target();
  assert.deepEqual(describeEligibility(target),{kind:'verified',rule:'passed',disposition:'eligible',extent:'whole'});
  f.partition();
  assert.deepEqual(describeEligibility(target),{kind:'verified',rule:'passed',disposition:'eligible',extent:'partition'});
  f.texts.delete(`${FS}/temp_fsid`);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  assert.deepEqual(describeEligibility(target),{kind:'unavailable',rule:'btrfs-temp-fsid',disposition:'missing',extent:'partition'});
  f.texts.set(`${FS}/temp_fsid`,'0\n');
  f.dirs.set(BY_ID,[]);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  assert.deepEqual(describeEligibility(target),{kind:'unavailable',rule:'wwn-link-lookup',disposition:'refused',extent:'partition'});
  f.ids.set(STORE,'77');
  assert.deepEqual(describeEligibility(target),{kind:'unavailable',rule:'mountinfo-mount-id',disposition:'refused',extent:'unknown'});
});

test('direct mount proves placement despite renumbering; snapshots and copied disks change identity',t=>{
  const f=fixture(t), first=f.observe();
  assert.equal(first.kind,'verified');
  assert.deepEqual(f.observe(STORE,'directory'),first);
  assert.deepEqual(f.observe(ROOT,'directory'),first);
  assert.deepEqual(f.observe(`${STORE}/new/path`,'absent'),first);

  f.stats.set(ROOT,stat('dir',256n,188n));
  f.stats.set(STORE,stat('dir',257n,188n));
  f.stats.set(DB,stat('file',258n,188n));
  f.ids.set(ROOT,'77');f.ids.set(STORE,'77');
  const src='/dev/sdy', sys='/sys/devices/fake-target/block/sdy';
  f.stats.delete(`${MEMBER}/sdz`);
  f.whole({src,sys,device:'/sys/dev/block/8:16',rdev:0x810n});
  f.mount({id:'77',source:src});
  assert.deepEqual(f.observe(),first);

  f.mount({id:'77',source:src,subvolid:'301',root:'/snapshot',name:'/snapshot'});
  const snapshot=f.observe();
  assert.equal(snapshot.kind,'verified');
  assert.notDeepEqual(snapshot,first);
  f.mount({id:'77',source:src});
  f.whole({src,sys,device:'/sys/dev/block/8:16',rdev:0x810n,wwn:'wwn-0x6000000000000002'});
  const copy=f.observe();
  assert.equal(copy.kind,'verified');
  assert.notDeepEqual(copy,first);
});

test('partition evidence uses the exact member link and persistent extent, not partition number alone',t=>{
  const f=fixture(t), whole=f.observe();
  f.partition();
  const part=f.observe();
  assert.equal(part.kind,'verified');
  assert.notDeepEqual(part,whole);
  f.partition('4096');
  assert.notDeepEqual(f.observe(),part);
  f.partition('2048','1001');
  assert.notDeepEqual(f.observe(),part);
  f.dirs.set(BY_ID,[dirent(WWN,'link')]);
  assert.deepEqual(f.observe(),UNAVAILABLE,'a disk link cannot establish a partition');
  f.links.set(`${BY_ID}/${WWN}`,'../../sdz1');
  assert.deepEqual(f.observe(),UNAVAILABLE,'the exact link still needs the kernel partition number');
});

test('opened-directory mount ID, mount root inode, and the full path must agree',t=>{
  const f=fixture(t);
  f.stats.set(STORE,stat('dir',256n)); // Nested snapshot with same mount ID, even if dev is imitated.
  assert.deepEqual(f.observe(),UNAVAILABLE);
  assert.deepEqual(f.observe(STORE,'directory'),UNAVAILABLE);
  assert.deepEqual(f.observe(`${STORE}/missing`,'absent'),UNAVAILABLE);
  f.stats.set(STORE,stat('dir',257n,100n));
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.stats.set(STORE,stat('dir',257n));
  f.mount({root:'/original,one/store'});
  assert.deepEqual(f.observe(),UNAVAILABLE,'bind mount of a subdirectory');
  f.mount();
  f.stats.set(ROOT,stat('dir',257n));
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.stats.set(ROOT,stat('dir',256n));
  f.ids.set(ROOT,'99');
  assert.deepEqual(f.observe(),UNAVAILABLE,'covered mount root is not the opened mount');
});

test('overmounts, duplicate records, invalid escapes and unproved target membership refuse',t=>{
  const f=fixture(t);
  f.mount({extra:`66 41 0:71 / ${ROOT_FIELD}/store/db rw - tmpfs tmpfs rw\n`});
  assert.deepEqual(f.observe(),UNAVAILABLE,'file overmount is visible even when its parent is unchanged');
  const second=`66 10 0:91 /original,one ${ROOT_FIELD} rw - btrfs /dev/sdz rw,subvolid=300,subvol=/original\\054one\n`;
  f.mount({extra:second});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount({extra:second.replace(/^66 /,'41 ')});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount({options:',subvolid=300'});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount({name:'/original\\777one'});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount({point:`${ROOT_FIELD}2`});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount();
  assert.deepEqual(read({path:DB,kind:'file',object:{device:'99',inode:'258',birthNs:'49'}}),UNAVAILABLE);
  assert.deepEqual(f.observe(DB,'absent'),UNAVAILABLE);
  f.stats.set(STORE,stat('link',257n));
  assert.deepEqual(f.observe(),UNAVAILABLE,'do not follow a newly introduced symlink');
});

test('refuses topology or object changes across the metadata probe',t=>{
  const f=fixture(t);
  const before=f.texts.get(MI)!;
  f.mount({subvolid:'302'});
  f.mountReads.push(before,f.texts.get(MI)!);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount();
  const lstat=fs.lstatSync;
  let seen=0;
  t.mock.method(fs,'lstatSync',((file:string)=>file===DB&&++seen===2?stat('file',259n):lstat(file,{bigint:true}))as typeof fs.lstatSync);
  assert.deepEqual(f.observe(),UNAVAILABLE);
});

test('only an unambiguous, ordinary mounted member with a system WWN is eligible',t=>{
  const f=fixture(t);
  f.links.set(`${BY_ID}/${WWN}`,'../../different-disk');
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.links.set(`${BY_ID}/${WWN}`,'../../sdz');
  const alias='wwn-0x6000000000000002';
  f.links.set(`${BY_ID}/${alias}`,'../../sdz');
  f.paths.set(`${BY_ID}/${alias}`,SRC);
  f.dirs.set(BY_ID,[dirent(WWN,'link'),dirent(alias,'link')]);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.whole();
  f.paths.set(`${BY_ID}/${WWN}`,'/dev/different-disk');
  assert.deepEqual(f.observe(),UNAVAILABLE,'a plausible symlink must resolve to the real member');
  f.whole();
  f.paths.set(`${MEMBER}/sdz`,'/sys/devices/other/block/sdz');
  assert.deepEqual(f.observe(),UNAVAILABLE,'same device name is not membership');
  f.whole();
  f.dirs.set(MEMBER,[dirent('sdz','link'),dirent('sdy','link')]);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.whole();
  f.dirs.set(`${FS}/devinfo`,[dirent('1','dir'),dirent('2','dir')]);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.dirs.set(`${FS}/devinfo`,[dirent('1','dir')]);
  for(const [file,bad] of [[`${INFO}/fsid`,'different'],[`${INFO}/missing`,'1'],[`${INFO}/replace_target`,'1'],
    [`${INFO}/writeable`,'0'],[`${FS}/temp_fsid`,'1'],[`${FS}/exclusive_operation`,'device replace']]){
    const original=f.texts.get(file)!;
    f.texts.set(file,`${bad}\n`);
    assert.deepEqual(f.observe(),UNAVAILABLE);
    f.texts.set(file,original);
  }
  f.mount({options:',degraded'});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount();
  f.texts.delete(`${FS}/temp_fsid`);
  assert.deepEqual(f.observe(),UNAVAILABLE,'missing evidence is not negative evidence');
});

test('loop, stacked and non-btrfs mounts refuse without inventorying irrelevant devices',t=>{
  const f=fixture(t);
  f.mount({source:'/dev/loop0'});
  f.whole({src:'/dev/loop0',sys:'/sys/devices/virtual/block/loop0',device:'/sys/dev/block/7:0',rdev:0x700n});
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.mount();
  f.whole();
  f.dirs.set(`${SYS}/slaves`,[dirent('lower','link')]);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.nonBtrfs();
  const opens=f.opened.length;
  assert.deepEqual(f.observe(),UNAVAILABLE);
  assert.equal(f.opened.length,opens);
  assert.equal(f.listingReads.size,1,'only the stacked-device slave listing was accessed');
});

test('limits refuse without truncation and release metadata handles',t=>{
  const f=fixture(t);
  const prior=f.texts.get(MI)!;
  f.texts.set(MI,`${prior}${'x'.repeat(1024*1024)}\n`);
  assert.deepEqual(f.observe(),UNAVAILABLE);
  f.texts.set(MI,prior);
  f.dirs.set(BY_ID,[dirent(WWN,'link'),...Array.from({length:5000},(_,i)=>dirent(`other-${i}`,'file'))]);
  assert.deepEqual(f.observe(),UNAVAILABLE,'cannot return an early match from an incomplete inventory');
  assert.ok(f.listingReads.get(BY_ID)!<5000);
  const opens=f.opened.length;
  assert.deepEqual(f.observe(`${STORE}/${'path/'.repeat(64)}file`,'absent'),UNAVAILABLE);
  assert.equal(f.opened.length,opens);
  f.expireOnOpen();
  assert.deepEqual(f.observe(),UNAVAILABLE,'expiry after opening still closes the handle');
});

test('non-Linux returns unavailable before using Linux sources',t=>{
  const f=fixture(t);
  for(const platform of ['darwin','win32']){
    setPlatform(platform);
    assert.deepEqual(f.observe(),UNAVAILABLE);
  }
  assert.deepEqual(f.opened,[]);
  assert.equal(f.listingReads.size,0);
});
