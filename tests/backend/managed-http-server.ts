/** Child-process HTTP contention fixture; no host profile or external network. */
import {SetupController} from '../../service/setup-controller.ts';
import {createProgressServer} from '../../service/server.ts';
const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
const setup=new SetupController({env:process.env},()=>payload,undefined,undefined,new URL('./managed-http-worker.ts',import.meta.url));
const server=createProgressServer(undefined,'synthetic-http-fixture',undefined,setup);
server.listen(0,'127.0.0.1',()=>process.send?.({port:(server.address() as {port:number}).port}));
process.on('SIGTERM',()=>server.close(()=>{setup.close();process.exit(0);}));
