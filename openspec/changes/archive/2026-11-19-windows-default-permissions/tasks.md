# Tasks

## 1. Remove the Windows permission queries

- [x] 1.1 Add a regression test that fails first: a simulated Windows path, with every child-process entry point spied on, starts no process while setup, the service and the companion load, guard, run a tool hook and answer a status inspection.
- [x] 1.2 Replace the Windows permission queries in `shared/platform.ts` with plain filesystem checks, drop the scope, cache, spawn budget and mutex barrier, and keep the work deadline and writer fence.
- [x] 1.3 Remove the wrappers and the now-dead error paths in setup, service and the companion.
- [x] 1.4 Delete the tests of the removed machinery and rewrite the portable and native tests that counted launches so they assert none.
- [x] 1.5 Update the setup, backend, contracts and compatibility guides, the step protocol notes and the contributing guide.
