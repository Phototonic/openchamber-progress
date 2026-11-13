import { existsSync, readFileSync, realpathSync, lstatSync, writeFileSync, renameSync, unlinkSync, closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBinding, verifyStore, type Binding } from '../shared/binding.ts';
import { Store, storageError, digest, canonical } from '../shared/store.ts';
import { ProgressError, type Code, type SetupRead, type ManagedSetupAction, type ManagedReview, type ManagedMigrationState } from '../shared/progress.ts';
import { managedBindingFile, managedSourceRoots, managedPath, readManagedBinding, createManagedBindingDirectory, publishPrivateJson, ManagedBindingError, readManagedExpectation, writeManagedExpectation } from '../shared/managed-binding.ts';
import { activationFingerprint } from '../shared/activation.ts';
import { lifecycle, normalizeTargets, SetupError, type Targets, type Payload, type Action } from '../setup/lifecycle.ts';
import {legacyMigration,readMigration,writeMigration,sameMigrationTarget,removalRecorded,migrationError,type MigrationRecord} from '../setup/managed-migration.ts';
import { setupSuggestions, type HostPathContext } from './suggestions.ts';
import { windows, windowsPath, privatePaths, privateDirectory, isOwned, platformSecurityScope, syncFile, syncDirectory, PlatformError, sameWindowsDirectory, sameWindowsObject } from '../shared/platform.ts';

