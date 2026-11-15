/** Synthetic Setup responder for older rendered QA drivers; not Store or host admission. */
import { freshEngine } from './managed-migration-engine.ts';

export function freshSetupFixture() {
  const engine = freshEngine({ inspectPages: 2 });
  const requests: Array<{path:string;action?:string;version?:number}> = [];
  const reply = async (q:{path:string;method?:string;body?:string}) => {
    const body = JSON.parse(q.body ?? '{}');
    requests.push({path:q.path,action:body.action,version:body.version});
    if (q.path === '/v1/setup/managed-step') {
      if (body.action === 'inspect' && body.storeRoot) engine.review.targets.storeRoot = body.storeRoot;
      const result = await engine.request(q.body ?? '{}');
      if (result === 'drop') throw new Error('synthetic lost reply');
      return result;
    }
    if (q.path !== '/v1/setup') return {status:409,body:'{"error":"managed-action-required"}'};
    const p = engine.observeSetup(), done = p?.state === 'complete';
    return {status:200,body:JSON.stringify({configured:done,verified:done,installed:false,
      captureEnabled:p?.capture.state === 'on' ? true : p?.capture.state === 'off' ? false : null,
      targets:done ? engine.review.targets : null,version:null,activation:'unknown',separateLifecycle:false,
      historyRetained:true,diagnostics:[],delivery:{kind:'managed',revision:1,managedFreshSteps:1,
        managedMigrationSteps:1,configuration:done?'configured':'unconfigured',migration:!p?'none':done?'complete':'pending',
        mode:'unknown',observation:done?'not-observed':'unknown',expectedVersion:'1.4.0',...(p?{freshProgress:p}:{})}})};
  };
  return {engine,requests,reply};
}

/** User-equivalent controls, followed by durable completion rather than early binding publication. */
export async function configureFreshSetup(io:{click:(selector:string)=>Promise<unknown>;wait:(condition:string,label:string)=>Promise<unknown>}) {
  await io.click('[data-testid="setup-inspect"] button');
  await io.wait('!!d.querySelector("[data-testid=setup-review]")','fresh review');
  await io.click('[data-testid="setup-ack"] [role="checkbox"]');
  await io.wait('d.querySelector("[data-testid=setup-confirm] button")?.getAttribute("aria-disabled")==="false"','fresh acknowledged');
  await io.click('[data-testid="setup-confirm"] button');
  await io.wait('!!d.querySelector("[data-testid=setup-migration-progress][data-family=fresh][data-state=complete]")','fresh steps complete');
}
