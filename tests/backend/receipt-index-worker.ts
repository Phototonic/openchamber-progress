// Isolated migration crash/concurrent-open driver; never receives a live profile.
import { Store, storageError } from '../../shared/store.ts';
const [file, mode] = process.argv.slice(2);
process.send?.({ phase: 'ready' });
process.once('message', () => {
  let store: Store | undefined;
  try {
    store = new Store(file!, { busyMs: 5000 });
    if (mode === 'interrupt') {
      const exec = store.db.exec.bind(store.db);
      store.db.exec = sql => {
        exec(sql);
        if (sql.startsWith('CREATE INDEX receipts_source_oid')) {
          process.send?.({ phase: 'index-uncommitted' });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
      };
    }
    store.installSubagentRuns();
    process.send?.({ phase: 'committed' });
  } catch (e) { process.send?.({ phase: 'failed', code: storageError(e).code }); }
  finally { store?.close(); process.disconnect?.(); }
});
