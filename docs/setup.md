# Safe global companion setup (production v2)

Release versions use the unreleased0.x line; protocol/schema remain2. Historical
package labels are corrected to0.2.0/0.2.1; earlier raw local QA records keep their
original labels. `evidence/` and `AGENTS.md` are local-only, never committed or
included in either package. Local evidence references below are not shipped files.

Initial lifecycle validation used disposable roots, with no real-user installation
in that validation boundary. Any real installation, update or reload requires
separate explicit user approval; fixture validation never grants that approval.
OpenChamber service permission runs code with full user privileges; the UI must
show that disclosure plus target paths/version and the separate lifecycle BEFORE
installing. Uninstalling/closing the extension does NOT disable global capture.
Disable/remove capture explicitly. History is always retained; there is no purge.

## Proactive guidance after loading

With verified companion/source identity, capture enabled and `agent_progress_report`
available in the agent's effective tools, the loaded companion supplies recurring
primary-context guidance without a manual skill load or prompt/config change.
No Slim integration or particular agent name is required. Explicit reports remain
authoritative; structured/conversation-only/non-Markdown plans need no source file.

Successful native2.1.4 `write` (create/replacement) or `edit` on `.md`/`.markdown`
under `plans`/`.plans`, or a `plan.md`/`plan.markdown` basename, may add one conditional
hint at the next eligible context. README/TODO, arbitrary filenames, shell writes,
opaque patches and unknown tools/shapes are not detected. Detection reads no file
contents and does not capture, bind or infer readiness/completion. Generic guidance
still offers an opportunity for uncovered/non-MD planning; compliance is not assured.
Hints are bounded process-local state, coalesced and forgotten on delivery or
disable/restart; recorded progress is retained. Neither guidance nor a hint is a
report receipt. Hidden/restricted tools are never enabled or bypassed.

## Git distribution validation and main promotion

The standard intended source is `https://github.com/Phototonic/openchamber-progress.git`.
It is currently private; public/default-main reachability has not been established.
OpenChamber clones the selected/default ref and inspects its existing runtime
entries; it does not install dependencies or compile TypeScript. The root manifest
is used as committed, not repaired into a ZIP manifest. Required generated backend
files are `build/service/main.js`, `build/companion/{index.js,package.json,SKILL.md}`
and `build/setup/main.js`, alongside the three existing guest HTML/JS entries.
Other generated output, bindings, DBs, dependencies, evidence and AGENTS stay local.

Develop/accept on `dev`; only a separately approved ready version may reach `main`:

1. Accept final guest and backend inputs, with no overlapping writers during the
   artifact join. Parent stages the exact required outputs; allowlisting a file is
   not proof it has been committed. No source work or partial build on main.
2. Select a higher semver for the future promotion, with root manifest, RELEASE,
   compiled service/companion and companion metadata agreeing. The authorized
   dev-to-main PR preparation selects0.2.5; archived0.2.4 artifacts stay unchanged.
   Git validation derives disposable higher versions from the candidate.
3. Inspect the candidate Git tree's ordinary runtime files and match their hashes
   to the accepted artifact projection. No consumer prepare/build/dependency fetch.
4. Pass actual supported host Git default-main install/check/explicit-update and
   pinned tag/custom-branch tests, plus folder/ZIP and companion lifecycle gates.
   A higher manifest without its service must fail inspection and preserve the old
   installation. Metadata awareness is not a remote runtime-file audit.
5. With separate owner approval, promote the exact accepted projection, not a new
   reconstructed build. Before claiming public availability, separately verify the
   canonical repository/manifest is public and its default branch is main; address
    the earlier performance concern separately from public reachability. The owner
    reports no issues on0.2.4 and lifts the prior performance hold for PR preparation;
    that is not a causal diagnosis or a new agent-run long soak. No visibility,
   main push, tag, Release or real installation is authorized by fixture success.

Focused Git gate (parent supplies an isolated supported host installer module):

```sh
AGENT_PROGRESS_HOST_MODULE=<isolated-host-install.js> \
  node --experimental-strip-types scripts/verify-git-package.ts <candidate-Git-tree-projection>
```

Supply a source-tree projection without `.git`/dependencies/local data, retaining
the actual root manifest and all intended tracked sources/runtime files. The driver
creates and removes its own real Git main/dev/bare/ref repositories and isolated
host registries. It maps only one synthetic HTTPS fixture URL to local real Git
clone/fetch/show, while exercising host public-address/no-redirect policy. No real
Git configuration or credentials are used. Its synthetic higher version is built
only in that disposable tree using already-installed dependencies, never the
production source version. A loopback official-main metadata fixture serves the
same real Git main manifest. Service startup uses the installed clone without a
consumer build. This proves installer/ref mechanics, not live GitHub reachability.

