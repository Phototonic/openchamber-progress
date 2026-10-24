/** Setup-only synthetic SDK context for the real installed companion. No model. */
import { pathToFileURL } from 'node:url';
let tool:any;let inspect:any;
const ctx={skill:{transform:async(fn:any)=>fn({add:()=>{}})},tool:{transform:async(fn:any)=>fn({namespace:()=>{},add:(value:any)=>{tool=value;}}),list:async()=>[{id:'agent_progress_report',options:tool.options}]},rpc:{register:async(_definition:any,handlers:any)=>{inspect=handlers.inspect;}}};
const cleanup=await(await import(pathToFileURL(process.argv[2]).href)).default.setup(ctx);
try {const status=await inspect();if(!status.toolAvailable||!status.codemodeDisabled)throw new Error('activation');console.log(JSON.stringify({toolAvailable:true,version:status.version}));}finally{await cleanup?.();}
