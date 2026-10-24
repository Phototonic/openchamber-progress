/** Pre-implementation A/B: generate an isolated type-only candidate; never edit production. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root=fs.mkdtempSync('/tmp/opencode/agent-progress-plugin-variant-');
try{
  fs.cpSync('plugin',`${root}/plugin`,{recursive:true});fs.cpSync('shared',`${root}/shared`,{recursive:true});
  fs.symlinkSync(path.resolve('node_modules'),`${root}/node_modules`);
  const original=fs.readFileSync('evidence/backend/performance-plugin-before.ts.txt','utf8');
  const candidate=original.replace("import { Plugin, Skill }",'import type { Plugin, Skill }')
    .replace("export default Plugin.define({ id:","export default { id:")
    .replace("Skill.ID.make('agent-progress')","'agent-progress' as Skill.ID")
    .replace("Skill.Name.make('Agent progress')","'Agent progress' as Skill.Name")
    .replace("Skill.Info.fields.path.make(fileURLToPath(new URL('./SKILL.md',import.meta.url)))","fileURLToPath(new URL('./SKILL.md',import.meta.url)) as Skill.Info['path']")
    .replace('} });\n\nconst GUIDANCE','} } satisfies Plugin.Plugin;\n\nconst GUIDANCE');
  assert.notEqual(candidate,original);assert.ok(candidate.includes('satisfies Plugin.Plugin'));
  const measurements:any[]=[];
  const variants:Array<readonly[string,string]>=[['baseline',original],['type-only',candidate]];
  if(process.argv.includes('--bytes-only'))variants.push(['failure-cleanup-only',fs.readFileSync('plugin/index.ts','utf8')]);
  for(const [name,source] of variants){
    fs.writeFileSync(`${root}/plugin/index.ts`,source);
    const build=spawnSync('bun',['build',`${root}/plugin/index.ts`,'--target=node','--format=esm',`--outfile=${root}/plugin.js`],{encoding:'utf8'});assert.equal(build.status,0,'variant build');
    const js=fs.readFileSync(`${root}/plugin.js`,'utf8');
    // No external SDK/Effect imports are allowed in either self-contained artifact.
    const ast=ts.createSourceFile('plugin.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const externals:string[]=[];
    function visit(node:ts.Node){
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))externals.push(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))externals.push(node.arguments[0].text);
      ts.forEachChild(node,visit);
    }
    visit(ast);assert.ok(externals.every(name=>name.startsWith('node:')),'self-contained bundle may import only Node builtins');
    if(process.argv.includes('--bytes-only')){measurements.push({name,bytes:Buffer.byteLength(js),externals});continue;}
    const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/performance-runtime.ts'],{encoding:'utf8',env:{...process.env,AGENT_PROGRESS_PERF_ENTRY:`${root}/plugin/index.ts`,AGENT_PROGRESS_PERF_QUICK:'1'},timeout:90_000,maxBuffer:2_000_000});
    assert.equal(run.status,0,`${name} independent runtime probe failed`);
    measurements.push({name,bytes:Buffer.byteLength(js),runtime:JSON.parse(run.stdout)});
  }
  console.log(JSON.stringify({sdk:'@opencode/plugin2.1.4',change:'type-only object/brand annotations; no dependency externalization',measurements},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
