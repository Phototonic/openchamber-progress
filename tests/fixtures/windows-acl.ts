import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

/** Native Windows test fixtures only. The product never applies, queries or
 * repairs an ACL. These helpers reproduce what an earlier version left behind,
 * an owner/SYSTEM/Administrators-only folder, to prove that such a folder keeps
 * working, and that the released 1.1.1 installer (which still checks ACLs in the
 * test process) accepts the fixture root it migrates from. */
const icaclsExe=()=>path.join(process.env.SystemRoot!,'System32','icacls.exe');

export function currentSid():string {
  const r=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true,timeout:20000});
  const sid=r.status===0?/"(S-1-5-[0-9-]+)"\s*$/.exec(r.stdout.trim())?.[1]:undefined;
  assert.ok(sid,'current account SID is available to the fixture');return sid;
}

export function icacls(file:string,args:string[]):string {
  const r=spawnSync(icaclsExe(),[file,...args],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(r.status,0,'icacls fixture command succeeds');return r.stdout;
}

/** The private ACL earlier versions created: no inheritance, full control for
 * the current account, SYSTEM and Administrators only, inherited by children. */
export function makeOwnerOnly(file:string):string {
  return icacls(file,['/inheritance:r','/grant:r',`*${currentSid()}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F']);
}

export const readAcl=(file:string):string=>icacls(file,[]);
