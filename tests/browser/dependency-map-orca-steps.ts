import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Driver } from './dependency-map-final-qa.ts';

/** Real Orca output only: never synthesize speech by reading DOM/AX names into a fake transcript. */
export async function orcaAcceptance(d:Driver){
  const i=process.argv.indexOf('--orca-log'),log=process.argv[i+1];
  if(!process.env.ORCA_PRIVATE_ROOT||!log?.startsWith(process.env.ORCA_PRIVATE_ROOT+'/'))throw Error('Orca driver requires the isolated runner');
  const text=()=>readFileSync(log,'utf8');
  const clean=(s:string)=>s.replace(/https?:\/\/[^\s'"<>]+/g,'[synthetic fixture URL]').replace(/\/(?:tmp|home|Users)\/[^\s'"<>]+/g,'[private path]');
  // Orca 49 sends Say All directly through speechdispatcherfactory, bypassing SPEECH OUTPUT.
  // Use its final SSML dispatch log for *both* ordinary and Say All speech, once per dispatch;
  // counting SPEECH OUTPUT as well would double-count ordinary focus announcements.
  const speech=(raw:string)=>[...raw.matchAll(/SPEECH DISPATCHER: Speaking '(<speak>[\s\S]*?<\/speak>)' \n\s*ORCA rate/g)].map(m=>clean(m[1].replace(/<[^>]+>/g,'').replace(/&(?:lt|gt|amp|quot|apos);/g,e=>({'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&apos;':"'"}[e]!)).replace(/\s+/g,' ').trim()));
  const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const option=(name:string)=>process.argv[process.argv.indexOf(name)+1];
  const ready=option('--orca-ready'),running=option('--orca-running');
  if(![log,ready,running].every(p=>p&&resolve(p).startsWith(process.env.ORCA_PRIVATE_ROOT+'/')))throw Error('Refusing non-private Orca handshake paths');
  writeFileSync(ready,'ready');
  for(const end=Date.now()+20000;!existsSync(running);){if(Date.now()>end)throw Error('Isolated setup: Orca startup handshake');await pause(50);}
  const quiet=async()=>{let last=text().length,stable=Date.now(),end=Date.now()+7000;while(Date.now()<end){await pause(100);const next=text().length;if(next!==last){last=next;stable=Date.now();}if(Date.now()-stable>=700)return;} };
  const xkey=(...keys:string[])=>execFileSync('/usr/bin/xdotool',['key','--clearmodifiers',...keys],{env:process.env});
  const transcript:{step:number;action:string;speech:string[]}[]=[];
  const results=Array.from({length:6},(_,i)=>({step:i+1,status:'NOT_RUN',notes:'Not reached'}));
  let currentStep=0,productFailure=false;
  const focus=async(s:string,selector:string)=>{await d.wait(s,`d.querySelector(${JSON.stringify(selector)})`,'focus preparation target');return d.guest(s,`const n=d.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});n.focus();return d.activeElement===n`);};
  const action=async(step:number,label:string,fn:()=>Promise<unknown>|unknown)=>{await quiet();const at=text().length;await fn();await quiet();const said=speech(text().slice(at));transcript.push({step,action:label,speech:said});return said;};
  try{
    await d.c.send('Emulation.setFocusEmulationEnabled',{enabled:false});
    const windows=execFileSync('/usr/bin/xdotool',['search','--onlyvisible','--class','chromium|chrome'],{env:process.env,encoding:'utf8'}).trim().split('\n');
    execFileSync('/usr/bin/xdotool',['windowfocus','--sync',windows[0]],{env:process.env});
    const apps=execFileSync('/usr/bin/python3',['-c',`import gi,json;gi.require_version('Atspi','2.0');from gi.repository import Atspi;r=Atspi.get_desktop(0);print(json.dumps([r.get_child_at_index(i).get_name() for i in range(r.get_child_count())]))`],{env:process.env,encoding:'utf8',timeout:8000});
    writeFileSync(join(d.artifacts,'atspi-apps.json'),apps);
    // This probe establishes real X/AT-SPI/Orca transport before semantic acceptance is attempted.
    const said=await action(0,'Open board Map',async()=>{await d.click('page','[data-id="map"][role="tab"]');await d.wait('page',`d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'`);});
    const card=await action(0,'Focus actual card through AT-SPI',async()=>{await focus('page','[data-testid="map-card-B"]');});
    writeFileSync(join(d.artifacts,'probe.json'),JSON.stringify({speech:said,cardSpeech:card,actualSpeechLines:speech(text()).length,startupSpeech:speech(text()).slice(0,10)},null,2)+'\n');
    if(!card.some(s=>s.includes('Build a deliberately long Unicode branch')))throw Error('Isolated setup: no real Orca card speech');
    if(process.argv.includes('--orca-probe')){d.check('orca:isolated-transport-probe',true);return;}
    const expect=(ok:boolean,note:string)=>{if(!ok){productFailure=true;throw Error('Product speech/focus failure: '+note);}};
    const active=(surface:string)=>d.guest<string>(surface,`const n=d.activeElement;return n?.dataset?.testid??n?.tagName??'none'`);
    const selected=(surface:string)=>d.guest<string>(surface,`return d.querySelector('[data-testid="map-inspector"]')?.dataset.selected??''`);
    const ready=(surface:string,revision?:number)=>d.wait(surface,`d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'${revision?`&&d.querySelector('[data-testid="map-region"]').dataset.revision==='${revision}'`:''}`,'paired map');
    // Controls can be temporarily absent while a hidden frame becomes current. Do
    // not infer the wrapper shape from that loading gap; both native and SDK
    // buttons share this stable selector, and focus waits for the actual target.
    const button=async(_surface:string,id:string)=>`button[data-testid="${id}"], [data-testid="${id}"] button`;
    const press=async(surface:string,id:string)=>{await focus(surface,await button(surface,id));await quiet();xkey('Return');await d.frames2();};
    const title=(surface:string,id:string)=>d.guest<string>(surface,`return d.querySelector('[data-testid="map-card-${id}"] .ap-map-card-title').textContent`);
    const once=(said:string[],name:string)=>{const prefix=name.slice(0,28).toLowerCase();return said.join('\n').toLowerCase().split(prefix).length-1===1;};
    const mode=async(kind:'focus'|'browse',step:number)=>{
      // Orca desktop bindings: double Orca+A enables sticky focus, triple enables sticky
      // browse. Ordinary toggles auto-switch again when a control receives focus.
      const said=await action(step,`Set Orca sticky ${kind} mode`,()=>xkey(...Array.from({length:kind==='focus'?2:3},()=> 'Insert+a')));
      if(!said.some(s=>new RegExp(kind+' mode','i').test(s)))throw Error('Isolated setup: unable to select Orca '+kind+' mode');
    };
    const readAll=async(step:number,label:string,pattern:RegExp)=>{
      await mode('browse',step);
      await action(step,'Move Orca reading cursor to document start',()=>xkey('ctrl+Home'));
      const said=await action(step,label,async()=>{
        xkey('KP_Add');
        const at=text().length,end=Date.now()+25000;
        while(!pattern.test(speech(text().slice(at)).join(' '))){if(Date.now()>end)break;await pause(100);}
        xkey('Escape');
      });return said;
    };
    const finish=(step:number,notes:string)=>{results[step-1]={step,status:'PASS',notes};};

    currentStep=1;
    // Start the scripted check from the real entry after the transport probe. Reading is Orca
    // browse/Say All over the actual document, not injected expected speech or DOM-name logging.
    await d.show(['page'],1100);await focus('page','[data-testid="map-card-B"]');await quiet();
    const overview=await readAll(1,'Read map region, recorded-information caveat and keyboard help',/Drag the background|Tab leaves the map/i);
    const words=overview.join(' ');
    expect(/Task map|Dependency map/i.test([...card,...overview].join(' ')),'named map region not spoken');
    expect(/recorded/i.test(words)&&/not (?:a )?schedule|not proof/i.test(words),'recorded-information caveat not spoken');
    expect(/Arrow keys|nearest card/i.test(words)&&/Tab leaves|Tab.*leave/i.test(words),'keyboard help not spoken');
    finish(1,'Named map, caveat and help spoken through Orca browse/Say All.');

    currentStep=2;await mode('focus',2);
    await focus('page','[data-testid="map-pan-right"]');await quiet();
    const entry=await action(2,'Tab once from toolbar into canvas',()=>xkey('Tab'));
    const firstId=await d.guest<string>('page',`return d.activeElement?.dataset?.task??''`);
    expect(!!firstId,'Tab did not enter a card');
    expect(await d.guest('page',`return [...d.querySelectorAll('[data-testid="map-viewport"] button')].filter(n=>n.tabIndex===0).length===1`),'canvas has more than one Tab stop');
    const firstTitle=await title('page',firstId);
    expect(entry.some(s=>s.includes(firstTitle.slice(0,28))), 'full card title not spoken on entry');
    expect(/reported working|ready|waiting|done|blocked|skipped/i.test(entry.join(' '))&&/prerequisite/i.test(entry.join(' '))&&/dependent/i.test(entry.join(' ')),'card state/relation counts not spoken');
    const exit=await action(2,'Tab leaves canvas',()=>xkey('Tab'));
    expect(await d.guest('page',`return !d.activeElement.closest('[data-testid="map-viewport"]')&&d.activeElement!==d.body`),'Tab trapped in canvas or body');
    await action(2,'Shift Tab returns to roving card',()=>xkey('shift+Tab'));
    await action(2,'Shift Tab leaves canvas backwards',()=>xkey('shift+Tab'));
    expect(await d.guest('page',`return !d.activeElement.closest('[data-testid="map-viewport"]')&&d.activeElement!==d.body`),'Shift Tab trapped in canvas or body');
    await action(2,'Tab re-enters canvas',()=>xkey('Tab'));
    for(const [key,label]of [['Right','Nearest neighbour'],['bracketleft','Direct prerequisite'],['bracketright','Direct dependent']]){
      const said=await action(2,label,()=>xkey(key)),id=await selected('page');
      expect(!!id&&(await active('page'))==='map-card-'+id,label+' did not select/focus the target');
      expect(once(said,await title('page',id)),label+' selection was missing or spoken more than once');
    }
    await action(2,'Select join for alternative prerequisite inspection',()=>xkey('bracketright'));
    await focus('page','[data-testid="map-relation-C"]');await quiet();
    const alternative=await action(2,'Inspector alternative prerequisite',()=>xkey('Return'));
    expect(await selected('page')==='C'&&once(alternative,await title('page','C')),'inspector relation selection speech/focus');
    finish(2,'Full card context, one Tab stop, both exits, neighbour/relation navigation and single selection speech.');

    currentStep=3;
    for(const[id,pattern]of [['map-zoom-in',/zoom/i],['map-zoom-out',/zoom/i],['map-fit-all',/fit|tasks|view/i],['map-pan-right',/moved|right/i]] as const){
      await focus('page',await button('page',id));await quiet();const said=await action(3,id,()=>xkey('Return'));expect(pattern.test(said.join(' ')),id+' outcome not spoken');expect(await active('page')!=='BODY',id+' lost focus to body');
    }
    await focus('page','[data-testid="map-card-B"]');await quiet();xkey('Return');await quiet();
    const filter=await action(3,'Choose Unfinished',()=>press('page','map-status-unfinished'));expect(/tasks.*shown|unfinished/i.test(filter.join(' ')),'filter outcome not spoken');
    const hidden=await action(3,'Inspect hidden done prerequisite',()=>focus('page','[data-testid="map-relation-A"]'));
    expect(/hidden/i.test(hidden.join(' '))&&/done/i.test(hidden.join(' ')),'hidden done relationship not understandable');
    const reveal=await action(3,'Reveal hidden prerequisite',()=>xkey('Return'));
    expect(await selected('page')==='A'&&(await active('page'))==='map-card-A'&&reveal.length>0,'hidden prerequisite reveal/focus');
    finish(3,'Viewport/filter results and hidden prerequisite spoken; explicit reveal focuses the card.');

    currentStep=4;
    await focus('page','[data-testid="map-card-B"]');await quiet();xkey('Return');await quiet();const before=await active('page');
    const quietUpdate=await action(4,'Status checkpoint and two completed polls',async()=>{
      await d.evaluate(`fetch('/fixture-step',{method:'POST',body:JSON.stringify({step:'status'})}).then(r=>r.ok)`);await ready('page',2);
      const mark=await d.evaluate<number>('qa.replies.length');await d.wait('page',`qa.replies.slice(${mark}).filter(r=>r.frame==='page'&&r.path==='/v1/plans'&&r.status===200).length>=2`,'two polls after status checkpoint');
    });
    expect(quietUpdate.length===0,'status checkpoint/polls produced unsolicited speech');expect(await active('page')===before,'status checkpoint/polls changed focus');
    await action(4,'Structural checkpoint',async()=>{await d.evaluate(`fetch('/fixture-step',{method:'POST',body:JSON.stringify({step:'structure'})}).then(r=>r.ok)`);await ready('page',3);});
    expect(await selected('page')==='B'&&await active('page')===before,'structural checkpoint lost selected context/focus');
    finish(4,'No speech/focus change across status update and two polls; structural context retained.');

    currentStep=5;
    await focus('page',await button('page','map-list'));await quiet();
    const listSpeech=await action(5,'View as list',async()=>{xkey('Return');await d.wait('page',`d.activeElement?.dataset?.testid==='item-B'`);});
    expect(once(listSpeech,'Build a deliberately long Unicode branch'),'canonical List task was missing or spoken more than once');
    const index=await d.guest<number>('page',`const n=d.querySelector('[data-testid="plan-row-P-map-none"][data-source="source-alpha"]'),b=n.closest('[role="listbox"]');b.focus();return [...b.querySelectorAll('[role="option"]')].indexOf(n)`);
    xkey('Home');for(let n=0;n<index;n++)xkey('Down');xkey('Return');await d.frames2();
    await d.click('page','[data-id="map"][role="tab"]');await ready('page');
    const noDeps=await readAll(5,'Read no-prerequisites plan',/Tab leaves the map|Drag the background/i);
    expect(/No prerequisites recorded for this plan/i.test(noDeps.join(' ')),'no-prerequisites statement not spoken');
    expect(!noDeps.some(s=>s.includes('Build a deliberately long Unicode branch')),'previous plan selection leaked into no-prerequisites reading');
    expect(/recorded/i.test(noDeps.join(' '))&&!/all prerequisites are known|this task is running/i.test(noDeps.join(' ')),'false certainty/execution claim');
    await mode('focus',5);await focus('page','[data-testid="map-pan-right"]');xkey('Tab');await quiet();xkey('Tab');expect(await d.guest('page',`return !d.activeElement.closest('[data-testid="map-viewport"]')&&d.activeElement!==d.body`),'no-prerequisites canvas trapped focus');
    finish(5,'Selected task reached once in List; no-prerequisites statement spoken without false certainty.');

    currentStep=6;
    await d.show(['page','panel'],600);
    await focus('panel',await button('panel','focus-jump-working'));await quiet();
    await action(6,'Rail canonical task reveal',async()=>{xkey('Return');await d.wait('panel',`d.activeElement?.dataset?.testid==='item-B'`);});
    await focus('panel',await button('panel','plan-view-map'));await quiet();
    const rail=await action(6,'Rail List to Map',async()=>{xkey('Return');await ready('panel');});
    expect(await selected('panel')==='B'&&(await active('panel'))==='map-card-B','rail handoff target/focus');
    expect(once(rail,'Build a deliberately long Unicode branch'),'rail selection missing or duplicated across frames');
    const pressed=await action(6,'Read active rail view',async()=>focus('panel',await button('panel','plan-view-map')));
    expect(/pressed|selected/i.test(pressed.join(' ')),'active rail view not spoken');
    await action(6,'Rail inspector relationship',()=>focus('panel','[data-testid="map-relation-A"]'));
    await action(6,'Rail 360 px',()=>d.evaluate(`document.getElementById('narrow').click();true`));
    expect(await selected('panel')==='B'&&await d.guest('panel',`return w.innerWidth===360`),'narrow rail lost selection/width');
    const listSelector=await button('panel','map-list');
    let nativeSteps=0;
    while(!await d.guest('panel',`return d.activeElement?.matches(${JSON.stringify(listSelector)})`)){
      if(++nativeSteps>32)throw Error('Isolated setup: native Shift Tab did not reach rail View as list');
      xkey('shift+Tab');await d.frames2();
    }
    await quiet();
    const back=await action(6,'Rail View as list',async()=>{xkey('Return');await d.wait('panel',`d.activeElement?.dataset?.testid==='item-B'`);});
    writeFileSync(join(d.artifacts,'list-handoff-focus.json'),JSON.stringify({preparation:'native Shift Tab',nativeSteps,active:await active('panel')},null,2)+'\n');
    expect(once(back,'Build a deliberately long Unicode branch'),'rail List handoff task missing or duplicated');const listFocus=await active('panel');
    const repaint=await action(6,'Rail ordinary repaint',async()=>{const mark=await d.evaluate<number>('qa.replies.length');await d.wait('panel',`qa.replies.slice(${mark}).some(r=>r.frame==='panel'&&r.path==='/v1/plans'&&r.status===200)`);});
    expect(!repaint.length&&await active('panel')===listFocus,'rail repaint repeated speech or stole focus');
    finish(6,'Rail pressed view, task handoffs and inspector spoken; 360 px reading and quiet repaint retained.');
    d.check('orca:six-step-speech-text-verification',true);
  }catch(e){
    if(currentStep){results[currentStep-1]={step:currentStep,status:productFailure?'FAIL':'BLOCKED',notes:clean(e instanceof Error?e.message:String(e))};}
    throw e;
  }finally{
    writeFileSync(join(d.artifacts,'focus-events.txt'),clean(text().split('\n').filter(s=>/object:state-changed:focused|FOCUS MANAGER:|KEYBOARD EVENT:/.test(s)).join('\n'))+'\n');
    writeFileSync(join(d.artifacts,'speech-diagnostics.txt'),clean(text().split('\n').filter(s=>/SPEECH|Speaking|speech|interrupt|PRESENT|locus_of_focus_changed/.test(s)).slice(-400).join('\n'))+'\n');
    writeFileSync(join(d.artifacts,'transcript.json'),JSON.stringify(transcript,null,2)+'\n');
    writeFileSync(join(d.artifacts,'steps.json'),JSON.stringify(results,null,2)+'\n');
    writeFileSync(join(d.artifacts,'outcome.json'),JSON.stringify({passed:results.every(r=>r.status==='PASS'),productFailure,steps:results,humanListenerAcceptance:false,method:'Real Orca final speech-dispatcher SSML dispatch text (includes Say All), sd_dummy; private Xvfb/session/AT-SPI, native X keys; DOM used only for setup and focus/state assertions'},null,2)+'\n');
  }
}
