import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, lstatSync, openSync, readSync, closeSync, realpathSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { windows, windowsPath, windowsPaths, privatePaths, beginPlatformSecurityScope, PlatformError, sameWindowsDirectory, sameWindowsObject } from './platform.ts';
import { VERSION, LIMITS, ProgressError, requireProgress as need, parseRequest, countItems, type Request, type Actor, type Source, type Capture, type PlanState, type PlanSummary, type Receipt, type Item, type ItemInput, type Envelope, type PlanRead, type DocumentRead, type Contribution } from './progress.ts';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
/** Presentation-only Windows spelling equivalence; never case-fold directory names. */
function directoryFilter(value:string|undefined) {return windows?value?.replaceAll('\\','/').replace(/^[a-z]:/i,drive=>drive.toUpperCase()):value;}
function directoryExpression(expression:string) {
  if(!windows)return expression;
  const separators=`replace(${expression},char(92),'/')`;
  return `(CASE WHEN substr(${expression},1,1) GLOB '[A-Za-z]' AND substr(${expression},2,1)=':' THEN upper(substr(${expression},1,1))||substr(${separators},2) ELSE ${separators} END)`;
}
export function storageError(e: unknown): ProgressError {
  if (e instanceof ProgressError) return e;
  const err = e as { errcode?: number; message?: string };
  if ([5,6].includes(err?.errcode ?? 0) || /locked|busy/i.test(err?.message ?? '')) return new ProgressError('busy');
  if ([11,26].includes(err?.errcode ?? 0) || /malformed|not a database/i.test(err?.message ?? '')) return new ProgressError('corrupt');
  return new ProgressError('storage');
}
const SCHEMA = `
CREATE TABLE meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), product TEXT NOT NULL CHECK(product='openchamber-agent-progress'));
CREATE TABLE sources(id TEXT PRIMARY KEY, config_root TEXT NOT NULL, data_root TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified IN(0,1)), UNIQUE(config_root,data_root));
CREATE TABLE plans(source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), PRIMARY KEY(source,id));
CREATE TABLE revisions(source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), actor TEXT NOT NULL CHECK(json_valid(actor)), PRIMARY KEY(source,plan,revision), FOREIGN KEY(source,plan) REFERENCES plans(source,id));
CREATE TABLE receipts(source TEXT NOT NULL REFERENCES sources(id), plan TEXT NOT NULL, oid TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)), PRIMARY KEY(source,plan,oid));
CREATE TABLE sessions(source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, actor TEXT NOT NULL CHECK(json_valid(actor)), PRIMARY KEY(source,id));
CREATE TABLE chunks(source TEXT NOT NULL REFERENCES sources(id), plan TEXT NOT NULL, owner TEXT NOT NULL, upload TEXT NOT NULL, chunk INTEGER NOT NULL CHECK(chunk>=0 AND chunk<32), expected INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(source,plan,owner,upload,chunk));
CREATE TABLE captures(id INTEGER PRIMARY KEY, source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, captured_at TEXT NOT NULL, canonical_path TEXT NOT NULL);
CREATE TABLE contributions(source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(source,plan,revision), FOREIGN KEY(source,plan,revision) REFERENCES revisions(source,plan,revision));
PRAGMA user_version=2;`;
type StoredPlan = PlanState & { boundCanonicalPath?: string };

