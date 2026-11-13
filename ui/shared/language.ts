import { resolveLanguage, type InterfaceLanguage, type LanguagePreference } from './i18n.ts';

export type LanguageStorageValue = string | number | boolean | null | LanguageStorageValue[] | { [key: string]: LanguageStorageValue };
export interface LanguageStorage {
  get(key: string, options: { scope: 'device' }): Promise<LanguageStorageValue | undefined>;
  set(key: string, value: LanguageStorageValue, options: { scope: 'device' }): Promise<void>;
}
export interface LanguageSnapshot {
  readonly language: InterfaceLanguage;
  readonly preference: LanguagePreference;
  readonly confirmed: LanguagePreference | null;
  readonly supported: boolean;
  readonly pending: boolean;
  readonly readError: 'readFailed' | null;
  readonly writeError: 'saveFailed' | null;
  readonly saveStatus: 'idle' | 'saving' | 'saved' | 'failed';
}
const key = 'interface-language.v1';
function isPreference(value: unknown): value is LanguagePreference { return value === 'auto' || value === 'en' || value === 'ru'; }
function storedPreference(value: LanguageStorageValue | undefined): LanguagePreference | null {
  if (value === undefined) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.hasOwn(value, 'v') && Object.hasOwn(value, 'preference')
    && value.v === 1 && isPreference(value.preference)) return value.preference;
  throw Error('readFailed');
}

/** One-shot background read. Failed/malformed preferences use the same unconfirmed
 * automatic fallback as a new UI frame; never writes or starts a refresh loop. */
export async function readEffectiveLanguage(storage: Pick<LanguageStorage, 'get'>, hostLocale: string, supported: boolean): Promise<InterfaceLanguage> {
  let preference: LanguagePreference = 'auto';
  if (supported) {
    try { preference = storedPreference(await storage.get(key, { scope: 'device' })) ?? 'auto'; }
    catch { /* No confirmed preference: retain automatic mode. */ }
  }
  return resolveLanguage(preference, hostLocale);
}

export class LanguageController {
  private readonly options: { storage: LanguageStorage; changed: () => void };
  private hostLocale = 'en';
  private supported = false;
  private shown = true;
  private disposed = false;
  private generation = 0;
  private confirmed: LanguagePreference | null = null;
  private readError: LanguageSnapshot['readError'] = null;
  private writeError: LanguageSnapshot['writeError'] = null;
  private saveStatus: LanguageSnapshot['saveStatus'] = 'idle';
  private reading: number | null = null;
  private writing = false;
  private reread = false;

  constructor(options: { storage: LanguageStorage; changed: () => void }) { this.options = options; }

  snapshot(): LanguageSnapshot {
    const preference = this.supported ? this.confirmed ?? 'auto' : 'auto';
    return Object.freeze({ language: resolveLanguage(preference, this.hostLocale), preference,
      confirmed: this.confirmed, supported: this.supported, pending: this.writing,
      readError: this.readError, writeError: this.writeError, saveStatus: this.saveStatus });
  }

  ready(hostLocale: string, supported: boolean): void {
    if (this.disposed) return;
    this.hostLocale = hostLocale;
    if (this.supported !== supported) {
      this.generation++;
      this.supported = supported;
      this.confirmed = null;
      this.readError = null;
      this.writeError = null;
      this.saveStatus = 'idle';
      this.reread = false;
    }
    this.changed();
    this.refresh();
  }

  refresh(): void {
    if (!this.available()) return;
    if (this.writing || this.reading !== null) {
      // Only an obsolete read needs a follow-up; same-generation requests coalesce.
      if (this.writing || this.reading !== this.generation) this.reread = true;
      return;
    }
    this.reread = false;
    this.reading = this.generation;
    void this.read(this.generation);
  }

  choose(preference: LanguagePreference): void {
    if (!this.available() || this.writing || !isPreference(preference)) return;
    const generation = ++this.generation;
    this.reread = false;
    this.writing = true;
    this.saveStatus = 'saving';
    this.writeError = null;
    this.changed();
    void this.write(preference, generation);
  }

  hidden(): void {
    if (this.disposed || !this.shown) return;
    this.shown = false;
    this.generation++;
    this.reread = false;
    this.saveStatus = 'idle';
  }
  visible(): void {
    if (this.disposed) return;
    this.shown = true;
    this.refresh();
  }
  dispose(): void { this.hidden(); this.disposed = true; }

  private available(): boolean { return !this.disposed && this.shown && this.supported; }
  private owns(generation: number): boolean { return this.available() && generation === this.generation; }
  private changed(): void { if (this.shown && !this.disposed) this.options.changed(); }
  private followUp(): void { if (this.reread) this.refresh(); }

  private async read(generation: number): Promise<void> {
    try {
      const value = await this.options.storage.get(key, { scope: 'device' });
      if (!this.owns(generation)) return;
      this.confirmed = storedPreference(value);
      this.readError = null;
    } catch {
      if (!this.owns(generation)) return;
      this.readError = 'readFailed';
    } finally {
      this.reading = null;
      if (this.owns(generation)) this.changed();
      this.followUp();
    }
  }

  private async write(preference: LanguagePreference, generation: number): Promise<void> {
    try {
      // An already-sent set survives hiding; only its UI authority can be retired.
      await this.options.storage.set(key, { v: 1, preference }, { scope: 'device' });
      if (!this.owns(generation)) return;
      this.confirmed = preference;
      this.writeError = null;
      this.saveStatus = 'saved';
    } catch {
      if (!this.owns(generation)) return;
      this.writeError = 'saveFailed';
      this.saveStatus = 'failed';
    } finally {
      this.writing = false;
      if (this.available()) this.changed();
      this.followUp();
    }
  }
}
