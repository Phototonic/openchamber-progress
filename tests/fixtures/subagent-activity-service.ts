/** Disposable service entry; uses the production authenticated API and real bound Store. */
import fs from 'node:fs';
import { Store } from '../../shared/store.ts';
import { createProgressServer } from '../../service/server.ts';
const binding = JSON.parse(fs.readFileSync(new URL('../binding.json', import.meta.url), 'utf8'));
const store = new Store(binding.database); store.bindReads(binding.source.id, true);
const server = createProgressServer(store, process.env.OPENCHAMBER_SERVICE_TOKEN!);
server.listen(Number(process.env.OPENCHAMBER_SERVICE_PORT), '127.0.0.1');
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => { store.close(); process.exit(0); }); });
