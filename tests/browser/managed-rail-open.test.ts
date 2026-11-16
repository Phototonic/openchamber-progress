import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureManagedRailOpen } from './managed-companion-qa.ts';

for(const state of ['closed','restored-hydrating','open-empty'] as const) {
  test(`managed rail opening: ${state}`,async()=>{
    const initiallyReady=state==='open-empty';
    let open=state!=='closed',ready=initiallyReady,toggles=0,waits=0;
    await ensureManagedRailOpen({
      hostOpen:async()=>open,
      toggle:async()=>{open=!open;toggles++;},
      waitForGuest:async()=>{
        waits++;
        assert.ok(open,'wait for the guest without closing its restored host panel');
        ready=true;
      },
    });
    assert.ok(open&&ready);
    assert.equal(toggles,state==='closed'?1:0);
    if(!initiallyReady)assert.equal(waits,1,'open state does not imply guest readiness');
  });
}
