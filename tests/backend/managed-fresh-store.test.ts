import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {syncBuiltinESMExports} from 'node:module';
import {Store} from '../../shared/store.ts';
import {privateDirectory,platformSecurityScope} from '../../shared/platform.ts';
import {receiptIndexInstalled} from '../../shared/receipt-index.ts';

function fixture(){const root=fs.mkdtempSync('/tmp/opencode/fresh-store-');return {root,file:path.join(root,'progress.sqlite'),
  close(){fs.rmSync(root,{recursive:true,force:true});}};}
test('exclusive fresh initialization freezes Store ID and capture off with no source, preserving ordinary defaults',()=>{
  const f=fixture();try{
    let validated=0;const store=Store.createFresh(f.file,{storeId:'frozen-store',validate(){validated++;}});
    try{const state=store.list();assert.equal(state.storeId,'frozen-store');assert.equal(state.captureEnabled,false);assert.deepEqual(state.sources,[]);
      assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,2);assert.ok(receiptIndexInstalled(store.db));}
    finally{store.close();}
    assert.equal(validated,1);
    const read=new Store(f.file,{readOnly:true});try{assert.equal(read.list().captureEnabled,false);}finally{read.close();}
    const other=new Store(path.join(f.root,'ordinary.sqlite'),{create:true});try{assert.equal(other.list().captureEnabled,true);}finally{other.close();}
  }finally{f.close();}
});
test('existing empty, partial, initialized, linked and orphan-sidecar state is retained without adoption',()=>{
  for(const kind of ['empty','partial','complete','symlink','hardlink','journal','wal','shm']){
    const f=fixture();try{
      if(kind==='complete'){const s=new Store(f.file,{create:true});s.close();}
      else if(kind==='partial'){const db=new DatabaseSync(f.file);db.exec('CREATE TABLE unfinished(id)');db.close();fs.chmodSync(f.file,0o600);}
      else if(kind==='symlink'){fs.writeFileSync(path.join(f.root,'target'),'retained',{mode:0o600});fs.symlinkSync(path.join(f.root,'target'),f.file);}
      else if(kind==='hardlink'){fs.writeFileSync(path.join(f.root,'target'),'retained',{mode:0o600});fs.linkSync(path.join(f.root,'target'),f.file);}
      else fs.writeFileSync(kind==='empty'?f.file:f.file+'-'+kind,kind==='empty'?'':'retained',{mode:0o600});
      const names=fs.readdirSync(f.root),bytes=new Map(names.filter(n=>!fs.lstatSync(path.join(f.root,n)).isSymbolicLink()).map(n=>[n,fs.readFileSync(path.join(f.root,n))]));
      assert.throws(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){}}));
      assert.deepEqual(fs.readdirSync(f.root),names);for(const [name,content] of bytes)assert.deepEqual(fs.readFileSync(path.join(f.root,name)),content);
      if(['empty','partial'].includes(kind))assert.throws(()=>new Store(f.file,{create:true}),kind==='empty'?{code:'corrupt'}:{code:'schema'});
    }finally{f.close();}
  }
});
test('fresh validation refuses before reservation and cannot inherit an enclosing security scope',()=>{
  const f=fixture();try{
    assert.throws(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){throw new Error('synthetic refusal');}}),/synthetic refusal/);
    assert.equal(fs.existsSync(f.file),false);
    assert.throws(()=>platformSecurityScope(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){}})),{code:'managed-step-conflict'});
    assert.equal(fs.existsSync(f.file),false);
  }finally{f.close();}
});
test('interrupted initialization retains its exclusively reserved partial file and ordinary opens never repair it',t=>{
  const f=fixture();try{
    const exec=DatabaseSync.prototype.exec;
    const mock=t.mock.method(DatabaseSync.prototype,'exec',function(this:DatabaseSync,sql:string){if(sql.includes('CREATE TABLE meta'))throw new Error('synthetic initialization interruption');return exec.call(this,sql);});
    try{assert.throws(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){}}),{code:'storage'});}
    finally{mock.mock.restore();}
    const bytes=fs.readFileSync(f.file);
    assert.throws(()=>new Store(f.file,{create:true}));assert.throws(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){}}));
    assert.deepEqual(fs.readFileSync(f.file),bytes);
  }finally{f.close();}
});
test('post-reservation object replacement is refused before initialization, with both files retained',t=>{
  const f=fixture();try{
    const open=fs.openSync;let replaced=false;
    const mock=t.mock.method(fs,'openSync',((file:fs.PathLike,flags:any,mode?:any)=>{
      const fd=open(file,flags,mode);if(String(file)===f.file&&flags==='wx'){
        fs.renameSync(f.file,f.file+'.reserved');fs.writeFileSync(f.file,'replacement',{mode:0o600});replaced=true;
      }return fd;
    }) as typeof fs.openSync);syncBuiltinESMExports();
    try{assert.throws(()=>Store.createFresh(f.file,{storeId:'new-store',validate(){}}),{code:'binding'});}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(replaced,true);assert.equal(fs.readFileSync(f.file,'utf8'),'replacement');assert.equal(fs.statSync(f.file+'.reserved').size,0);
  }finally{f.close();}
});
test('exclusive directory creation shares preflight but refuses existing targets and partial bootstrap',()=>{
  const f=fixture();try{
    const dir=path.join(f.root,'store');let validated=0;
    privateDirectory(dir,false,{exclusive:true,validate(){validated++;}});assert.equal(validated,1);
    const stat=fs.lstatSync(dir);assert.equal(stat.mode&0o777,0o700);
    assert.throws(()=>privateDirectory(dir,false,{exclusive:true,validate(){}}),{code:'path-unverified'});
    assert.equal(fs.lstatSync(dir).ino,stat.ino);
    const missing=path.join(f.root,'other');
    assert.throws(()=>privateDirectory(missing,false,{exclusive:true,validate(){throw new Error('synthetic refusal');}}),/synthetic refusal/);
    assert.equal(fs.existsSync(missing),false);
    assert.throws(()=>platformSecurityScope(()=>privateDirectory(missing,false,{exclusive:true,validate(){}})),{code:'managed-step-conflict'});
  }finally{f.close();}
});