The initial D1 mechanics check uses accepted baseline guest runtime bytes; final
P1 repeats against stable accepted current guest/backend bytes and Designer's real
three-frame evidence. Fixture results do not grant permission for a real update.

## Resolve, inspect, confirm

### Current0.2.2 input workaround / source-only fix

The archived local0.2.2 utility rejected trailing directory separators in
disposable reproductions, even on otherwise valid absolute owned folders. The
owner's actual installed invocation was not traced, so this is not a proven cause
of their UI symptom. Until the source fix is accepted and packaged, enter all
three folder paths **without a trailing slash**. Removing
slashes does not waive any other check: an existing progress-store folder must
still be private0700. A775/755 store remains intentionally refused; setup never
silently chmods it. Prefer a new, not-yet-existing dedicated child folder under
an owned canonical parent, or an already-owned0700 directory. Inspect/dry-run do
not create it; confirmed install creates the missing private store directory.
Do not point storeRoot at a SQLite filename or a shared/general Documents folder.
No real folder permissions are changed by this source fix or its workaround.

The preserved source-only fix strips only terminal directory separators, then applies
the existing canonical-path, symlink, ownership, collision and privacy checks.
Relative paths, dot/traversal spellings and symlink aliases remain rejected.
Resolved targets in replies/descriptors use canonical spellings without redundant
terminal separators.
This is not in the archived0.2.2 artifacts; the0.2.5 private PR candidate below
includes it. The existing0775-store refusal remains intentional.

Supply and explicitly review canonical **effective** global config/data roots;
the optional suggestions below do not establish those roots. Do not infer verified
identity from project paths, the service environment, PID or account label. Global
config and OpenCode data directories must already exist, belong to this account,
and not contain symlink aliases. Progress store is its own explicit local0700
directory outside repositories; it is not OpenCode's auth DB. No config JSON,
agent instructions or project files are edited by setup.

The stable runtime tested here resolves XDG config/data plus opencode; the
producer refuses unsupported OPENCODE_DB/OPENCODE_CONFIG_DIR scope overrides.
Custom XDG roots are tested; arbitrary channels/platform path conventions are
not silently advertised. Same-host/account/local-filesystem only. Store/schema
or source mismatch fails closed and preserves bytes. Corrupt/future stores need
deliberate recovery outside this V1 tool, not an automatic reset/downgrade.

### Best-effort setup suggestions (source T7; UI follows in T8)

On an unconfigured Linux service, `GET /v1/setup` adds optional `suggestions` for
configRoot/dataRoot/storeRoot. Other hosts omit it; configured targets always win.
Each field is `{value,state:'resolved'|'candidate'}` or null (unknown).

- `resolved`: an owned candidate directory was observed without a symlink alias,
  not authoritative effective OpenCode scope or verified source identity.
- `candidate`: an honest default based on this **service host's** HOME/XDG hints,
  not the browser/relay viewer's OS, project, cwd or bundled executable.
- Unknown inputs remain null; no arbitrary path is invented. Absolute XDG bases
  override HOME/.config and HOME/.local/share; both append opencode. Relative or
  traversing overrides are unknown, not resolved against the extension directory.
- The store suggestion is `<suggested dataRoot>/openchamber-progress`, inheriting
  dataRoot's state as provenance only. It is a dedicated directory, not a DB file
  or the whole OpenCode data directory; it need not exist yet or already have0700.

All fields remain editable. Configured targets outrank user edits, and user edits
(including deliberate clearing) outrank hints. T8 must preserve them across late
hints, refreshes and failed inspections, never rederive over a manual store choice.
The mandatory inspect -> resolved-target review -> acknowledge/confirm sequence
is unchanged. Hints do not set targets, verified state or any binding. Installed
OpenCode overrides may be filtered out of the service environment; a successful
stat cannot rule them out or prove the active scope. Custom explicit roots remain
supported through the existing validation path.

Discovery only stats/realpaths the two candidate roots. It never reads config/auth
contents, searches recursively or spawns a CLI: even `opencode debug paths` can
mkdir during initialization and is not automatically safe read-only discovery.
Opening or inspecting writes nothing to setup targets. The service's existing
private selector-state bootstrap is a separate product write outside that promise.
The private PR candidate joins this service with the accepted upgrade UX;
source-level observation still does not establish effective OpenCode scope.

### What storeRoot contains

storeRoot is a **directory**, separate from OpenCode's own config/data roots:

