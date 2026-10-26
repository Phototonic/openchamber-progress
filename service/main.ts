import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProgressServer } from './server.ts';
import { SetupController } from './setup-controller.ts';
import { serviceBindingFile } from './state.ts';
import { RELEASE } from '../shared/release.ts';
import { SetupError } from '../setup/lifecycle.ts';
import { PlatformError } from '../shared/platform.ts';

let setup: SetupController | undefined;
try {
  const port=Number(process.env.OPENCHAMBER_SERVICE_PORT);const token=process.env.OPENCHAMBER_SERVICE_TOKEN;
  if(!Number.isInteger(port)||port<1||port>65535||!token)throw new Error();
  const legacy=fileURLToPath(new URL('./progress-binding.json',import.meta.url));
  const bindingFile=process.env.AGENT_PROGRESS_BINDING??serviceBindingFile();
  setup=new SetupController(bindingFile,()=>({plugin:readFileSync(new URL('../companion/index.js',import.meta.url),'utf8'),guidance:readFileSync(new URL('../companion/SKILL.md',import.meta.url),'utf8'),removal:readFileSync(new URL('../setup/main.js',import.meta.url),'utf8'),version:RELEASE}),process.env.AGENT_PROGRESS_BINDING?undefined:legacy);
  const server=createProgressServer(undefined,token,undefined,setup);
  server.on('error',()=>{setup?.close();process.exitCode=1;});server.listen(port,'127.0.0.1');
  process.on('SIGTERM',()=>server.close(()=>{setup?.close();process.exit(0);}));
}catch(e){setup?.close();console.error(e instanceof SetupError||e instanceof PlatformError?e.code:'agent-progress-service-unavailable');process.exitCode=1;}
