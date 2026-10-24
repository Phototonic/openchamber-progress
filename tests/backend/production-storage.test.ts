import {test}from'node:test';
import assert from'node:assert/strict';
import{fork}from'node:child_process';
import{once}from'node:events';
import{readFileSync,writeFileSync,chmodSync,statSync}from'node:fs';
import{Store}from'../../shared/store.ts';
import{productionFixture,P1}from'../fixtures/production.ts';

test('QA3 two actual production writers conflict without silent overwrite',{timeout:15000},async()=>{
  const f=productionFixture();const children:ReturnType<typeof fork>[]=[];
  try{
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Concurrent',items:P1},f.actor);
    const writers=['a','b'].map(id=>{const c=fork(new URL('../fixtures/production-writer.ts',import.meta.url),[f.store.file,'write',id],{stdio:['ignore','ignore','ignore','ipc']});children.push(c);return c;});
    const exits=writers.map(c=>once(c,'exit'));const replies=await Promise.all(writers.map(c=>once(c,'message')));
    assert.equal(replies.filter(([m])=>(m as any).phase==='finished').length,1);
    assert.equal(replies.filter(([m])=>(m as any).code==='conflict').length,1);await Promise.all(exits);
    assert.equal(f.store.get(f.source.id,'P1')!.revision,2);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM revisions').get()!.n,2);
  }finally{for(const c of children)if(c.exitCode===null&&!c.signalCode){const exited=once(c,'exit');c.kill('SIGKILL');await exited;}f.cleanup();}
});
test('QA3 kill within actual write transaction and after commit-before-reply; replay recovers acknowledgement',{timeout:15000},async()=>{
  const f=productionFixture();let child:ReturnType<typeof fork>|undefined;
  try{
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Crash',items:P1},f.actor);
    for(const mode of ['before','after']){
      child=fork(new URL('../fixtures/production-writer.ts',import.meta.url),[f.store.file,mode,`kill-${mode}`],{stdio:['ignore','ignore','ignore','ipc']});
      const [reply]=await once(child,'message');assert.equal((reply as any).phase,`${mode}-commit`);
      if(mode==='before')assert.equal(statSync(`${f.store.file}-journal`).mode&0o777,0o600);
      const exit=once(child,'exit');child.kill('SIGKILL');await exit;child=undefined;
      const check=new Store(f.store.file);
      assert.equal(check.get(f.source.id,'P1')!.revision,mode==='before'?1:2);
      assert.equal(check.db.prepare('SELECT count(*) AS n FROM receipts WHERE oid=?').get(`kill-${mode}`)!.n,mode==='before'?0:1);
      if(mode==='after'){
        const receipt=check.apply({op:'change',plan:'P1',oid:'kill-after',rev:1,changes:[{id:'I4',status:'done'}]},f.actor);
        assert.equal(receipt.rev,2);assert.equal(check.history(f.source.id,'P1').data.length,2);
      }
      assert.equal(check.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');check.close();
    }
  }finally{if(child&&child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}f.cleanup();}
});
test('QA3 busy and SQLite write/disk capacity failures are explicit and atomic',{timeout:15000},async()=>{
  const f=productionFixture();let child:ReturnType<typeof fork>|undefined;
  try{
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Storage',items:P1},f.actor);
    const contender=new Store(f.store.file,{busyMs:25});
    child=fork(new URL('../fixtures/production-writer.ts',import.meta.url),[f.store.file,'hold','holder'],{stdio:['ignore','ignore','ignore','ipc']});
    assert.equal((await once(child,'message'))[0].phase,'locked');
    assert.throws(()=>contender.apply({op:'change',plan:'P1',oid:'busy',rev:1,changes:[{id:'I4',status:'done'}]},f.actor),/busy/);contender.close();
    const exit=once(child,'exit');child.kill('SIGKILL');await exit;child=undefined;
    const pages=Number(f.store.db.prepare('PRAGMA page_count').get()!.page_count);f.store.db.exec(`PRAGMA max_page_count=${pages}`);
    assert.throws(()=>f.store.apply({op:'start',plan:'disk-full',oid:'disk',rev:0,title:'Full',items:Array.from({length:25},(_,i)=>({id:`x${i}`,title:'x'.repeat(400),kind:'task'}))},f.actor),/storage/);
    assert.equal(f.store.get(f.source.id,'disk-full'),undefined);assert.equal(f.store.get(f.source.id,'P1')!.revision,1);
    const readonly=new Store(f.store.file,{readOnly:true});assert.throws(()=>readonly.setEnabled(false),/storage/);readonly.close();
  }finally{if(child&&child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}f.cleanup();}
});
test('QA3 corrupt and future-schema databases preserve bytes and never reset',()=>{
  const f=productionFixture();try{
    const corrupt=`${f.root}/store/corrupt.sqlite`;writeFileSync(corrupt,'private corrupt bytes',{mode:0o600});const bytes=readFileSync(corrupt);
    assert.throws(()=>new Store(corrupt),/corrupt/);assert.deepEqual(readFileSync(corrupt),bytes);
    f.store.db.exec('PRAGMA user_version=999');const future=readFileSync(f.store.file);
    assert.throws(()=>new Store(f.store.file),/schema/);assert.deepEqual(readFileSync(f.store.file),future);
  }finally{f.cleanup();}
});
