import { existsSync, readFileSync, realpathSync, lstatSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBinding, verifyStore, type Binding } from '../shared/binding.ts';
import { Store, storageError, digest } from '../shared/store.ts';
import { ProgressError, type Code, type SetupRead } from '../shared/progress.ts';
import { lifecycle, normalizeTargets, SetupError, type Targets, type Payload, type Action } from '../setup/lifecycle.ts';
import { setupSuggestions, type HostPathContext } from './suggestions.ts';

/** Only the trusted service entry chooses bindingFile/payload; HTTP cannot. */
export class SetupController {
  private store?: Store; private binding?: Binding; private error: Code = 'binding';
  private expectedDescriptor: string | null = null; private canPersist = true;
  private activation = 'unknown';
  private readonly readonlyPayload: () => Payload;
  private readonly suggestionContext?:HostPathContext;
  constructor(privateFile: string, readonlyPayload: () => Payload, legacyDefault?:string, suggestionContext?:HostPathContext) {
    this.bindingFile=privateFile;this.readonlyPayload=readonlyPayload;this.suggestionContext=suggestionContext;
    if(lstatSync(privateFile,{throwIfNoEntry:false})) {
      try { this.binding=readBinding(privateFile);this.expectedDescriptor=digest(readFileSync(privateFile)); }
      catch(e) {this.error=storageError(e).code;this.canPersist=false;}
    }else if(legacyDefault&&existsSync(legacyDefault)) {
      // One-way adoption of a valid package default. Stable state always wins;
      // never mutate a legacy package file or replace a stable foreign file.
      try{const b=readBinding(legacyDefault);this.persist(b);this.binding=b;}
      catch(e){this.error=storageError(e).code;}
    }
    this.refresh();
  }
  private readonly bindingFile: string;
  current() { this.refresh();return {store:this.store,error:this.error,configured:!!this.binding}; }
  close() {this.store?.close();this.store=undefined;}
  private load(b:Binding) {
    let next:Store;
    try{next=new Store(b.database);}catch(e){const error=storageError(e);throw error.code==='binding'||error.code==='not-found'?new ProgressError('storage'):error;}
    try{verifyStore(next,b);next.bindReads(b.source.id,b.source.verified);}catch(e){next.close();throw e;}
    this.store?.close();this.store=next;this.binding=b;
  }
  private refresh() {
    if(!this.binding)return;
    // One bounded attempt per request, never a retry loop or a cached failure.
    try{this.load(this.binding);}catch(e){this.store?.close();this.store=undefined;this.error=storageError(e).code;}
  }
  private targets():Targets|undefined {const b=this.binding;return b?{configRoot:b.source.configRoot,dataRoot:b.source.dataRoot,storeRoot:path.dirname(b.database),confirmed:true}:undefined;}
  status(includeSuggestions=false):SetupRead {
    this.refresh();
    const targets=this.targets();
    if(!targets){
      const suggestions=includeSuggestions?setupSuggestions(this.suggestionContext):undefined;
      return {configured:false,verified:false,installed:false,captureEnabled:null,targets:null,version:null,activation:'unknown',separateLifecycle:true,historyRetained:true,diagnostics:[...(!this.canPersist?['service-binding-collision']:[]),this.error==='binding'?'targets-unverified':this.error],...(suggestions?{suggestions}:{})};
    }
    const base:SetupRead={configured:true,verified:this.binding!.source.verified,installed:false,captureEnabled:this.store?this.store.list({limit:1}).captureEnabled:null,targets:{configRoot:targets.configRoot,dataRoot:targets.dataRoot,storeRoot:targets.storeRoot},version:null,activation:this.activation,separateLifecycle:true,historyRetained:true,diagnostics:this.store?[]:[this.error]};
    try{const info=lifecycle('inspect',targets);base.installed=info.installed;base.recovery=info.recovery;base.version=info.version;base.diagnostics.push(...info.diagnostics);
      if(info.installed)base.activation=this.store&&info.fingerprint&&this.store.loadedFingerprint(this.binding!.source.id,this.binding!.installId)===info.fingerprint?'control-applies-to-loaded-instances':'reload-required';
    }
    catch(e){base.diagnostics.push(e instanceof SetupError?e.code:'setup-unavailable');}
    return base;
  }
  run(action:Action,body:unknown):SetupRead {
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ProgressError('invalid');
    const r=body as Record<string,unknown>;
    if(!Object.keys(r).every(k=>['configRoot','dataRoot','storeRoot','confirmed'].includes(k)) || r.confirmed!==undefined&&typeof r.confirmed!=='boolean')throw new ProgressError('invalid');
    const hasTargets=['configRoot','dataRoot','storeRoot'].some(k=>r[k]!==undefined);
    if(hasTargets&&!['configRoot','dataRoot','storeRoot'].every(k=>typeof r[k]==='string'&&(r[k]as string).length>0&&(r[k]as string).length<=4096))throw new ProgressError('invalid');
    const chosen=hasTargets?{configRoot:r.configRoot as string,dataRoot:r.dataRoot as string,storeRoot:r.storeRoot as string,confirmed:r.confirmed===true}:this.targets();
    if(!chosen)throw new SetupError('targets-unverified');
    const targets=normalizeTargets({...chosen,confirmed:r.confirmed===true});
    if(action==='inspect') {
      const info=lifecycle('inspect',targets);
      return {configured:!!this.binding,verified:targets.confirmed,installed:info.installed,captureEnabled:null,targets:{configRoot:targets.configRoot,dataRoot:targets.dataRoot,storeRoot:targets.storeRoot},version:info.version,activation:'unknown',separateLifecycle:true,historyRetained:true,diagnostics:info.diagnostics,recovery:info.recovery,action};
    }
    if(!targets.confirmed)throw new SetupError('confirmation-required');
    if(['disable','enable','remove-capture'].includes(action)) {
      const current=this.targets();if(!current||current.configRoot!==targets.configRoot||current.dataRoot!==targets.dataRoot||current.storeRoot!==targets.storeRoot)throw new SetupError('ownership-invalid');
    }
    if(action==='install'||action==='update')this.validateDescriptor();
    const result=lifecycle(action,targets,action==='install'||action==='update'?this.readonlyPayload():undefined);
    if(action==='install'||action==='update') {
      const b=readBinding(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'));
      try{this.persist(b);this.load(b);}
      catch{
        // Files may already be selected. Never leave an unacknowledged install
        // writing while the host binding could not be persisted/validated.
        let disabled=false;let control:Store|undefined;
        try{control=new Store(b.database);verifyStore(control,b);control.setEnabled(false);disabled=true;}catch{}finally{control?.close();}
        throw new SetupError(disabled?'service-binding-unavailable-capture-disabled':'service-binding-unavailable');
      }
    }
    if(!['disable','enable'].includes(action)||this.activation!=='reload-required')this.activation=result.activation;
    return {...this.status(),action};
  }
  private validateDescriptor() {
    if(!this.canPersist)throw new SetupError('service-binding-collision');
    const parent=path.dirname(this.bindingFile);
    if(realpathSync(parent)!==parent||!lstatSync(parent).isDirectory())throw new SetupError('service-binding-collision');
    const stat=lstatSync(this.bindingFile,{throwIfNoEntry:false});
    if(stat) {
      if(stat.isSymbolicLink()||this.expectedDescriptor===null||digest(readFileSync(this.bindingFile))!==this.expectedDescriptor)throw new SetupError('service-binding-modified');
    }else if(this.expectedDescriptor!==null)throw new SetupError('service-binding-modified');
  }
  private persist(b:Binding) {
    this.validateDescriptor();
    const file=`${this.bindingFile}.stage-${randomUUID()}`;const text=JSON.stringify(b);
    writeFileSync(file,text,{mode:0o600,flag:'wx'});const fd=openSync(file,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(file,this.bindingFile);const dir=openSync(path.dirname(file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
    this.expectedDescriptor=digest(text);
  }
}