export class Store {
  readonly db!: DatabaseSync;
  readonly file: string;
  private readBinding: {sourceId:string|null;verified:boolean}={sourceId:null,verified:false};
  constructor(file: string, options: { create?: boolean; busyMs?: number; readOnly?: boolean } = {}) {
    this.file=file;
    const finish=beginPlatformSecurityScope();
    try {
      if(windows){file=windowsPath(file,true);this.file=file;}
      need(path.isAbsolute(file), 'binding');
      const parent = lstatSync(path.dirname(file)); need(parent.isDirectory() && !parent.isSymbolicLink() && (windows?sameWindowsDirectory(windowsPath(path.dirname(file)),path.dirname(file)):parent.uid===process.getuid?.() && realpathSync(path.dirname(file)) === path.dirname(file) && (parent.mode & 0o777) === 0o700), 'binding');
      const existed = existsSync(file);
      need(existed || (options.create && !options.readOnly), 'not-found');
      if(windows){const secured=[path.dirname(file),file,...['-journal','-wal','-shm'].map(s=>file+s)].filter(existsSync);need(windowsPaths(secured).every((v,i)=>sameWindowsObject(v,secured[i]!))&&privatePaths(secured),'binding');}
      if (existed) {
        const stat = lstatSync(file); need(stat.isFile() && !stat.isSymbolicLink() && (windows||stat.uid===process.getuid?.() && (stat.mode & 0o777) === 0o600), 'binding');
        const fd = openSync(file,'r'); const head = Buffer.alloc(16);
        try { readSync(fd,head,0,16,0); } finally { closeSync(fd); }
        need(head.toString('binary') === 'SQLite format 3\0', 'corrupt');
      }
      this.db = new DatabaseSync(file, { readOnly: options.readOnly ?? false });
      if (!existed) {if(windows)need(privatePaths([file]),'binding');else chmodSync(file, 0o600);}
      this.db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.min(5000, options.busyMs ?? 1000))}; PRAGMA foreign_keys=ON;`);
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (!existed) {
        this.db.exec('BEGIN IMMEDIATE');
        try { this.db.exec(SCHEMA); this.db.prepare("INSERT INTO meta VALUES(1,?,1,'openchamber-agent-progress')").run(randomUUID()); this.db.exec('COMMIT'); }
        catch (e) { this.db.exec('ROLLBACK'); throw e; }
      } else need(version === VERSION, 'schema');
      need(this.db.prepare('PRAGMA table_info(meta)').all().some(r=>r.name==='product'),'corrupt');
      need(this.db.prepare('SELECT product FROM meta WHERE singleton=1').get()?.product==='openchamber-agent-progress', 'corrupt');
    } catch (e) { this.db!?.close(); if(e instanceof PlatformError)throw e;throw storageError(e); }
    finally{finish();}
  }
  close() { this.db.close(); }
  observeLoaded(source:string,installId:string,fingerprint:string) {
    this.transaction(true,()=>{
      // Optional additive runtime metadata: old v2 stores/readers remain valid.
      this.db.exec('CREATE TABLE IF NOT EXISTS loaded_activation(source TEXT PRIMARY KEY REFERENCES sources(id), install_id TEXT NOT NULL, fingerprint TEXT NOT NULL)');
      this.db.prepare('INSERT INTO loaded_activation VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET install_id=excluded.install_id,fingerprint=excluded.fingerprint').run(source,installId,fingerprint);
    });
  }
  loadedFingerprint(source:string,installId:string):string|null {
    return this.transaction(false,()=>{
      if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='loaded_activation'").get())return null;
      const row=this.db.prepare('SELECT fingerprint FROM loaded_activation WHERE source=? AND install_id=?').get(source,installId);
      return row?String(row.fingerprint):null;
    });
  }
  bindReads(sourceId:string,verified:boolean) {const source=this.db.prepare('SELECT verified FROM sources WHERE id=?').get(sourceId);need(source,'binding');this.readBinding={sourceId,verified:verified&&Boolean(source.verified)};}
  private transaction<T>(write: boolean, action: () => T): T {
    try { this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'); }
    catch (e) { throw storageError(e); }
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* original diagnostic wins */ } throw storageError(e); }
  }
  registerSource(source: Source) {
    this.transaction(true, () => {
      const old = this.db.prepare('SELECT * FROM sources WHERE id=?').get(source.id);
      if (old) need(old.config_root === source.configRoot && old.data_root === source.dataRoot && Boolean(old.verified) === source.verified, 'binding');
      else this.db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run(source.id,source.configRoot,source.dataRoot,Number(source.verified));
    });
  }
  setEnabled(enabled: boolean) { this.transaction(true, () => { this.db.prepare('UPDATE meta SET enabled=? WHERE singleton=1').run(Number(enabled)); }); }
  private raw(source: string, id: string): StoredPlan | undefined {
    const row = this.db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(source,id);
    try { if(!row)return undefined;const p=JSON.parse(String(row.snapshot)) as StoredPlan;need(p.sourceId===source&&p.id===id&&Array.isArray(p.items)&&Array.isArray(p.links),'corrupt');return p; } catch { throw new ProgressError('corrupt'); }
  }
  get(source: string, id: string) { return this.transaction(false, () => this.raw(source,id)); }
  private summary(p: StoredPlan): PlanSummary {
    const { items, links: _links, boundCanonicalPath:_bound, ...rest } = p;
    return { ...rest, counts: countItems(items), working: items.filter(i => i.kind === 'task' && i.status === 'working').map(i => i.id) };
  }
  private metadata(): Envelope {
    const meta = this.db.prepare('SELECT * FROM meta WHERE singleton=1').get()!;
    const sources = this.db.prepare('SELECT * FROM sources ORDER BY id').all().map(r => ({ id: String(r.id), configRoot: String(r.config_root), dataRoot: String(r.data_root), verified: Boolean(r.verified) }));
    return { protocolVersion: VERSION, schemaVersion: VERSION, storeId: String(meta.store_id), sources, sourceBinding:{...this.readBinding}, captureEnabled: Boolean(meta.enabled), coverage: 'recorded-only', diagnostics: [...(!meta.enabled ? ['capture-disabled'] : []), ...(sources.some(s => !s.verified) ? ['source-unverified'] : []),...(!this.readBinding.verified?['host-source-binding-unverified']:[])] };
  }
  list(options: { cursor?: number; limit?: number; source?: string; session?: string; directory?: string } = {}) {
    return this.transaction(false, () => {
      const limit = options.limit ?? LIMITS.pageSize; const cursor = options.cursor ?? 0;
      need(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit > 0 && limit <= LIMITS.maxPageSize);
      // JSON predicates select only known fields; values always remain bound parameters.
      const where = ['(? IS NULL OR source=?)',`(? IS NULL OR json_extract(snapshot,'$.sessionId')=? OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=?) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=?))`,`(? IS NULL OR ${directoryExpression("json_extract(snapshot,'$.directory')") }=? OR EXISTS(SELECT 1 FROM sessions s WHERE s.source=plans.source AND ${directoryExpression("json_extract(s.actor,'$.directory')") }=? AND (s.id=json_extract(plans.snapshot,'$.sessionId') OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=s.id) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=s.id))))`].join(' AND ');
      const directory=directoryFilter(options.directory)??null;
      const rows = this.db.prepare(`SELECT snapshot FROM plans WHERE ${where} ORDER BY source,id LIMIT ? OFFSET ?`).all(options.source ?? null,options.source ?? null,options.session ?? null,options.session ?? null,options.session ?? null,options.session ?? null,directory,directory,directory,limit+1,cursor);
      const data = rows.slice(0,limit).map(r => this.summary(JSON.parse(String(r.snapshot))));
      return { ...this.metadata(), data, nextCursor: rows.length > limit ? String(cursor+limit) : null };
    });
  }
  detail(source: string, id: string, page = 0): Envelope & PlanRead {
    return this.transaction(false, () => {
      need(Number.isSafeInteger(page) && page >= 0); const p = this.raw(source,id); need(p, 'not-found');
      const start = page * LIMITS.pageSize; const rows = this.db.prepare('SELECT payload FROM contributions WHERE source=? AND plan=? ORDER BY revision LIMIT ? OFFSET ?').all(source,id,LIMITS.pageSize+1,start);
      return { ...this.metadata(), plan: this.summary(p), links: p.links,
        items: { data: p.items.slice(start,start+LIMITS.pageSize), nextCursor: p.items.length > start+LIMITS.pageSize ? String(page+1) : null },
        contributions: { data: rows.slice(0,LIMITS.pageSize).map(r => JSON.parse(String(r.payload)) as Contribution), nextCursor: rows.length > LIMITS.pageSize ? String(page+1) : null },
      };
    });
  }
  document(source: string, id: string, cursor = 0, captureId?: number): Envelope & DocumentRead {
    return this.transaction(false, () => {
      need(Number.isSafeInteger(cursor) && cursor >= 0); const p = this.raw(source,id); need(p,'not-found');
      if(captureId!==undefined)need(Number.isSafeInteger(captureId)&&captureId>0);
      const chosen = captureId ?? p.document.captureId;
      const capture = chosen === undefined ? undefined : this.db.prepare('SELECT * FROM captures WHERE id=? AND source=? AND plan=?').get(chosen,source,id);
      if(captureId!==undefined)need(capture,'not-found');
      const historical = capture && chosen !== p.document.captureId;
      const envelope = this.metadata();if(historical)envelope.diagnostics.push('historical-capture');
      const document = historical ? {state:'captured' as const,path:String(capture.canonical_path),canonicalPath:String(capture.canonical_path),captureId:Number(capture.id),hash:String(capture.hash),capturedAt:String(capture.captured_at),checklistSynchronized:false,currentFile:'not-rechecked' as const} : p.document;
      const chars = capture ? Array.from(String(capture.text)) : null;
      return { ...envelope, document, text: chars ? chars.slice(cursor,cursor+16_384).join('') : null, nextCursor: chars && chars.length > cursor+16_384 ? String(cursor+16_384) : null };
    });
  }
  history(source: string, id: string, cursor = 0, limit = LIMITS.pageSize as number) {
    return this.transaction(false, () => {
      need(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit > 0 && limit <= LIMITS.maxPageSize);
      need(this.raw(source,id),'not-found');
      const rows = this.db.prepare('SELECT snapshot FROM revisions WHERE source=? AND plan=? ORDER BY revision LIMIT ? OFFSET ?').all(source,id,limit+1,cursor);
      return { ...this.metadata(), data: rows.slice(0,limit).map(r => { const p = JSON.parse(String(r.snapshot)) as PlanState; return { revision:p.revision,structuralRevision:p.structuralRevision,lifecycle:p.lifecycle,reportedAt:p.reportedAt }; }), nextCursor: rows.length > limit ? String(cursor+limit) : null };
    });
  }
  apply(value: unknown, actor: Actor, capture?: Capture, child?: Actor): Receipt {
    const r = parseRequest(value); need(r.op !== 'read');
    const hash = digest(canonical({ request:r, session:actor.sessionId, source:actor.sourceId }));
    const receiptStatement = this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)');
    return this.transaction(true, () => {
      need(Boolean(this.db.prepare('SELECT enabled FROM meta WHERE singleton=1').get()!.enabled),'disabled');
      const source = this.db.prepare('SELECT verified FROM sources WHERE id=?').get(actor.sourceId); need(source,'binding');
      const replay = this.db.prepare('SELECT * FROM receipts WHERE source=? AND plan=? AND oid=?').get(actor.sourceId,r.plan,r.oid!);
      if (replay) { need(replay.payload_hash === hash,'operation-reused'); return JSON.parse(String(replay.receipt)) as Receipt; }
      const previous = this.raw(actor.sourceId,r.plan); const revision = previous?.revision ?? 0;
      need(r.rev === revision,'conflict',revision);
      const coordinator = !previous || previous.sessionId === actor.sessionId;
      if (!coordinator) need(r.op === 'change','assignment');
      if (previous?.lifecycle !== undefined && previous.lifecycle !== 'active') need(coordinator && ['revise','commit','stage'].includes(r.op) && r.reopen,'closed');
      const now = new Date().toISOString();
      if (r.op === 'stage') {
        need(coordinator,'assignment');
        const old = this.db.prepare('SELECT payload,expected FROM chunks WHERE source=? AND plan=? AND owner=? AND upload=? AND chunk=?').get(actor.sourceId,r.plan,actor.sessionId,r.upload!,r.chunk!);
        if (old) need(String(old.payload) === canonical(r.items) && Number(old.expected) === revision,'operation-reused');
        else this.db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?,?)').run(actor.sourceId,r.plan,actor.sessionId,r.upload!,r.chunk!,revision,canonical(r.items));
        return saveReceipt({ plan:r.plan,rev:revision,structuralRev:previous?.structuralRevision ?? 0,staged:r.chunk });
      }
      let items = r.items;
      if (r.op === 'commit') {
        const chunks = this.db.prepare('SELECT chunk,payload,expected FROM chunks WHERE source=? AND plan=? AND owner=? AND upload=? ORDER BY chunk').all(actor.sourceId,r.plan,actor.sessionId,r.upload!);
        need(chunks.length === r.chunks && chunks.every((c,i) => c.chunk === i && c.expected === revision),'stage-incomplete');
        items = chunks.flatMap(c => JSON.parse(String(c.payload)) as ItemInput[]);
      }
      if (!previous) need(['start','commit'].includes(r.op) && !!r.title && !!items,'not-found');
      else need(r.op !== 'start','invalid');
      const p: StoredPlan = previous ? structuredClone(previous) : { id:r.plan,sourceId:actor.sourceId,title:r.title!,sessionId:actor.sessionId,revision:0,structuralRevision:0,lifecycle:'active',reportedAt:now,directory:actor.directory,projectId:actor.projectId,items:[],links:[],document:{ state:'unbound',checklistSynchronized:false,currentFile:'not-rechecked' } };
      need(p.revision<Number.MAX_SAFE_INTEGER);p.revision++;
      if (coordinator) { p.directory = actor.directory; p.projectId = actor.projectId; }
      p.reportedAt = now;
      const structural = ['start','revise','commit'].includes(r.op);
      if (structural) {
        p.structuralRevision++;
        if (r.title) p.title = r.title;
        if (r.reopen) p.lifecycle = 'active';
        if (items) {
          need(items.length <= LIMITS.planItems);
          const old = new Map(p.items.map(i => [i.id,i]));
          p.items = items.map(i => ({ ...i, status:i.status ?? old.get(i.id)?.status ?? 'pending', assigneeSessionId:i.kind==='task'?old.get(i.id)?.assigneeSessionId:undefined,reporterSessionId:i.status!==undefined||!old.has(i.id)?actor.sessionId:old.get(i.id)?.reporterSessionId }));
          validateItems(p.items);
          const ids = new Set(p.items.filter(i => i.kind === 'task').map(i => i.id));
          p.links = p.links.map(l => ({ ...l,itemIds:l.itemIds.filter(id => ids.has(id)) })).filter(l => l.itemIds.length > 0);
        }
      }
      let changed: string[] | undefined;
      if (r.op === 'change') {
        const attributed = r.attributed ?? actor.sessionId;
        if (r.attributed) need(coordinator && r.attributed !== actor.sessionId,'assignment');
        if (!coordinator || r.attributed) {
          need(actor.verifiedSource && Boolean(source.verified),'source-unverified');
          const link = p.links.find(l => l.sessionId === attributed);
          need(link && r.changes!.every(c => link.itemIds.includes(c.id)),'assignment');
          if (r.attributed) need(child?.sessionId === attributed && child.sourceId === actor.sourceId && child.verifiedSource && child.ancestry?.includes(p.sessionId),'assignment');
          else need(actor.ancestry?.includes(p.sessionId),'assignment');
        }
        need(new Set(r.changes!.map(c => c.id)).size === r.changes!.length);
        for (const c of r.changes!) { const item = p.items.find(i => i.id === c.id); need(item?.kind === 'task'); item.status = c.status; item.reporterSessionId=actor.sessionId; }
        changed = r.changes!.map(c => c.id);
      }
      if (r.op === 'link') {
        need(actor.verifiedSource && Boolean(source.verified),'source-unverified');
        need(child && child.sessionId === r.child && child.sourceId === actor.sourceId && child.verifiedSource && child.ancestry?.includes(actor.sessionId),'assignment');
        need(new Set(r.assign).size === r.assign!.length && r.assign!.every(id => p.items.some(i => i.id === id && i.kind === 'task')));
        const other = p.links.filter(l => l.sessionId !== r.child);
        need(other.every(l => l.itemIds.every(id => !r.assign!.includes(id))),'assignment');
        p.links = [...other,...(r.assign!.length ? [{sessionId:r.child!,itemIds:r.assign!}] : [])]; need(p.links.length <= 64);
        for (const item of p.items) { if (item.assigneeSessionId === r.child) delete item.assigneeSessionId; if (r.assign!.includes(item.id)) item.assigneeSessionId = r.child; }
      }
      if (r.op === 'finish') {
        if (r.outcome === 'finished') { const counts = countItems(p.items); need(counts.total > 0 && counts.remaining === 0,'unfinished'); }
        p.lifecycle = r.outcome!;
      }
      if (r.op === 'bind' || r.op === 'start' && r.source) {
        need(capture && path.isAbsolute(capture.path),'invalid');
        p.document = { ...p.document,path:capture.path,checklistSynchronized:false };
        p.boundCanonicalPath = capture.canonicalPath;
      }
      if (p.document.path) {
        need(capture?.path === p.document.path,'binding');
        const oldHash = p.document.hash;
        p.document.state = capture.state; p.document.checkedAt = capture.checkedAt;
        if (capture.state === 'captured') {
          need(capture.text !== undefined && capture.hash === digest(capture.text) && !!capture.canonicalPath && Buffer.byteLength(capture.text) <= LIMITS.documentBytes);
          const unchanged=oldHash===capture.hash&&p.document.canonicalPath===capture.canonicalPath&&p.document.captureId!==undefined;
          const captureId=unchanged?p.document.captureId!:Number(this.db.prepare('INSERT INTO captures(source,plan,revision,hash,text,captured_at,canonical_path) VALUES(?,?,?,?,?,?,?)').run(actor.sourceId,r.plan,p.revision,capture.hash,capture.text,capture.checkedAt,capture.canonicalPath).lastInsertRowid);
          p.document = { ...p.document,captureId,hash:capture.hash,capturedAt:unchanged?p.document.capturedAt:capture.checkedAt,canonicalPath:capture.canonicalPath,
            checklistSynchronized: structural && !!items || r.op === 'bind' && r.confirm === true || oldHash === capture.hash && p.document.checklistSynchronized };
          p.boundCanonicalPath ??= capture.canonicalPath;
        } else p.document.checklistSynchronized = false;
      }
      const snapshot = JSON.stringify(p);
      this.db.prepare('INSERT INTO plans VALUES(?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot').run(actor.sourceId,r.plan,p.revision,snapshot);
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(actor.sourceId,r.plan,p.revision,snapshot,JSON.stringify(actor));
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(source,id) DO UPDATE SET actor=excluded.actor').run(actor.sourceId,actor.sessionId,JSON.stringify(actor));
      if(child)this.db.prepare('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(source,id) DO UPDATE SET actor=excluded.actor').run(actor.sourceId,child.sessionId,JSON.stringify(child));
      const contribution: Contribution = { revision:p.revision,reporterSessionId:actor.sessionId,reporterAgent:actor.agent,attributedSessionId:r.attributed ?? actor.sessionId,mode:r.attributed ? 'parent-relay' : 'direct',itemIds:changed ?? [],reportedAt:now };
      this.db.prepare('INSERT INTO contributions VALUES(?,?,?,?)').run(actor.sourceId,r.plan,p.revision,JSON.stringify(contribution));
      return saveReceipt({plan:r.plan,rev:p.revision,structuralRev:p.structuralRevision,...(changed ? {changed} : {})});
      function saveReceipt(receipt: Receipt): Receipt {
        // Bound below to this connection; only reached inside this transaction.
        save(receipt); return receipt;
      }
      function save(receipt: Receipt) { receiptStatement.run(actor.sourceId,r.plan,r.oid!,hash,JSON.stringify(receipt)); }
    });
  }
}
function validateItems(items: Item[]) {
  const byId = new Map(items.map(i => [i.id,i])); need(byId.size === items.length);
  for (const item of items) {
    if (item.parentId) need(byId.get(item.parentId)?.kind === 'group');
    need((item.dependencies ?? []).every(id => byId.get(id)?.kind === 'task' && id !== item.id));
    const seen = new Set<string>([item.id]); let parent = item.parentId;
    while (parent) { need(!seen.has(parent)); seen.add(parent); parent = byId.get(parent)?.parentId; }
    if (item.kind === 'task') need(!items.some(i => i.parentId === item.id));
  }
  // Dependency cycles are invalid; their completion ordering cannot be meaningful.
  const visiting = new Set<string>(); const done = new Set<string>();
  function visit(id: string) { if (done.has(id)) return; need(!visiting.has(id)); visiting.add(id); for (const next of byId.get(id)?.dependencies ?? []) visit(next); visiting.delete(id); done.add(id); }
  for (const i of items) visit(i.id);
}
