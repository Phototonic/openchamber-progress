/** Archived T1 service, never a production entrypoint. */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { openProbeStore, snapshot } from '../../shared/probe-store.ts';
const binding = JSON.parse(readFileSync(process.env.AGENT_PROGRESS_PROBE_DESCRIPTOR!, 'utf8'));
if (!binding.probeOnly || !path.isAbsolute(binding.database) || !binding.database.startsWith('/tmp/opencode/agent-progress-probe-')) throw new Error('isolated-probe-binding-required');
const db = openProbeStore(binding.database);
const server = http.createServer((req,res) => {
  const answer = (status:number,body:unknown) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  if (req.headers.authorization !== `Bearer ${process.env.OPENCHAMBER_SERVICE_TOKEN}`) return answer(401,{error:'unauthorized'});
  if (req.method !== 'GET') return answer(405,{error:'method-not-allowed'});
  if (req.url === '/health') return answer(200,{ok:true,protocolVersion:1,sqlite:true,runtime:{node:process.versions.node,bun:process.versions.bun??null}});
  if (req.url === '/probe/progress') return answer(200,snapshot(db));
  return answer(404,{error:'not-found'});
});
server.listen(Number(process.env.OPENCHAMBER_SERVICE_PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