- `progress.sqlite`: the product's SQLite store. It holds store/source IDs,
  capture-enabled control, plans/items, revisions, receipts, attribution and
  captured document bytes/hashes. Latest-loaded activation metadata also lives
  here. It is not OpenCode's credential/session database.
- SQLite transaction journal/side files when needed (default rollback journal),
  in that same private directory; do not relocate or delete them independently.
- `payloads/<content hash>/`: immutable companion release `index.js`, `SKILL.md`
  and `progress-binding.json`; old/unreferenced releases are retained for recovery.
  Interrupted release staging may leave `payloads/.staged-*` folders.
- `installation-history.jsonl`: append-only install/update/control/removal events,
  not a substitute for plan revision history (which stays in SQLite).

The discovery loader, ownership manifest and standalone `remove.js` live under
configRoot/plugins/agent-progress, not at storeRoot. The service's stable selector
is separate product state described below. No OpenCode auth DB is copied here.
Store contents can include private plan text and absolute source/project paths,
which is why a dedicated0700 folder/0600 database is required. Removal retains
this store/history/payloads; there is no automatic purge or secure-erasure claim.

After building backend output with the existing pinned tooling, example commands
(replace EVERY /resolved path with the inspected canonical targets):

```sh
node build/setup/main.js inspect --config-root=/resolved/config/opencode --data-root=/resolved/data/opencode --store-root=/resolved/state/agent-progress
node build/setup/main.js dry-run --config-root=/resolved/config/opencode --data-root=/resolved/data/opencode --store-root=/resolved/state/agent-progress
# Explicit approval only after inspecting targets/privilege/lifecycle:
node build/setup/main.js install --config-root=/resolved/config/opencode --data-root=/resolved/data/opencode --store-root=/resolved/state/agent-progress --confirm=true
```

Update is the same command with action update. Inspect/dry-run never create dirs,
DBs or descriptors. Mutations require confirmation. Known resolved targets can
also be managed through the fixed setup HTTP routes in docs/contracts.md. No
request may supply executable payloads, URLs, commands, SQL or binding-file paths.

## Ownership, activation and interruption

### Bundled companion detection (U1 backend; U2 UI follow-up)

Existing setup status reads automatically compare a verified selected immutable
release against the bundled update candidate. `update.state` is `current` only
when the binding-derived release identity and plugin/guidance bytes match, not
merely when version labels match. Different bytes are `available` for an equal or
higher bundled version, or `newer-installed` when the installed version is higher.
The latter is a possible downgrade warning, not an upgrade recommendation.
Unconfigured/removed/unverified/modified/unavailable states omit comparison rather
than claiming success. No automatic update, new route or polling loop is added.
Updates still require inspection/review and explicit confirmation on existing roots.

Status `version` comes from the selected immutable release. `update.rootVersion`
is diagnostic metadata from the verified initial root package, whose loader,
guidance and removal utility intentionally remain unchanged across updates. A
0.2.2 root with a selected 0.2.3 release is valid; it does not mean the selected
payload is still 0.2.2 or that the removal utility was upgraded. This preserves
the existing root layout and standalone utility policy.

Being current on disk does not establish activation: a separate reload-required
note can remain until a matching loaded observation. No loaded version is invented
and last-observed availability is not a live census. Progress refreshes do not
audit payloads; comparison runs only on existing setup reads.

Owned package is configRoot/plugins/agent-progress. An ownership manifest pins
install identity, root-file hashes and immutable release hashes. Foreign folders,
extra/modified files, symlink escapes and descriptor changes refuse takeover.
Unrelated shared config is byte-preserved. Source namespace/store UUID survive
updates and removal/reinstall. DB/history is never recursively deleted.

Payloads stage OUTSIDE discovery. Initial activation renames a complete package
into place. Update stages a self-contained SDK-bundled immutable release under
storeRoot/payloads, then atomically switches ONE ownership manifest. Stable loader
reads the selection at setup time (not module-import cache time), validates
hashes and delegates setup. The previous runnable release stays intact until the
switch and is retained for recovery. File/parent sync precedes acknowledgement.
No runtime npm/Bun dependency fetch or consumer TypeScript compilation.

Interrupted staging/activation is not silently cleaned or relabeled success.
Inspect distinguishes staged files/releases, unreferenced finalized releases and
retained rollback payloads; current version comes from the verified selection.
Rerunning the same explicit update can finish activation, while ownership checks
still apply. Never delete/overwrite an unknown staged or modified file to force a
pass. An interrupted operation after activation-before-reply may already have
selected the new version; inspect it rather than assuming rollback or retrying
destructively. This is not a history manager or an automatic schema rollback.