/** Only the trusted service entry chooses bindingFile/payload; HTTP cannot. */
export class SetupController {
  private store?: Store; private binding?: Binding; private error: Code = 'binding';
  private expectedDescriptor: string | null = null; private canPersist = true;
  private securityUnavailable = false;
  private activation = 'unknown';
  private readonly readonlyPayload: () => Payload;
  private readonly suggestionContext?:HostPathContext;
  private readonly managedEnv?: NodeJS.ProcessEnv;
  private readonly reviewNonce = randomUUID();
  private managedDiagnostic: string | undefined;
  private migrationDiagnostic: string | undefined;
  constructor(privateFile: string | { env: NodeJS.ProcessEnv }, readonlyPayload: () => Payload, _legacyDefault?:string, suggestionContext?:HostPathContext) {
    this.readonlyPayload=readonlyPayload;this.suggestionContext=suggestionContext;
    if(typeof privateFile !== 'string') {
      this.managedEnv={...privateFile.env};this.bindingFile='';this.refresh();
      // One admitted package generation may establish its baseline; GET/status never rewrites it.
      if(this.store&&this.binding)try{this.establishExpectation(this.binding);}catch{/* Unknown expectation is not authorization. */}
      return;
    }
    this.bindingFile=privateFile;
    if(lstatSync(privateFile,{throwIfNoEntry:false})) {
      try { this.binding=readBinding(privateFile);this.expectedDescriptor=digest(readFileSync(privateFile)); }
      catch(e) {this.recordError(e);this.canPersist=false;}
    }
    this.refresh();
  }
  private readonly bindingFile: string;
  current() { this.refresh();return {store:this.store,error:this.error,configured:!!this.binding}; }
  close() {this.store?.close();this.store=undefined;}
  private load(b:Binding) {
    let next:Store;
    try{next=new Store(b.database);}catch(e){if(e instanceof PlatformError)throw e;const error=storageError(e);throw error.code==='binding'||error.code==='not-found'?new ProgressError('storage'):error;}
    // Validate optional run storage before admitting the store, not later in
    // /health capability discovery where a schema refusal fails host readiness.
    try{verifyStore(next,b);next.subagentRunStorage();next.bindReads(b.source.id,b.source.verified);}catch(e){next.close();throw e;}
    this.store?.close();this.store=next;this.binding=b;this.securityUnavailable=false;
  }
  private recordError(e:unknown) {this.error=storageError(e).code;this.securityUnavailable=e instanceof PlatformError&&e.code==='windows-security-unavailable';}
  private refresh() {
    if(this.managedEnv) {
      try {
        const b=readManagedBinding(this.managedEnv);
        if(!b){
          if(this.expectedDescriptor!==null)throw new ManagedBindingError('managed-binding-modified');
          this.close();this.binding=undefined;this.managedDiagnostic=undefined;this.error='binding';return;
        }
        const descriptor=digest(readFileSync(managedBindingFile(this.managedEnv)));
        if(this.expectedDescriptor!==null&&descriptor!==this.expectedDescriptor)throw new ManagedBindingError('managed-binding-modified');
        this.binding=b;this.expectedDescriptor=descriptor;
        this.load(b);this.managedDiagnostic=undefined;
      }catch(e){this.close();this.recordError(e);this.managedDiagnostic=e instanceof ManagedBindingError||e instanceof PlatformError?e.code:storageError(e).code;}
      return;
    }
    if(!this.binding)return;
    // One bounded attempt per request, never a retry loop or a cached failure.
    try{this.load(this.binding);}catch(e){this.store?.close();this.store=undefined;this.recordError(e);}
  }
  private targets():Targets|undefined {const b=this.binding;return b?{configRoot:b.source.configRoot,dataRoot:b.source.dataRoot,storeRoot:path.dirname(b.database),confirmed:true}:undefined;}
  status(includeSuggestions=false):SetupRead {
    if(this.managedEnv)return this.managedStatus();
    this.refresh();
    const targets=this.targets();
    if(!targets){
      const suggestions=includeSuggestions?setupSuggestions(this.suggestionContext):undefined;
      return {configured:false,verified:false,installed:false,captureEnabled:null,targets:null,version:null,activation:'unknown',separateLifecycle:true,historyRetained:true,diagnostics:[...(!this.canPersist?['service-binding-collision']:[]),...(this.securityUnavailable?['windows-security-unavailable']:[]),this.error==='binding'?'targets-unverified':this.error],...(suggestions?{suggestions}:{})};
    }
    const base:SetupRead={configured:true,verified:this.binding!.source.verified,installed:false,captureEnabled:this.store?this.store.list({limit:1}).captureEnabled:null,targets:{configRoot:targets.configRoot,dataRoot:targets.dataRoot,storeRoot:targets.storeRoot},version:null,activation:this.activation,separateLifecycle:true,historyRetained:true,diagnostics:this.store?[]:[...(this.securityUnavailable?['windows-security-unavailable']:[]),this.error]};
    if(this.store)base.reportingIdentity={storeId:this.binding!.storeId,sourceId:this.binding!.source.id,verified:this.binding!.source.verified};
    let payload:Payload|undefined;
    if(this.store&&base.verified)try{payload=this.readonlyPayload();}catch{/* Missing bundled bytes make no update claim. */}
    try{const info=lifecycle('inspect',targets,payload);base.installed=info.installed;base.recovery=info.recovery;base.version=info.version;base.diagnostics.push(...info.diagnostics);
      if('update' in info&&info.update)base.update=info.update;
      if(info.installed)base.activation=this.store&&info.fingerprint&&this.store.loadedFingerprint(this.binding!.source.id,this.binding!.installId)===info.fingerprint?'control-applies-to-loaded-instances':'reload-required';
    }
    catch(e){base.diagnostics.push(e instanceof SetupError?e.code:'setup-unavailable');}
    return base;
  }
  run(action:Action|ManagedSetupAction,body:unknown):SetupRead {
    if(this.managedEnv) {
      if(!action.startsWith('managed-'))throw new SetupError('managed-action-required');
      return this.runManaged(action as ManagedSetupAction,body);
    }
    if(action.startsWith('managed-'))throw new SetupError('managed-service-required');
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
      const current=this.targets();if(!current||!(windows?platformSecurityScope(()=>sameWindowsDirectory(current.configRoot,targets.configRoot)&&sameWindowsDirectory(current.dataRoot,targets.dataRoot)&&sameWindowsDirectory(current.storeRoot,targets.storeRoot)):current.configRoot===targets.configRoot&&current.dataRoot===targets.dataRoot&&current.storeRoot===targets.storeRoot))throw new SetupError('ownership-invalid');
    }
    if(action==='install'||action==='update'){
      this.validateDescriptor();
      lifecycle('inspect',targets);
      // A retained store must be readable or an exact supported activation input
      // before selecting payloads. This check never initializes run storage.
      const database=path.join(targets.storeRoot,'progress.sqlite');
      if(existsSync(database)){
        const probe=new Store(database,{readOnly:true});
        try{probe.subagentRunStorage();}finally{probe.close();}
      }
    }
    const result=lifecycle(action as Action,targets,action==='install'||action==='update'?this.readonlyPayload():undefined);
    if(action==='install'||action==='update') {
      const b=readBinding(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'));
      try{this.persist(b);this.load(b);}
      catch(e){
        // Storage may have been upgraded after preflight. The selected companion
        // also refuses schema; never disable capture through unknown run DDL.
        if(e instanceof ProgressError&&e.code==='schema'){this.close();this.recordError(e);throw e;}
        // Files may already be selected. Never leave an unacknowledged install
        // writing while the host binding could not be persisted/validated.
        let disabled=false;let control:Store|undefined;
        try{control=new Store(b.database);verifyStore(control,b);control.disableCaptureIfSupported();disabled=true;}
        catch(e){if(e instanceof ProgressError&&e.code==='schema'){this.close();this.recordError(e);throw e;}}
        finally{control?.close();}
        throw new SetupError(disabled?'service-binding-unavailable-capture-disabled':'service-binding-unavailable');
      }
    }
    if(!['disable','enable'].includes(action)||this.activation!=='reload-required')this.activation=result.activation;
    return {...this.status(),action};
  }
  /** Existing no-body capture control route: valid binding required; never global executable ownership. */
  enableCapture() {
    if(!this.managedEnv){this.run('enable',{confirmed:true});return;}
    this.refresh();
    if(!this.store||!this.binding)throw new ProgressError(this.error);
    if(!this.binding.source.verified)throw new ProgressError('source-unverified');
    const migration=this.managedMigration(this.targets()!);
    if(migration!=='none'&&migration!=='complete')throw new SetupError('managed-migration-required');
    this.store.setEnabled(true);
  }
  private establishExpectation(b:Binding) {
    const payload=this.readonlyPayload();
    const fingerprint=activationFingerprint({...b,version:payload.version},Buffer.from(payload.plugin),Buffer.from(payload.guidance));
    const prior=readManagedExpectation(b);
    if(prior?.version===payload.version&&prior.fingerprint===fingerprint)return;
    writeManagedExpectation(b,{format:1,storeId:b.storeId,sourceId:b.source.id,installId:b.installId,version:payload.version,fingerprint});
  }
  private managedMigration(_targets?:Targets):ManagedMigrationState {
    this.migrationDiagnostic=undefined;
    try{
      const record=readMigration(this.managedEnv!),legacy=legacyMigration(this.managedEnv!);
      if(record){
        if(record.phase==='complete'&&(!this.binding||legacy))return 'conflict';
        if(this.binding&&canonical(this.binding)!==canonical(record.binding))return 'conflict';
        if(legacy&&!sameMigrationTarget(legacy.binding,record.binding))return 'conflict';
        return record.phase==='complete'&&!legacy?'complete':'pending';
      }
      if(legacy&&this.binding&&!sameMigrationTarget(legacy.binding,this.binding))return 'conflict';
      return legacy?'available':'none';
    }
    catch(e){const error=migrationError(e);if(error instanceof SetupError)return 'conflict';this.migrationDiagnostic=error.code;return 'unavailable';}
  }
  private managedStatus():SetupRead {
    this.refresh();
    const b=this.binding,targets=this.targets();
    const base:SetupRead={configured:!!b,verified:!!this.store&&!!b?.source.verified,installed:false,captureEnabled:this.store?this.store.list({limit:1}).captureEnabled:null,
      targets:targets?{configRoot:targets.configRoot,dataRoot:targets.dataRoot,storeRoot:targets.storeRoot}:null,
      version:null,activation:'unknown',separateLifecycle:false,historyRetained:true,diagnostics:this.managedDiagnostic?[this.managedDiagnostic]:[],
      delivery:{kind:'managed',revision:1,configuration:this.managedDiagnostic?'invalid':b?'configured':'unconfigured',migration:this.managedMigration(targets),mode:'unknown',observation:'unknown',expectedVersion:null}};
    if(this.migrationDiagnostic&&!base.diagnostics.includes(this.migrationDiagnostic))base.diagnostics.push(this.migrationDiagnostic);
    if(this.store&&b) {
      base.reportingIdentity={storeId:b.storeId,sourceId:b.source.id,verified:b.source.verified};
      try {
        const expected=readManagedExpectation(b);
        if(expected){base.delivery!.expectedVersion=expected.version;base.version=expected.version;
          const loaded=this.store.loadedFingerprint(b.source.id,b.installId);
          base.delivery!.observation=loaded===null?'not-observed':loaded===expected.fingerprint?'matching':'different';}
      }catch{base.diagnostics.push('managed-expectation-unavailable');}
    }
    return base;
  }
  /** Read-only candidate validation. The token binds consent to current selection, source and store identity. */
  private managedCandidate(storeRoot?:string): {review:ManagedReview;binding?:Binding;targets:Targets} {
    try{return this.managedFullCandidate(storeRoot);}
    catch(e){
      // A failed legacy preflight cannot revoke the user's capture-off control.
      // This narrower review authorizes no migration, configuration or enable.
      if(!readManagedBinding(this.managedEnv!))throw e;
      return this.managedControlCandidate(storeRoot);
    }
  }
  private managedControlCandidate(storeRoot?:string): {review:ManagedReview;binding:Binding;targets:Targets} {
    this.refresh();
    if(!this.store||!this.binding)throw new ProgressError(this.error);
    const b=this.binding,targets=this.targets()!;
    if(!b.source.verified)throw new ProgressError('source-unverified');
    if(storeRoot!==undefined&&managedPath(storeRoot)!==targets.storeRoot)throw new SetupError('managed-selection-conflict');
    const file=managedBindingFile(this.managedEnv!),stat=lstatSync(b.database),descriptor=lstatSync(file);
    const expected=digest(JSON.stringify({nonce:this.reviewNonce,controlOnly:true,binding:b,descriptor:digest(readFileSync(file)),
      descriptorObject:[descriptor.dev,descriptor.ino,descriptor.mode,descriptor.uid],storeObject:[stat.dev,stat.ino,stat.mode,stat.uid],enabled:this.store.list({limit:1}).captureEnabled}));
    return {review:{expected,targets,storeId:b.storeId,sourceId:b.source.id},binding:b,targets};
  }
  private managedFullCandidate(storeRoot?:string): {review:ManagedReview;binding?:Binding;targets:Targets} {
    const env=this.managedEnv!,roots=managedSourceRoots(env),file=managedBindingFile(env),b=readManagedBinding(env);
    const record=readMigration(env),legacy=legacyMigration(env);
    if(record&&(b?canonical(record.binding)!==canonical(b):record.phase==='complete')||legacy&&b&&!sameMigrationTarget(legacy.binding,b)||legacy&&record&&!sameMigrationTarget(legacy.binding,record.binding))throw new SetupError('managed-migration-conflict');
    if(this.expectedDescriptor!==null&&(!b||digest(readFileSync(file))!==this.expectedDescriptor))throw new ManagedBindingError('managed-binding-modified');
    const retained=b??record?.binding??legacy?.binding;
    const selected=managedPath(storeRoot??(retained?path.dirname(retained.database):path.join(roots.dataRoot,'openchamber-progress')),true);
    if([roots.configRoot,roots.dataRoot,path.dirname(file)].includes(selected))throw new SetupError('managed-selection-conflict');
    const targets={...roots,storeRoot:selected,confirmed:true};
    lifecycle('inspect',targets); // canonical owned roots, private store, complete legacy ownership if present
    if(lstatSync(selected,{throwIfNoEntry:false})&&!isOwned(selected))throw new SetupError('store-permissions');
    if(retained&&path.dirname(retained.database)!==selected)throw new SetupError(legacy||record?'managed-migration-conflict':'managed-selection-conflict');
    let storeId:string|null=null,sourceId:string|null=null,sources:unknown=[],enabled:unknown=null;
    const database=path.join(selected,'progress.sqlite');
    if(lstatSync(database,{throwIfNoEntry:false})) {
      const store=new Store(database,{readOnly:true});
      try {
        store.subagentRunStorage();if(retained)verifyStore(store,retained);
        const e=store.list({limit:1});storeId=e.storeId;sources=e.sources;enabled=e.captureEnabled;
        const matches=e.sources.filter(s=>s.configRoot===roots.configRoot&&s.dataRoot===roots.dataRoot);
        if(matches.length>1||matches.some(s=>!s.verified))throw new SetupError('managed-source-conflict');
        sourceId=matches[0]?.id??null;
      }finally{store.close();}
    }else if(b)throw new ProgressError('storage');
    const identity=(p:string)=>{const s=lstatSync(p,{throwIfNoEntry:false});return s?[s.dev,s.ino,s.mode,s.uid]:null;};
    const expected=digest(JSON.stringify({nonce:this.reviewNonce,targets,descriptor:b?digest(readFileSync(file)):null,
      descriptorObject:identity(file),storeObject:identity(database),rootObject:identity(selected),storeId,sourceId,sources,enabled,
      migration:record??null,legacy:legacy?{fingerprint:lifecycle('inspect',targets).fingerprint,ownership:digest(readFileSync(path.join(roots.configRoot,'plugins/agent-progress/.ownership.json')))}:null}));
    return {review:{expected,targets:{...roots,storeRoot:selected},storeId,sourceId},binding:b,targets};
  }
  private runManaged(action:ManagedSetupAction,body:unknown):SetupRead {
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ProgressError('invalid');
    const r=body as Record<string,unknown>;
    if(!Object.keys(r).every(k=>['storeRoot','confirmed','expected'].includes(k))||
      r.storeRoot!==undefined&&(typeof r.storeRoot!=='string'||!r.storeRoot.length||r.storeRoot.length>4096)||
      r.confirmed!==undefined&&typeof r.confirmed!=='boolean'||r.expected!==undefined&&(typeof r.expected!=='string'||!/^[a-f0-9]{64}$/.test(r.expected)))throw new ProgressError('invalid');
    // Only inspection and capture-off admit the narrower verified-Store review.
    const candidate=action==='managed-inspect'||action==='managed-disable'
      ?this.managedCandidate(r.storeRoot as string|undefined):this.managedFullCandidate(r.storeRoot as string|undefined);
    if(action==='managed-inspect') {
      if(r.confirmed!==undefined||r.expected!==undefined)throw new ProgressError('invalid');
      const status=this.managedStatus();status.delivery!.review=candidate.review;
      status.delivery!.migration=this.managedMigration(candidate.targets);return {...status,action};
    }
    if(r.confirmed!==true)throw new SetupError('confirmation-required');
    if(r.expected!==candidate.review.expected)throw new SetupError('managed-review-stale');
    if(action==='managed-migrate')return this.migrate(candidate);
    if(!['managed-configure','managed-enable','managed-disable'].includes(action))throw new ProgressError('invalid');
    if(action!=='managed-disable'&&!['none','complete'].includes(this.managedMigration(candidate.targets)))throw new SetupError('managed-migration-required');
    if(action==='managed-enable'||action==='managed-disable') {
      this.refresh();if(!this.store||!this.binding)throw new ProgressError(this.error);
      this.store.setEnabled(action==='managed-enable');return {...this.managedStatus(),action};
    }
    if(candidate.binding)return {...this.managedStatus(),action}; // same-target confirmation is harmless
    const file=createManagedBindingDirectory(this.managedEnv!);
    const lock=path.join(path.dirname(file),'.configuration-lock');
    let locked=false;
    try {
      try{closeSync(openSync(lock,'wx',0o600));locked=true;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new SetupError('managed-configuration-busy');throw e;}
      // Directory creation legitimately changes the review's missing-root facts, not the selected store.
      if(readManagedBinding(this.managedEnv!))throw new SetupError('managed-review-stale');
      const latest=this.managedCandidate(r.storeRoot as string|undefined);
      if(latest.review.expected!==candidate.review.expected)throw new SetupError('managed-review-stale');
      const {targets}=candidate;
      if(!lstatSync(targets.storeRoot,{throwIfNoEntry:false}))privateDirectory(targets.storeRoot,true);
      if(!isOwned(targets.storeRoot)||!privatePaths([targets.storeRoot]))throw new SetupError('store-permissions');
      const store=new Store(path.join(targets.storeRoot,'progress.sqlite'),{create:true});
      let b:Binding;
      try {
        store.subagentRunStorage();const e=store.list({limit:1});
        const source=e.sources.find(s=>s.id===candidate.review.sourceId)??{id:randomUUID(),...managedSourceRoots(this.managedEnv!),verified:true};
        store.registerSource(source);
        // Stable same-target managed identity permits explicit recovery after publication failure,
        // but can never match a legacy install's random identity.
        b={protocolVersion:2,schemaVersion:2,installId:`managed-${digest(JSON.stringify([e.storeId,source]))}`,version:this.readonlyPayload().version,database:store.file,storeId:e.storeId,source};
        verifyStore(store,b);this.establishExpectation(b);
        publishPrivateJson(file,b);
      }finally{store.close();}
      this.refresh();return {...this.managedStatus(),action};
    }finally{if(locked){unlinkSync(lock);syncDirectory(path.dirname(file));}}
  }
  private migrate(candidate:ReturnType<SetupController['managedCandidate']>):SetupRead {
    const env=this.managedEnv!,prior=readMigration(env),legacy=legacyMigration(env);
    if(prior?.phase==='complete'&&legacy)throw new SetupError('managed-migration-conflict');
    if(prior?.phase==='complete'&&!legacy)return {...this.managedStatus(),action:'managed-migrate'};
    if(!prior&&!legacy)throw new SetupError('managed-migration-required');
    const retained=prior?.binding??legacy!.binding;
    if(legacy&&candidate.binding?.installId===legacy.binding.installId)throw new SetupError('managed-migration-conflict');
    if(candidate.binding&&!sameMigrationTarget(candidate.binding,retained)||path.dirname(retained.database)!==candidate.targets.storeRoot)throw new SetupError('managed-migration-conflict');
    if(legacy&&(!sameMigrationTarget(legacy.binding,retained)||prior&&legacy.binding.installId!==prior.legacyInstallId))throw new SetupError('managed-migration-conflict');
    if(!legacy&&(!prior||prior.phase==='pending'&&!removalRecorded(prior)))throw new SetupError('managed-migration-pending');
    const file=createManagedBindingDirectory(env),lock=path.join(path.dirname(file),'.configuration-lock');let locked=false;
    try{
      try{closeSync(openSync(lock,'wx',0o600));locked=true;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new SetupError('managed-configuration-busy');throw e;}
      if(this.managedCandidate(candidate.targets.storeRoot).review.expected!==candidate.review.expected)throw new SetupError('managed-review-stale');
      const store=new Store(retained.database);
      try{
        verifyStore(store,retained);store.subagentRunStorage();
        const binding=prior?.binding??candidate.binding??{...retained,installId:`managed-${digest(JSON.stringify([retained.storeId,retained.source]))}`,version:this.readonlyPayload().version};
        const record:MigrationRecord=prior??{binding,phase:'pending',legacyInstallId:legacy!.binding.installId};
        // Full owned()+selector+actual Store/source validation above precedes even disable.
        store.setEnabled(false);writeMigration(env,record);
        if(legacy)lifecycle('remove-capture',candidate.targets);
        record.phase='removed';writeMigration(env,record);
        this.establishExpectation(binding);
        if(!candidate.binding)publishPrivateJson(file,binding);
        record.phase='complete';writeMigration(env,record);
        store.setEnabled(true);
      }finally{store.close();}
      this.refresh();return {...this.managedStatus(),action:'managed-migrate'};
    }finally{if(locked){unlinkSync(lock);syncDirectory(path.dirname(file));}}
  }
  private validateDescriptor() {
    try{return platformSecurityScope(()=>this.validateDescriptorInner());}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}
  }
  private validateDescriptorInner() {
    if(!this.canPersist)throw new SetupError('service-binding-collision');
    const parent=path.dirname(this.bindingFile);
    if(!lstatSync(parent).isDirectory()||(!windows&&realpathSync(parent)!==parent))throw new SetupError('service-binding-collision');
    if(windows&&(!sameWindowsDirectory(windowsPath(parent),parent)||!privatePaths([parent])))throw new SetupError('service-binding-collision');
    const stat=lstatSync(this.bindingFile,{throwIfNoEntry:false});
    if(stat) {
      if(windows&&(!sameWindowsObject(windowsPath(this.bindingFile),this.bindingFile)||!privatePaths([this.bindingFile])))throw new SetupError('service-binding-modified');
      if(stat.isSymbolicLink()||this.expectedDescriptor===null||digest(readFileSync(this.bindingFile))!==this.expectedDescriptor)throw new SetupError('service-binding-modified');
    }else if(this.expectedDescriptor!==null)throw new SetupError('service-binding-modified');
  }
  private persist(b:Binding) {
    this.validateDescriptor();
    const file=`${this.bindingFile}.stage-${randomUUID()}`;const text=JSON.stringify(b);
    writeFileSync(file,text,{mode:0o600,flag:'wx'});syncFile(file);
    renameSync(file,this.bindingFile);syncDirectory(path.dirname(file));
    this.expectedDescriptor=digest(text);
  }
}
