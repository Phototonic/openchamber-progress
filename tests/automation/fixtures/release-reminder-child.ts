/** Fixed child entry point: scenarios are JSON data, never JavaScript source. */
import { readFileSync } from 'node:fs';
import { main, visibleMentions, type Context } from '../../../scripts/release-credits.ts';

type Scenario={
  behavior:'ok'|'throw-error'|'rate-limit'|'timeout'|'bad-rows'|'missing-history'|'visible-mentions';
  context:Context;
  previous?:string[];
  releases?:unknown[];
  pulls?:unknown[];
  env?:Record<string,string>;
  markdown?:string[];
};
const scenario=JSON.parse(readFileSync(process.argv[2],'utf8')) as Scenario;
if(scenario.behavior==='visible-mentions') {
  console.log(JSON.stringify(scenario.markdown!.map(text=>[...visibleMentions(text)].sort())));
} else {
  await main(scenario.env??{}, {
    load:()=>{
      if(scenario.behavior==='missing-history')throw new Error('missing history');
      return scenario.context;
    },
    ancestors:()=>scenario.previous??[],
    api:async(path)=>{
      switch(scenario.behavior) {
        case 'throw-error': throw new Error('private API error synthetic-token');
        case 'rate-limit': throw new Error('HTTP 403 rate limit');
        case 'timeout': throw new DOMException('timeout','TimeoutError');
        case 'bad-rows': return [{}];
        case 'ok': return path.startsWith('/releases?')?scenario.releases??[]:scenario.pulls??[];
        default: throw new Error('unknown fixture behavior');
      }
    },
  });
}