Install/update replies mean FILE installation; activation=reload-required remains
until the selected payload matches the most recently observed successful
tool/skill/RPC setup. An unchanged already-observed payload needs no new reload.
No automatic global service restart. Production read-only RPC
agent-progress-status.inspect reports protocol/version/toolAvailable and stable
source/store IDs for supported SDK clients. T3 proved it in an owned EMPTY2.1.4
runtime, including update/reload, without model calls. A service cannot discover
real source auth merely to probe activation; M1 transfer helpers are test-only.

## Disable, enable, remove after extension uninstall

Installed package includes a self-contained remove.js utility and descriptor:

```sh
node /resolved/config/opencode/plugins/agent-progress/remove.js disable
node /resolved/config/opencode/plugins/agent-progress/remove.js enable
node /resolved/config/opencode/plugins/agent-progress/remove.js remove-capture
```

Disable is a transaction checked by every loaded reporter, not just a skill flag.
Enable is explicit. Remove first disables, then removes only verified root package
files. Modified/foreign files stay intact with a fixed diagnostic; it does not
restart or kill real OpenCode. Existing loaded code cannot keep writing after
disable. Immutable acknowledged payloads, installation history, plans, revisions,
receipts and captures remain. There is no secure-erasure claim or data purge.
The utility remains usable after the OpenChamber extension is uninstalled because
it lives with the separate global companion, not guest preference storage.

## Host service binding and setup UI

Host supplies allocated loopback port/bearer; guest uses serviceRequest only.
The authoritative service descriptor lives outside the extension package at
`$XDG_STATE_HOME/agent-progress-service/progress-binding.json`, falling back to
`$HOME/.local/state/agent-progress-service/progress-binding.json`. This is the
service's own private product state, NOT a guess at OpenChamber/OpenCode paths or
an automatic choice of source roots. It is one selected binding per account/XDG
state scope. Explicit absolute AGENT_PROGRESS_BINDING overrides remain available
to directly launched services; use an external owned path, not a package path.
Normal host isolation inherits its own HOME/XDG state scope. Separate concurrent
host bindings need separate state scopes; conflicting descriptor changes refuse
rather than silently overwriting another service's selection.

The dedicated0700 service-state directory has a0600 product ownership marker;
the descriptor is0600, atomically replaced and synced. Foreign/modified state,
descriptor collisions and symlink aliases fail closed. A missing descriptor is
an explicit unconfigured state; it never authorizes source-root guessing.
Service GET /v1/setup and POST inspect
show targets without writes. Install/update uses only the packaged companion and
removal payload, persists its own descriptor atomically, and refuses a foreign or
modified descriptor. Reads pin that store/source identity after explicit setup.
The service never reads arbitrary canonical files; it returns captured DB text.
Extension folder/ZIP replacement does not remove its authoritative descriptor.
A valid legacy package-local descriptor is adopted only if stable state is
absent; a later package default cannot override stable state. Adoption never edits
the legacy file. If an old0.2.0 updater already deleted that only legacy copy
before0.2.1 ever ran, its roots cannot be safely rediscovered: use Designer's
explicit update-with-the-same-roots recovery once. Future replacement preserves
the new stable selection. An already deleted descriptor is not magically restored.

Details of routes, confirmation bodies, version/activation/error fields and
read-only paging are frozen in docs/contracts.md. Production panel ID remains
agent-progress-probe to preserve Work Status openSurface; labels are Agent progress.
T5 assembles these built backend entries with Designer's already-owned guests;
this document does not claim an installable extension ZIP was produced in T3.

## V1 installable artifacts (unreleased0.2.5 private PR candidate)

V1 is the product scope; its private PR candidate version is **0.2.5**,
agreeing across extension and companion payloads. This promotion-metadata patch
adds no feature behavior to0.2.4. It retains accepted cached-revisit/
spinner and bounded latest-switch refresh fixes, editable setup prefill, host-side
suggestions, preserved separator normalization and failed-setup Store cleanup.
The smaller-import experiment was not promoted; no persistent-service Store reuse
or payload-audit cache was added. This patch distinguishes the candidate from
installed/archived0.2.2; it is not a public release or a complete performance cure.
It also joins automatic advisory companion comparison and explicit review/update
UX; updates remain user-confirmed and activation remains separate. This candidate
does not authorize installing0.2.5 into the real host; historical real0.2.3 update
evidence and its pending-load status are unchanged. Protocol/schema remain2.
The panel ID and
Agent progress manifest labels are unchanged. Artifacts are local and unsigned;
no publication or signature verification claim is made.

After `bun run build:backend && bun run package`, `build/artifacts/` contains:

- `agent-progress-extension-0.2.5/` and `.zip`: host manifest, the three Designer
  HTML/main.js guests copied unchanged, self-contained service, companion and
  setup utility. No consumer compilation, dependency installation or network
  dependency fetch is needed. The service runs in the host's Node runtime, not Bun.
- `agent-progress-companion-0.2.5/` and `.zip`: standalone companion installer,
  using the same build/companion and build/setup layout. **Do not** put this ZIP
  directly into OpenCode's plugins folder; invoke its setup utility instead.
- `sha256.txt`: per-file and ZIP SHA-256 inventory. Compare it before installation.
- `entries-0.2.5.sha256`: canonical sorted filename/content-hash inventory for
  these two folders. Reassembly must reproduce these entries, not ZIP container
  bytes: ZIP timestamps/headers can change without changing any payload entry.
  Superseded, incorrectly labelled unreleased builds are local QA history only;
   older0.x artifacts remain local QA history; select the0.2.5 pair explicitly.

With explicit approval, use OpenChamber's extension installer on the extension
folder or ZIP. Review sessions and host-service privileges before granting them.
The host installer accepting a package does not grant permissions or activate the
global companion. In the extension setup view, inspect resolved roots and confirm
installation separately. No binding descriptor/private store is shipped.

Alternatively, extract the companion ZIP to a dedicated directory, change into
that directory and run the inspect/dry-run/install commands above (`node
build/setup/main.js ...`). Use Node24.19.0 or the already-proved supported host
runtime with built-in SQLite. The capture boundary is Linux-only in this release.
Do not assume other platforms or custom runtime channels were verified.

For update, keep the newly extracted packaged build/companion and build/setup
siblings together and invoke its `update` with the same explicit targets. Inspect
the selected version and reload the intended OpenCode session/location explicitly.
Never restart a real instance automatically. Pending reload persists across
service restarts but clears when a successfully loaded producer records the
matching selected binding/version/plugin/guidance fingerprint. Changed bytes at
the same version still need reload. Observations are optional additive SQLite
metadata and do not change protocol/schema2 or progress history;0.2.0 readers
remain compatible but old producers do not emit acknowledgements. No model call,
source-auth discovery, heartbeat or new HTTP acknowledgement route is involved.
This is last-observed availability, not proof that every concurrent old process
has stopped. The existing activation/control values and diagnostic codes remain.
Shared-store inspect ignores other-source payloads when diagnosing unused
versions; truly unreferenced same-source payloads retain the existing code.

Disable capture through setup controls or the installed standalone `remove.js
disable`; enable is equally explicit. To remove the extension, **disable/remove
capture separately first** if it should stop. `remove.js remove-capture` removes
only verified owned discovery files after disabling, retaining database/history
and immutable payloads. Removal works after extension absence; deleting the
extension alone does not stop an already loaded global companion.

If a configured store becomes unreadable, setup retains the configured roots and
reports its fixed store diagnostic rather than offering an unconfigured success.
Restore its correct ownership/access or resolve the reported corruption/schema
problem without deleting history. Health/setup/read requests each revalidate once;
recovery is automatic once access is restored. Reinstall/update still requires
explicit confirmation and valid owned files; there is no automatic reset or
repair of corrupt/future stores.

Verification: `bun run check` now assembles artifacts and runs parser, entry,
version, packaged-service, lifecycle and synthetic packaged-tool guidance checks.
For the actual host installer gate, set AGENT_PROGRESS_HOST_MODULE to the existing
isolated host's extracted `server/lib/guests/install.js` module before that command.
It installs the folder and ZIP into disposable extension registries only; no app
or guest is launched. System `zip`/`unzip` are build/QA tools, not consumer runtime
dependencies. Local-only QA evidence (not shipped): evidence/package/m2-checks.txt,
canonical entry/hash inventories, and the T9 addendum in evidence/backend/qa.md.
Parent accepted Designer's final runtime/relay checks on the labelled test
ZIP with byte-identical guest bundles; final reassembly adds artifact gates, not
another full runtime/relay run. No retained fixture was changed by reassembly.

The cached-revisit/spinner and bounded refresh issues, and failed-setup connection
cleanup, have focused regression evidence. The owner's hours-long real-host
sluggishness was **not established** by isolated diagnostics. The owner now reports
no issues in real use of0.2.4 and requests a dev-to-main PR, lifting the previous
performance hold for PR preparation. The short low-load soak is not proof of an
hours-long leak's absence, and no new agent-run long soak or causal fix is claimed.
Parent acceptance and public source checks remain separate. No real installation,
auth transfer, model call or automatic
restart is part of packaging validation.
