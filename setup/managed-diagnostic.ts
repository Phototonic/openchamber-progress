import {MANAGED_ACTION_CODES} from '../shared/progress.ts';
import {MANAGED_STEP_CODES} from '../shared/managed-steps.ts';
import {platformErrorCode} from '../shared/platform.ts';
import {storageError} from '../shared/store.ts';
import type {ManagedStepDiagnostic} from '../shared/managed-steps.ts';
import type {ManagedStepJournal} from './managed-step-journal.ts';

/** Private worker-local failure context. Never serialize the exception itself. */
export class ManagedStepFailure extends Error {
  readonly code:string;
  readonly stage:ManagedStepDiagnostic['stage'];
  readonly journal?:ManagedStepJournal;
  constructor(error:unknown,stage:ManagedStepDiagnostic['stage'],journal?:ManagedStepJournal) {
    const code=managedDiagnostic(error);super(code);this.code=code;this.stage=stage;this.journal=journal;
  }
}

/** Translate owner-specific failures into the frozen wire allowlist. Never send
 * exception messages or collapse a changed installation into a storage fault. */
export function managedDiagnostic(error:unknown):string {
  const code=(error as {code?:unknown})?.code;
  if(code==='installation-changed')return 'managed-migration-conflict';
  if(code==='payload-invalid')return 'managed-step-unsupported';
  return typeof code==='string'&&[...MANAGED_ACTION_CODES,...MANAGED_STEP_CODES].includes(code)
    ?code:platformErrorCode(error)??storageError(error).code;
}
