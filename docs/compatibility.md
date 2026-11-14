# Compatibility commands and evidence

## Current use and development

The managed-delivery candidate requires **OpenChamber >=2.7.1** with build SDK
**2.7.0** (plugin SDK 2.1.4 unchanged). Earlier global-companion runs below are
historical and do not certify managed delivery. Isolated Linux web 2.7.1 /
independent OpenCode 2.2.7 acceptance is described below, including the native Git
update journey. Installer, web UI and native results retain distinct scopes;
no Windows/Electron certification is implied.

Normal setup approves **Add a plugin to OpenCode**, then explicitly selects a
private Store. Watched-file delivery can retire after disable/removal without a
restart; caller-owned `OPENCODE_CONFIG` fallback requires an explicit restart for
contribution add/remove or toggle changes, not necessarily same-path Git updates.
When mode is unknown these are conditional, not a live-stop promise. External,
remote, terminal, isolated-space and VS Code runtimes are outside managed reach.
Legacy and explicit **Add to global config** entries can outlive the extension.
History remains. Held-permission work cannot append after retirement but a session
may need interruption; graceful cancellation is not guaranteed. Integrity is a
warn-only loaded-byte comparison, explicitly weaker than former private attested
payloads. Migration interruption/lock recovery limits are in [Setup](setup.md).

Agent Progress is an installable early-access extension with Linux and native
Windows capture. Linux native capture was also verified on OpenCode 2.2.7 in the
[post-release checks](#post-release-111-checks--2026-11-12); the historical Linux
and Windows 2.1.4 results below retain their original scope. Broader compatibility
is not established. Use the [setup guide](setup.md) for installation,
updates and lifecycle, including the [native Windows boundary](setup.md#native-windows).
The selected tree's [package.json](../package.json) identifies its package version;
[GitHub Releases](https://github.com/Phototonic/openchamber-progress/releases)
identifies published tags and assets. Matching version numbers alone do not make
an unreleased checkout a tested release.

For current toolchain, build and validation commands, follow
[CONTRIBUTING.md](../CONTRIBUTING.md#local-development) and the selected tree's
package scripts. Its [portable CI instructions](../CONTRIBUTING.md#portable-ci--fresh-disposable-checkout-only)
are separate from native-host certification. The probe commands below record
historical runs and are not the current installation procedure.

The evidence sections retain the environments, artifacts and limitations of
those runs; they do not certify every later checkout. References under `evidence/`
name local-only records, not files shipped in the repository or release archives.

## Managed companion acceptance

The managed candidate was exercised on isolated **Linux OpenChamber web 2.7.1**,
independent **OpenCode 2.2.7**, **Node 24.22.2** and **Bun 1.3.14**, retaining SDK
2.7.0 and plugin SDK 2.1.4. This is not Electron, native Windows, relay, remote-host
or every-cancellation-interleaving certification. The package version is unchanged;
an accepted development candidate is not a new published release.

`tests/fixtures/managed-companion-host.ts` owns a fresh HOME/all XDG roots,
rootless loopback-only namespace and Chromium profile. It starts the real web UI,
not an API-only host or synthetic SDK shell. Its local scripted provider removes
remote providers and refuses HTTP provider transport; credentials remain absent.
No live profile, authentication copy, paid model or real-instance restart is used.

```sh
timeout -k 10 900 node --experimental-strip-types tests/fixtures/managed-companion-host.ts \
  --host-module <isolated-2.7.1-server-index.js> \
  --opencode-binary <independent-2.2.7-binary> \
  --chromium <installed-chromium> --artifacts <local-evidence>
```

The 35 behavioral assertions cover visible **Add a plugin to OpenCode** / **Allow
and enable** approval, explicit UI configuration with no pre-seeded descriptor or
binding override, and start/change reports with matching revision/counts in rail,
Work Status and board. Watched-file disable retires tools/guidance, re-enable
reports a later revision, and removal retains read-only-accessible history.
An actual legacy loader produces one capture; modified ownership and a different
store refuse without selecting/removing their data. Same-store migration retains
Store/source identity and history. A real expectation-publication failure after
verified removal leaves capture off/pending; restoring the exact known synthetic
metadata and explicitly reviewing/retrying completes that same target. Mid-unlink
conflict is covered by the portable lifecycle regression, not host fault injection.

Same-version changed native bytes warn while reporting succeeds; the service's
expected baseline stays running during that test. A plain terminal runtime with
the same synthetic directories lacks the managed plugin, and a restricted child
gets no report authority/guidance. Caller-owned-config delivery is tested using
fresh owned host processes: install requires restart, disable alone can leave the
old runtime reporting, and an explicit restart retires it without editing the
caller file. These are mode-specific observations, not a universal toggle deadline.

The held-permission case commits neither a late report nor a capture after
disposal. Its session required explicit interruption in this run; graceful
cancellation remains unpromised. Fixture cleanup verified zero remaining owned
processes/listeners. Actual unmodified 2.7.1 folder/ZIP/Git installers accept the
declared plugin directory without a consumer build; an actual 2.7.0 installer
refuses folder/ZIP with `host-too-old`, requiring 2.7.1, without registration.
Portable CI, native backend-only checks and real-web acceptance have separate
evidence scopes; no desktop-host or native Windows rerun is implied.

## Native extension updates — 2026-11-13

The isolated journey used unmodified **OpenChamber web 2.7.1**, independent
**OpenCode 2.2.7**, driver/host **Node 24.22.2**, builder **Bun 1.3.14** and fresh
**Chrome for Testing 145.0.7632.6**. The observer inside OpenCode reported Node
compatibility **26.3.0** / Bun **1.4.4**. These are Linux web results, not desktop,
Windows, macOS, remote-host or universal model-compliance certification. The
shipping package version was not bumped; higher versions exist only in fixtures.

```sh
timeout -k 10 900 node --experimental-strip-types tests/fixtures/native-extension-updates-host.ts \
  --host-module <isolated-2.7.1-server-index.js> \
  --opencode-binary <independent-2.2.7-binary> \
  --chromium <installed-chromium> --artifacts <local-evidence>
```

Fresh HOME/all XDG roots, loopback-only network isolation and a fresh browser
profile exclude live configuration and credentials. The unchanged host policy
uses a fixture-only public-origin DNS mapping and constrained Git executable to
an owned local bare remote, with credential helpers disabled. This proves the host
flow, not public GitHub reachability. A local scripted provider supplies deliberate
reporting; no paid model or external provider transport is used. Synthetic account
and settings records are seeded through the published host auth-store API, not
real integration/OAuth setup.

- **Consent and retention.** Real Settings → Extensions Git install includes
  **Add a plugin to OpenCode → Allow and enable**, followed by normal Setup review
  and confirmation. The unchanged-permission **1.1.1 → synthetic 1.1.2** Update
  available/Update journey needs no reapproval. Grants, scopes, storage identity,
  synthetic account/settings, device language, private binding and history remain.
  A separate explicit updater-module replacement while paused preserves the true
  paused flag; it is not a same-version UI offer.
- **Added permission.** Synthetic 1.1.3 opens the real approval dialog. **Not now**
  leaves new files/version installed, old grants retained and the new `model`
  capability ungranted. A safe invalid-input probe receives `400 NOT_GRANTED`
  before model invocation. Later **Review permissions → Allow and enable** grants
  it. Deferral is not rollback or a guarantee of old executable bytes.
- **Cadence and refs.** Actual Settings reopen reuses its successful cached check;
  explicit **Check installed extensions for updates** fetches again. The existing
  module-clock input proves the one-hour boundary, not elapsed browser time.
  Checks do not install. The separate actual Git installer/updater gate covers
  default/main, `#main`, `#dev` and fixed `#v1.1.1`; selected refs do not follow
  other branches/tags. Same-version changed commits produce no offer. Failed
  broken-runtime/foreign-identity/malformed-manifest updates preserve previous
  bytes/state. Inert folder/ZIP fixtures installed through real host endpoints
  have no Git offer in Settings; Git-equivalent manual replacement retention is
  not certified.
- **Service and views.** The old service PID exits on replacement; subsequent
  access starts another with retained progress. The continuously mounted board's
  execution context changes. Rail/Work Status are checked on subsequent access,
  not asserted to stay mounted simultaneously. Counts match before/after and after
  the next report. New guests make no compatibility-route requests and show no
  former notice/line; progress and English/Russian controls remain available.
- **Load observations.** Watched delivery shows matching after update. Unknown
  screenshots use an invalid synthetic expectation file, and differing-load
  screenshots use an appended fixture companion comment plus explicit owned
  location reload with the old service baseline. Differing load still allows an
  authorized report. Service-failure screenshots use an owned startup-fault seam;
  original bytes are restored and history remains. These seams are not naturally
  occurring update failures.
- **Caller-owned configuration.** A separate fresh-process API Git replacement
  (unchanged approved capabilities, not a second UI consent test) from synthetic
  1.1.3 → 1.1.4 observes matching → different → matching after the next report turn
  without restart, then matching after explicit fixture restart. Caller config
  stays `{}` and history survives. This is the service's loaded-fingerprint
  observation, not independent attestation of which cached importer executed.
  The add/remove/toggle restart caveat remains separate. No automatic restart,
  all-session activation or graceful cancellation guarantee is established.

The compatibility route remains network-free unknown/unavailable for at least one
release. Old cached notices last until a successful compatibility read or remount;
new guests never call the route. Source/built-service, mixed-version and portable
distribution checks complement, rather than replace, the native journey. Private
evidence records bundle hashes, operation counts, English/Russian screenshots and
zero remaining owned processes/listeners after cleanup. GitHub's controlled GFM
render strips custom-scheme Markdown links, so README offers a copyable Git URL,
not an unverified install button.

## Report tool presentation

The neutral manifest contribution was exercised on isolated **Linux OpenChamber
web 2.7.1**, independent **OpenCode 2.2.7**, **Node 24.22.2**, **Bun 1.3.14** and
disposable Chromium. The native transcript name was confirmed as
`agent_progress_report` before adding the rule. SDK **2.7.0**, plugin SDK **2.1.4**,
the **>=2.7.1** host floor, grants and shipped runtime entries remain unchanged.

```sh
timeout -k 10 600 node --experimental-strip-types tests/fixtures/managed-companion-host.ts \
  --report-tool-presentation --host-module <isolated-2.7.1-server-index.js> \
  --opencode-binary <independent-2.2.7-binary> \
  --chromium <installed-chromium> --artifacts <local-evidence>
```

The fixture reuses managed installation/approval and explicit configuration with
fresh HOME/XDG roots, a rootless loopback-only namespace and a credential-free
scripted provider. It checks real start/change/revise/finish calls, identical
replay, same-status change, conflict, unfinished refusal, schema rejection and
accepted reporting with denied capture. Native message identities correlate each
row with its actual transcript; pointer/Enter/Space disclosure, checklist glyph,
literal receipts/JSON errors, native red errors and a 390 px chat are inspected.
The native error UI flattens whitespace but retains the error message. An unrelated
file-read row stays generic. Disabling the extension restores the generic tools
glyph on retained messages without changing reports; the host's generic humanized
name coincides with the neutral manifest label. Cleanup verifies no owned processes
or listeners, zero credentials and no remote provider transport.

The richer subtitle is deliberately **no-go**: effective and same-status calls are
not distinguishable from receipt alone, and denied capture is established by a
subsequent read, not by the accepted receipt. This is not a reproduction or diagnosis
of a previously reported accepted-but-ineffective defect, nor proof of model
compliance, Electron, Windows, relay or screen-reader behavior. See
[the presentation contract](ui.md#report-calls-in-chat).

Folder/ZIP SDK parsing preserves the contribution. Older-parser tolerance is not
older-host installation support: inspected SDK 2.5.1 already recognizes `tools`.
The existing version gate remains authoritative; the isolated 2.7.0 installer
refuses the candidate folder and ZIP with `host-too-old`, requiring 2.7.1. No floor
reduction or universal claim that old hosts ignore the field is made.

## Plan composer fixture coverage

The candidate requires **OpenChamber >=2.7.1**, retains build SDK **2.7.0**, and was exercised on isolated
Linux **OpenChamber web 2.7.1**, with independent **OpenCode 2.2.7**, **Node
24.22.2** and **Bun 1.3.14**. This is web/Linux evidence, not Electron, native
Windows, phone or relay certification. The package version remains unchanged;
a development candidate is not a new published release.

The real-host driver is `tests/browser/plan-composer-qa.ts`. Supply only a fresh
credential-free host and fixture, never a live profile:

```sh
timeout 600 node --experimental-strip-types tests/browser/plan-composer-qa.ts --artifacts <local-evidence> --host-url <isolated-loopback-host> --fixture <disposable-fixture.json> --control-url <disposable-loopback-control> --chromium <installed-browser>
```

The fixture uses synthetic HOME/all XDG roots, a throwaway host/CLI installation,
a credential-free scripted provider and a rootless loopback-only namespace. It
loads the current shipped service/background bytes, seeds reports through Store
operations using real unprompted sessions, and explicitly supplies verified test
bindings. That binding technique is test setup, not automatic source discovery
or installation acceptance. The actual web UI is enabled, not API-only. The
extension never sends. After recording zero provider calls for all extension
journeys, the harness acts as the user and sends one chip to the local scripted
provider to verify its outgoing context. No remote or paid model is called.
Owned processes and temporary profiles are removed.

Coverage includes the real `@` rows and chip, selection-time resolution compared
with the service, removed-target refusal, the host's session **Export** submenu
with both action labels, an inactive clicked source, a saved finished choice and
other-plan notice, append into an existing active draft, an active-chat switch
while the source read is held, no/one/several plans, service refusal and permission
withdrawal. Success feedback explicitly names the **active chat** and review before
sending. The chip gate captures the outgoing scripted-provider request and checks
that decoded content contains the full resolved summary exactly. Read-only
DevTools inspection of the chip handler's captured guest-reference `contextText`
provides additional evidence; this host has no visible context-text inspector.
Closure inspection is version-qualified test machinery, not a supported host API.

Distribution checks separately cover the current SDK guest validator, background
HTML/classic-script folder/ZIP allowlists, nine generated-entry parity checks and
Git entry hashes with no consumer compilation. Unmodified **2.5.1** parser and
installer checks of the earlier `>=2.5.1` feature-floor candidate accepted its
background/actions and existing views while dropping unknown `mentions`. That is
historical parser/installer tolerance, not a full older-host UI journey or a
promise that a later candidate declaring a higher host floor can install there.
Current installer gates derive the actual version from the supplied isolated
`@openchamber/web` package, not a hardcoded minimum. On an older installer, run
`scripts/verify-host-package.ts <candidate-folder> --expect-refusal` with
`AGENT_PROGRESS_HOST_MODULE` pointing to that installer's unmodified `install.js`;
the folder and sibling ZIP must both receive `host-too-old`, required `2.7.1`,
without registration. Use synthetic HOME/all XDG roots, as for supported installs.
Use the selected candidate's manifest and explicit host-version gate for support
and installation claims. Full portable CI is separate from these host checks;
its five native-runtime exclusions remain unchanged.

## Post-release 1.1.1 checks — 2026-11-12

These checks close the three deferred Linux checks for published **1.1.1**.
`git ls-remote --tags origin` confirmed `v1.0.0` and `v1.1.1`; the latter resolves
to `9cb5c422dadb550883925731c632bfc89dcf41d4`, also the checked `main`/`dev` tree.
Test-only adjustments described below do not change release runtime bytes.

Environment: **OpenChamber 2.7.0**, **OpenCode 2.2.7**, build SDK
**@openchamber/sdk 2.7.0**, plugin/client **2.1.4**, standalone **Node 24.22.2**,
and **Bun 1.3.14**. The extracted desktop executable reports **Electron 45.2.1 /
Node 24.22.1 / Chromium 156.0.8078.75**. Node 24.22.2 ran the tests and imported
host-installer module; its result is not a host-Node installer run.

Only an executable copy of the installed AppImage was extracted, to
`/tmp/opencode/agent-progress-t4-appimage/squashfs-root`. No installed profile,
configuration, authentication or data was copied. AppImage SHA-256:
`11a52bccbfbd00aa7b5a66ef48119df76b8cff259faee47499647a02c19bb401`;
`resources/app.asar` SHA-256:
`ac67c833657f0185c02486d7be03fbad0ec524174bdf21c38ac12f309801837b`.
The managed PATH wrapper and bundled CLI were not invoked. The official CLI archive
URL in [Historical CLI isolation](#historical-cli-isolation) now supplies **2.2.7**,
not the historical 2.2.2 pin or the desktop manifest's bundled 2.2.6. This run
explicitly selected and verified the new independent executable; it does **not**
certify 2.2.6 or replace the historical 2.2.2 artifact pin. Archive SHA-256:
`89a6cee227b54bc011179c528a5e63176032462b1a5e21723b616801cddc2ca7`;
executable SHA-256:
`589253d36810f21217edd51545cd435b328cdc3cf4f451fbe0cce6f88afcf5e1`.

### Native sub-agent activity — passed after test maintenance

```sh
OPENCODE_BINARY=/tmp/opencode/agent-progress-probe-cli/opencode \
  EVIDENCE=/tmp/opencode/post-release-evidence/activity-current-host \
  timeout 680 node --experimental-strip-types --test tests/backend/subagent-activity-runtime.test.ts
```

The default regression phase finished with **exit 0; 1 test passed, no skips**.
Both built-in and slim **2.2.25 V2** profiles report `pass: true`, driver exit 0,
stopped hosts, removed process groups and removed private fixture roots. This is
the source-built companion regression, not a verbatim-built companion rerun.
The built-in profile mounted the real rail, Work Status and board, exercised
session switching and a native activity change, and reached UI stage `complete`.
Both profiles passed the production report/binding, restricted-child, run outcome,
handoff, recovery, authenticated API and durable-restart assertions. Scripted local
providers ran in loopback-only network namespaces with zero provider credentials.

The first attempt exited 1 at `current-plan-roster-readiness-timeout`: the harness
required a finished linked run outside the records disclosure, but the shipped UI
intentionally folds every non-running record. Readiness now requires the retained
Accepted fact regardless of folding; the semantic check requires that finished
run to be folded. A second attempt exited 1 at `native page open:
non-actionable-target`: OpenChamber 2.7.0 moved extension pages into the sidebar's
**More → Extension pages** menu. The driver now uses that real menu. Neither was
a demonstrated product defect; no product code or safety assertion was relaxed.
The focused harness tests pass **34/34**, including folded-record readiness and
rejection of missing Accepted facts; root and UI typechecks also exit 0.

### Versioned desktop offers and companion upgrade — observed

A fresh private HOME/XDG/profile under `/tmp/opencode/post-release-upgrade` used
the extracted AppRun and existing Wayland transport, with an empty inherited
environment and the independent CLI override. Clean tracked-file projections of
`v1.0.0` and `v1.1.1` supplied the extension and unchanged built companion bytes.
The real Settings → Extensions folder installer, permission approval and extension
setup/review/confirmation installed 1.0.0; an explicit isolated **Restart OpenCode**
loaded it and created run storage format 1.

The 1.0.0 board visibly offered **Official main version 1.1.1 available · This
extension 1.0.0**. Extension replacement used the real folder **Reinstall** and
permission approval, not Git update discovery or a host Git-update button. The
1.1.1 board then offered **Companion update available**, **Installed 1.0.0 → bundled
1.1.1. Nothing changes until you review and confirm.**, and **Review update**.
Review displayed installed 1.0.0 and bundled 1.1.1; checking confirmation and
selecting **Update** succeeded. The board requested an OpenCode restart; a
read-only SQLite query still found format 1 and the retained loss flag.

Settings → General → **Restart OpenCode** restarted only the disposable managed
runtime. A read-only verification command exited 0 with `format: 2`,
`planPreserved: true`, `seededRunPreserved: true`, and `totalRuns: 1`. The released
Store APIs had seeded one working plan, one succeeded dispatch and a gap, using
real unprompted parent/child sessions. These are synthetic recording inputs, not
a model-driven subagent execution. The plan snapshot and seeded run payload were
preserved. Migration retained `loss: 1`, `last_loss_at: null`, `loss_sequence: 0`
and `dismissed_loss_sequence: 0`. The board still showed the plan and **1 finished**;
its expanded **Partial** cue said **Some run information wasn’t recorded. This
happened before the update; the date is unknown.** The reload-pending copy cleared.

Provider credential inventories were zero before and after; no prompt or paid
model was called. Owned-process HOME/XDG checks found no unexpected scopes. All
owned desktop/runtime/service processes were stopped; the owned process group and
CDP listener were absent afterwards. This is versioned notice/companion-update
evidence, **not** certification of host Git auto-update, rollback, model-driven
runs, Windows or macOS. Local-only screenshots and native JSON are under
`/tmp/opencode/post-release-evidence/`; they are not shipped artifacts.

### Extracted-host folder/ZIP installer gate — passed

After extracting the copied ASAR with its unpacked dependencies:

```sh
bun run package
AGENT_PROGRESS_HOST_MODULE=/tmp/opencode/agent-progress-t4-appimage/squashfs-root/resources/app-extracted/node_modules/@openchamber/web/server/lib/guests/install.js \
  timeout 180 bun run verify:package
```

Both commands exited **0**. The actual **2.7.0** host module reported
`actualHostInstaller: "folder"` and `"zip"`, each with `accepted: true`, version
`1.1.1`, and all three guest entries plus the service entry present. At that time the
gate passed the declared minimum host compatibility value `2.5.1` to that module;
it does not spoof the module's implementation version. Package lifecycle and
content checks passed too. Installation used disposable registries only; this
gate launches no guest or desktop and installs nothing into the real host. No
new product defect was identified by these three checks.

## Native structured task capture limitation

As of **2026-11-02**, inspection of the pinned `@opencode/plugin`/client/schema
**2.1.4** types, including the full `V2Event` union, finds no supported typed native
task/todo/planner contract to mirror: no task create/update/remove/reorder events,
task status, dependency edges, native task identity or task-list revision semantics.
These SDK types are distinct from the **2.2.2** native test host (see the
[current native proof pin](#current-native-proof-pin--222)) and the installed host
observed at **2.2.0**. This finding is version-qualified, not a claim about every
runtime or third-party tool.

The available structured signals do not supply the missing contract:

- Session `parentID` and fork metadata describe lineage, not task dependencies.
- `SubtaskPart` is a dispatch record, without task status, dependencies or
  update/remove/reorder semantics; its part identity is not a native task identity.
- `experimental.todo` is a configuration flag with no typed task surface behind it
  in the inspected types.
- Event-envelope `seq`/`version` provide per-aggregate ordering, not task-list
  revision semantics.
- Generic structured tool results carry task semantics only when a tool defines
  them; tool success alone does not establish task progress.

Explicit producer reports through the companion's authenticated report path remain
the only task/dependency mutation authority. Existing passive sub-agent run capture
stays separate from task progress; a successful run establishes neither accepted
task completion nor task ownership or dependencies. See
[reporting participation](contracts.md#reporting-participation),
[the unchanged reporting protocol](contracts.md#advisory-activation-does-not-change-the-protocol)
and the [sub-agent run read seam](backend.md#sub-agent-run-read-seam).
The later dependency diagram must consume producer-reported `Item.dependencies`
only: ordering, lineage, similar titles, file writes and concurrent activity are
not evidence for inferred edges. No dependency-diagram UI is implemented here.

**Evidence limit:** no exhaustive live-emission audit of the **2.2.2** or **2.2.0**
hosts was performed. Typed-contract inspection, existing native runtime tests and
the plugin documentation consulted on 2026-11-02 bound the finding, but do not
exhaustively prove the absence of undocumented live emissions. This section adds
no fresh native-host verification or compatibility certification; historical probe
results below retain their original scope.

**Deferred proposal, not implemented:** a cooperating producer can deliberately
report through the current authenticated report path today. Native capture could
be reconsidered only after a pinned runtime documents typed task identity,
lifecycle/status, dependency and revision/ordering semantics with validatable
authorization/provenance. The smallest integration within the existing
plugin/Store/source owners would then require separate review. Neither a future
SDK upgrade nor a task-named event family may auto-enable capture.

## Native Windows verification

The native implementation adds no separate binary or compilation requirement for
users. It uses the existing bundled JavaScript, ordinary Windows file identity
checks, and Windows PowerShell 5.1/public .NET APIs for ownership and private ACLs.
The [setup guide](setup.md#native-windows) defines its local-account, path and
durability boundary. Historical Linux observations below remain scoped to their
original configurations.

Measured Windows environment: Windows 11 Pro x64, build 26300.9711, local NTFS,
normal account token; OpenChamber 2.5.2 / Electron 44.9.3 / Node 24.22.0, with
bundled OpenCode 2.1.4 / Bun 1.4.4 / Node compatibility 26.3.0 / SQLite 3.53.4.
Standalone development Node 24.19.0 uses SQLite 3.53.3 and is supplementary evidence.
Development checks accept Node 24.x >= 24.19.0; later 24.x releases are not
separately certified. CI's release gate remains pinned to exactly Node 24.19.0; a second job runs the newest 24.x.

The native OpenCode run uses a credential-free scripted provider and the real
registered tool/guidance/runtime: start/read/change/finish, fresh document capture,
direct child and attributed relay, denied capture with valid structured commit,
cross-runtime SQLite busy handling, disable/enable of loaded code, and fresh
recapture all passed. No external model/provider requests were made. Scripted
execution proves the integration, not universal model compliance.

The Windows filesystem suite covers private creation/inheritance and refusal,
Unicode/case/separators/junctions, ACL mutation/cache invalidation, unsafe storage
parents, ordinary source reads, SQLite side files, binding, selector persistence,
interrupted activation/removal, hard-linked state refusal, and missing PowerShell.
Local runs explicitly skip two unavailable fixtures: the account cannot assign
a foreign owner, and Windows/.NET refused a persisted canonical callback
ACE fixture. Public .NET in-memory descriptors separately verify foreign-owner
policy and rejection of null, callback, object and audit DACL forms. Persisting
those unavailable fixtures is not claimed as tested.

Actual OpenChamber host startup opened the shared SQLite store under its bundled
Node runtime. Panel, Work Status and full page showed matching reported counts,
correct project/session scope, captured literal document text and explicit denied
capture. Native setup checks covered edited and cleared fields surviving late
hints, invalid-folder refusal, and valid Windows roots reaching review without
confirming an installation. A labelled transport seam verified retained counts
and automatic recovery; it is not evidence of a real network outage.

The assembled extension folder and ZIP both installed into an isolated native
host. The ZIP's actual spawned service matched the rebuilt entry bytes and
reported ready/SQLite available under bundled Node 24.22.0. The companion ZIP
also passed read-only inspection, installation, standalone disable/enable and
standalone removal using packaged Electron's Node mode; synthetic plan data and
installation history remained available afterwards. These checks used fresh
synthetic directories, without changing a live profile or installing dependencies.

## Historical Linux probe — 2026-10-24

The initial Linux capture/desktop probe **passed with limitations for its bounded
scope**; that probe was not an installable production product. It predates the
[installable distributions](setup.md#v1-installable-artifacts); its limitations
below describe that probe, not the current installation workflow.
See `evidence/compatibility/probe.md` for the per-claim record. Primary desktop
evidence is `evidence/compatibility/ui-probe.md` and `ui-runtime.json`; accepted
live backend outcomes are in `backend-auth-live.json` and
`backend-auth-subtests-summary.json` under `evidence/compatibility/`.

### Exact dependencies/runtime

Bun1.3.14 manages tooling/build only; TypeScript5.9.3, @types/node24.19.2,
@openchamber/sdk2.5.1, @opencode/plugin2.1.4; `bun.lock` pins transitives.
Node24.19.0 ran backend tests and standalone HTTP smoke for this probe. Current
checks accept Node 24.x >= 24.19.0, without separate certification of later 24.x.
Independent downloaded
OpenCode2.1.4 embeds Bun1.4.4 (Node compatibility version26.3.0).
OpenChamber2.5.1 was observed spawning its service with Electron44.9.3 as
Node24.22.0, no Bun. The actual service opens the shared SQLite DB; SQLite3.53.4
from the same binary standalone is supplementary, not an actual service query.

Commands recorded for the initial probe (historical semantics):

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test:backend
bun run build:backend
bun run check
```

At the initial probe, `build` aliased backend build only, NOT guest/package assembly,
and `check` was typecheck + backend tests + backend build. There was no `test:browser`
or aggregate guest QA script. Today, `check` also assembles and verifies packages;
it still omits the UI typecheck and browser tests. Use the current contributor
instructions above for prerequisites and the complete portable check.
All three guest bundles were built with the pinned SDK bundler:

```sh
bun run bundle:guest ui/panel/main.ts ui/panel/main.js
# Same invocation for ui/status/main.ts and ui/page/main.ts.
```

Recorded shared validation on the initial stable tree (not rerun for
this docs reconciliation): `bun run check` (typecheck,6 backend tests,backend
build), `node_modules/.bin/tsc -p ui/tsconfig.json --noEmit`, and
`node --experimental-strip-types --test tests/browser/*.test.ts` (4/4).
All three `ui/*/main.js` SHA256 hashes were verified against the screenshot bundle
hashes in `evidence/compatibility/ui-runtime.json`.

## Agnostic activation (historical0.2.4 package validation)

The credential-free2.1.4 native probe in
`tests/backend/progress-activation-runtime.test.ts` uses a separate test observer
and deterministic local AISDK package inside a fresh Linux network namespace.
It asserts **production** guidance and one-shot hints in actual outgoing scripted
requests, not merely observer callback snapshots. Real `write` create/replacement,
`edit`, a write error, effective report-tool hiding for a restricted child and an
authenticated source-free report receipt/Store write are exercised. Installed
adapter tests exercise production hooks with a fake host and real Store. Scripted
choices prove plumbing, never LLM compliance or universal activation. Earlier
observer-only/baseline-package evidence remains archived separately. The final
package validation also passed this native test against the packaged companion entry
and matching sibling guidance, without rebuilding the accepted guest bundles.
This validates those bytes in isolation, not a real-user install or public release.

Pinned file metadata is `write`/`edit` with `input.path` (not legacy `filePath`),
`status: "completed"` and structured `result.output`; errors are a separate
`status: "error"` branch. These single-file tools expose no separate successful
partial outcome. Shell writes, opaque `patch`/`apply_patch`/`functions.patch`,
unknown tools and arbitrary/non-Markdown document names are **not detected** by
the conventional-path hint; source-free deliberate reports still work. This
type of opaque patch write can therefore receive no file hint.
The primary context still receives recurring generic guidance when eligible.
No patch-body or content parsing is implied. Local diagnostic evidence and the
exact bounded coverage are in `evidence/activation/{native-host.md,coverage.md}`.

Run the production activation and native tests with Node 24.x >= 24.19.0 and existing Bun;
the native probe requires an independent OpenCode 2.x >= 2.2.2 binary plus working rootless
`unshare -Urn` and `ip`. It fails rather than falling back to an online provider.
`ACTIVATION_COMPANION_ENTRY=build/companion/index.js` selects those verbatim
companion bytes and sibling guidance, with the observer separately loaded. Use
that argument against the selected activation package; unchanged old bundles do
not contain activation and cannot pass the production-guidance assertions. The
browser helper was also exercised against the packaged payload with real
Store writes/awaited disposal, but its hook stubs prove no native/browser behavior.

```sh
node --experimental-strip-types --test tests/backend/progress-activation.test.ts tests/backend/plugin-setup.test.ts tests/backend/production-contract.test.ts
node --experimental-strip-types --test tests/backend/progress-activation-runtime.test.ts tests/backend/plugin-failure-runtime.test.ts
```

## Progress resume capsule verification

The separately named `progress resume` native case verifies production activation
and Store lookup on OpenCode **2.x >= 2.2.2** at the actual outgoing scripted-provider
boundary. It uses direct synthetic Store construction and local plugin loading,
not installation. The observer records metadata and the synthetic recovery section
from actual outgoing system parts; it never manufactures recovery in regression
mode or retains conversation/summary text. No real model or provider credentials
are used. Node 24.19.0 and OpenCode 2.2.2 are the tested baselines; later 24.x/2.x
releases are accepted but not separately certified. The test requires Node 24.x
>= 24.19.0, existing Bun/dependencies, working rootless
`unshare -Urn`/`ip`, and the already-present independent binary below. A missing or
wrong-version binary fails closed; do not substitute the managed PATH launcher,
download a runtime, or select the older installer-based native case for this check.

The host range is distinct from `@opencode/plugin`/client **2.1.4** and the current
build dependency `@openchamber/sdk` **2.7.0** (current candidate minimum OpenChamber host **2.7.1**).
Verified independent2.2.2 archive SHA-256:
`3a38b8c284450a5ca81a2c1ebbf29ebe05e618518f095da0066652167eb0eb33`;
executable SHA-256:
`4452778e23fbda075eb2f83c2574b1d7452af8e347c52b8d9e016838b9c530d9`.
Historical2.1.4 success below/elsewhere is not a fresh2.1.4 rerun. The exact
selected2.2.2 source-built and verbatim-built runs pass all21 existing resume
scenarios; local proof is `evidence/resume-capsule-host-ordering/`. Focused A2 also
passes under2.2.2; it can be selected separately with `--test-name-pattern='^A2 '`.

```sh
export OPENCODE_BINARY=/tmp/opencode/agent-progress-probe-cli/opencode
export EVIDENCE=evidence/resume-capsule-host-ordering/source
node --experimental-strip-types --test tests/backend/progress-resume-store.test.ts tests/backend/progress-resume-activation.test.ts tests/backend/production-contract.test.ts tests/backend/progress-activation-contract.test.ts
bun run typecheck
PROGRESS_RESUME_PHASE=regression node --experimental-strip-types --test --test-name-pattern='progress resume' tests/backend/progress-activation-runtime.test.ts
bun run build:backend
EVIDENCE=evidence/resume-capsule-host-ordering/built ACTIVATION_COMPANION_ENTRY=build/companion/index.js PROGRESS_RESUME_PHASE=regression node --experimental-strip-types --test --test-name-pattern='progress resume' tests/backend/progress-activation-runtime.test.ts
git diff --check
```

The built run copies unchanged companion bytes and sibling guidance, recording
the tested entry's SHA-256. It does not install, package, rebuild guests or certify
a release. Native runs own one isolated host/process group, verify zero credential
inventory and loopback-only networking, and remove their disposable roots.
Local-only source/built `outgoing.json`, synthetic adapter `lifecycle.json` and
`checks.md` records distinguish source/built integration from the earlier test-only sentinel
gate in `runtime-gate.json`.

Coverage includes the current-revision pointer, two unconfirmed candidates,
assigned-only linked child, unlinked/restricted child suppression, finished-only
fallback, uncompacted resume, failed/empty compaction and disable/archive/delete
before delivery. Summarization receives no recovery and its inputs/result remain
unchanged. Scripted text proves integration, not model willingness/compliance or
OpenChamber desktop/AppImage behavior. No new cross-version or native Windows
capsule certification is claimed by this Linux test.

Correlation retains one bounded observation window even when the compaction hook
arrives before its streamed start. The inspected
[2.2.2 hook types](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/plugin/src/effect/session.ts)
expose no shared attempt token. Strict event-creation/local-observation containment,
sequence/reason and lifecycle fences permit both observed hook/start orders without
reading summaries. Boundary ties, clock inconsistency, stale/precompute-style hooks
and overlapping starts conservatively omit recovery. There is no new timer,
persistence or guarantee for background precomputation. Both delivery orders and
retirement/replay/cap boundaries are deterministic unit/installed-adapter coverage.

With the 2.2.2 native re-pin in place, the full `bun run check` aggregate passes
on this branch: **331 passed, 0 failed, 18 Windows-only skips**, including the
native subagent/desktop family. Earlier blocked-status statements are historical.
This result does not claim a desktop installation.

**Known replay limitation:** pinned2.1.4 event subscriptions are volatile/live-only,
with no replay controls, and the production plugin uses the native in-process
stream. Actual host replay cannot be exercised through that surface and is not
reported as passed. Public native plugin reload was exercised: an old completion
does not re-arm recovery and a fresh compaction delivers it. Duplicate/sequence
guards are separately unit-tested. Actual runs trigger manual compaction only;
automatic reason handling is covered at the unit layer. Historical evidence above
remains scoped to its original artifacts and does not certify this feature.

### Future interoperability, not a required integration

A cooperating vendor could deliberately report source-optional plans using the
existing report operations and authenticated host tool context, then separately
define what accepted handoff means. Worker completion/Ready alone is not accepted
handoff. Any missing typed lifecycle event needs demonstrated demand and separate
review; RPC-supplied session IDs are not authority. No Slim dependency, adapter,
new declaration gate or external repository change is implemented or required.

## Historical CLI isolation

The isolated probe used an independent temporary CLI download. The PATH
`opencode` wrapper is owned by real OpenChamber and cannot be used for isolation.
Never bypass it with the bundled executable or stop the real server. Credential
transfer used only the separately reviewed credential-only test route,
not by copying a live DB/config/profile. The independent archive came from the official V2 URL:

```sh
mkdir -p /tmp/opencode/agent-progress-probe-cli
curl -fL --max-time 90 https://opencode.ai/update/api/latest/cli/opencode/opencode-linux-x64.tar.gz -o /tmp/opencode/agent-progress-probe-cli/cli.tar.gz
tar -xzf /tmp/opencode/agent-progress-probe-cli/cli.tar.gz -C /tmp/opencode/agent-progress-probe-cli
```

Historical 2.1.4 archive SHA256:
`2edaf8cf96e81dec5ee996a3196b03345cf59e5a1673d83a4599bb4afc5c5f6d`.
This digest describes the earlier host only, not the current native proof pin.

Recovery on2026-10-24 re-downloaded the official archive: actual version2.1.4,
same SHA256 shown above. The host restart cleared retained temporary CLI/desktop
fixtures and the extracted AppImage; repository evidence remains available.
Future desktop/UI reruns require fixture regeneration; none was performed for this
recovery. Early live refusals and later accepted z.ai root/native/move/compaction
successes are distinguished in the dated auth safety/review evidence; final
credential cleanup and zero owned processes/roots were verified.

### Current native proof baseline — 2.2.2

Verified on 2026-10-30: the official URL above now supplies an archive whose SHA-256 is
`3a38b8c284450a5ca81a2c1ebbf29ebe05e618518f095da0066652167eb0eb33`.
The extracted independent executable reports `opencode v2.2.2`; its SHA-256 is
`4452778e23fbda075eb2f83c2574b1d7452af8e347c52b8d9e016838b9c530d9`.
The archive remains `cli.tar.gz` and the executable remains `opencode` in the
disposable `/tmp/opencode/agent-progress-probe-cli` fixture directory. Native runtime
tests require OpenCode 2.x >= 2.2.2; later 2.x releases are accepted but not
separately certified. Installed plugin/client SDK packages remain pinned to
2.1.4, independently of the runtime binary. Earlier observations in this guide
remain historical and do not certify the new host.

A subsequent restart lost the temporary 2.1.4 executable. Parent recovery searches
found no matching local copy, public release, npm package or archived snapshot;
2.1.4 became unavailable from the searched public sources after the vendor moved
`latest`. The owner selected 2.2.2 rather than waiving native proof. That recovery
decision does not claim a permanent inventory of all possible private archives.

`latest` is mutable: on every fetch verify the archive digest against this pin
**before extraction/use**, then verify extracted `--version`. A changed digest or
version fails closed; do not silently follow `latest` or download from inside an
isolated test. Archive identity is provenance, not behavioral compatibility proof:
all native regression families and final emitted companion runs must still pass.

## Historical CLI probe reproduction

```sh
bun run build:backend
R=/tmp/opencode/agent-progress-probe-NEW-ID
bun run prepare:probe "$R" # refuses an existing root
mkdir -p "$R/config/opencode/plugins/agent-progress-probe"
cp build/companion/* "$R/config/opencode/plugins/agent-progress-probe/"
ln -s "$PWD/node_modules" "$R/config/opencode/plugins/agent-progress-probe/node_modules"
printf '{"$schema":"https://opencode.ai/config.json","update":"disable"}\n' > "$R/config/opencode/opencode.json"
node scripts/cli-probe.ts "$R" /tmp/opencode/agent-progress-probe-cli/opencode 41971
```

Driver builds an allowlisted environment from scratch (no inherited managed
auth/config/provider variables), creates a new temporary server password only in
memory, suppresses startup output, uses public authenticated HTTP, and stops every
owned process in `finally`. It never runs model prompts. It starts ports41971..73;
use a different unused base port if occupied; never stop another process to free
one. Check no ancestor or system OpenCode configuration applies before reusing
this route elsewhere. None was present for the recorded fixture.

Main implementation and supporting build/setup/test/probe tooling are TypeScript.
The former temporary Python HTTP driver was replaced by `scripts/cli-probe.ts`;
there is no Python service or setup path. Generated JavaScript runtime bundles
are expected.

Resolved clean paths were established with `debug paths` before launching;
`backend-paths.txt` records all paths. Fixture descriptor explicitly binds config
and data roots; mismatching scopes or OPENCODE_DB/OPENCODE_CONFIG overrides refuse
plugin activation. This proves that particular explicit fixture binding, not a
general installer resolving every custom/channel/platform path.

## Historical desktop fixture and service request

Historical prepared reusable fixture (subsequently cleared by the host restart):
`/tmp/opencode/agent-progress-probe-live-t1b/extension`.
Its service descriptor references the DB actually written by OpenCode plugin
processes at `/tmp/opencode/agent-progress-probe-live-t1b/data/progress.sqlite`.
Guest files were built under `ui/**` and copied into the prepared
extension. All owned probe processes were stopped.

That **folder** was installed through Settings → Extensions → Add in the
verified isolated desktop host. Before grant, the host mounted no frames and
spawned no service; its service route returned400 NO_SERVICE. After approval of
sessions/service: ready service and actual `host.serviceRequest` health/progress200
in all3 frames. This is host-level denial evidence, not a live guest denial banner.
Guest requests: `serviceRequest({method:'GET',path:'/health'})` and
`serviceRequest({method:'GET',path:'/probe/progress'})`. Returned store/source IDs
match `backend-plugin-sqlite.json`; fixture-only/unverified diagnostics remain
visible. SDK surface/directory context proved, but session=null because no prompts
were sent. Actual current-session context/navigation remains unproved; fixture
session IDs are never navigable. See `ui-probe.md` for screenshots/interactions.

## Historical isolated OpenChamber launch

The available installed OpenChamber executable was the OpenChamber2.5.1
AppImage (SHA256 in `ui-runtime.json`), not a web CLI. That exact AppImage was
extracted to a temporary directory and isolation verified before installation.
The earlier direct-binary DISPLAY candidate was not the tested route. OpenCode
`serve` is NOT OpenChamber and cannot host extension frames. No sibling source
installation/build/modification or managed bundled-CLI invocation was used.

Executed commands below are sourced from `evidence/compatibility/ui-probe.md`
Commands/Isolation; they are historical reproduction instructions, not a request
to relaunch or overwrite profiles. For reproduction, set `OPENCHAMBER_APPIMAGE`
to the absolute path of that installed AppImage; its original personal path is
omitted here. H used fresh0700 directories. X is the
temporary extraction directory. APPDIR is required (its omission caused the first
attempt to exit127); no APPIMAGE variable was passed, preventing replacement of
the installed AppImage. Startup output was discarded to avoid printing secrets.

```sh
X=/tmp/opencode/agent-progress-t2-appimage
H=/tmp/opencode/agent-progress-probe-t2-host
# Extraction was executed with X as the working directory:
# "$OPENCHAMBER_APPIMAGE" --appimage-extract
env -i PATH=/usr/bin:/bin SHELL=/bin/sh LANG=en_US.UTF-8 APPDIR=$X/squashfs-root \
  HOME=$H/home XDG_CONFIG_HOME=$H/config XDG_DATA_HOME=$H/data XDG_STATE_HOME=$H/state \
  XDG_CACHE_HOME=$H/cache XDG_RUNTIME_DIR=$H/runtime WAYLAND_DISPLAY=/run/user/1000/wayland-1 \
  OPENCHAMBER_DATA_DIR=$H/openchamber OPENCHAMBER_DESKTOP_USER_DATA_DIR=$H/electron-user-data \
  OPENCODE_BINARY=/tmp/opencode/agent-progress-probe-cli/opencode OPENCHAMBER_RELAY_HOST=off \
  $X/squashfs-root/AppRun --ozone-platform=wayland --password-store=basic --remote-debugging-port=9333 >/dev/null 2>&1
```

Checks covered installed bundle controls, migration/default roots, login-shell
probing (only PWD/XDG_DATA_DIRS added), actual main/CLI/service environments and no
real-home config/data/cache fds. Independent CLI override honored; user's instance
57123 untouched. Service uses host-allocated loopback port/bearer, never exposed to
the guest. Relay disabled; no relay/tunnel listener. Web/relay runtimes were not
exercised. This evidence is specific to the tested desktop build/environment.

The isolated host was stopped and no host/CLI/service processes
remained; CDP9333 and isolated host port closed. The then-retained H contained
generated local secrets and was later cleared by the restart; never copy such
profiles into repository evidence. Do not automatically
clean real directories or reuse real profiles; no server restart is authorized.

### Isolated desktop upgrade rehearsal

On 2026-11-10, the released **1.0.0** extension and built companion from
`v1.0.0` were installed on a real isolated Linux **OpenChamber 2.7.0** desktop
host using independent **OpenCode 2.2.6**. Settings → Extensions → Add extension
accepted a clean tracked-file folder projection; sessions/service permissions
were approved, and the extension's own setup/review/confirmation flow installed
the companion. The real plugin loader activated it and created format 1. The
current tracked build was installed through the same folder UI's **Reinstall**
flow, which requested permissions again. Both package versions were 1.0.0:
this was folder replacement, not the version-based extension update offer.

Content was explicitly synthetic: the release's Store APIs seeded one working
plan, one succeeded dispatch and a recorded gap, using real, unprompted host
parent/child sessions. Passive metadata recovery also retained an unknown
historical child, giving two rows (one dispatch, one historical session). No
agent/model execution is claimed; provider credentials were empty at the initial
and final checks, and no model prompt was sent.

Before companion update, the current rail showed **Different companion build
available** and **Review update**. Review displayed installed/bundled version
1.0.0 and **Same version number, different files: updating selects the bundled
files.** Confirming Update left format 1 and the retained rows unchanged. The
rail then said **OpenCode has not loaded the current companion files yet. Restart
OpenCode when convenient so agents use them** (followed by its running-session
caveat). Settings → General → **Restart OpenCode** restarted only this isolated
host's managed runtime. Activation migrated to format 2 and preserved the plan,
both rows and their counts. The rail's neutral **Partial** cue expanded to
**Some run information wasn’t recorded. This happened before the update; the
date is unknown.** Work Status showed Sub-agents counts but no gap-attention line;
the stored notice had null date, sequence 0 and `attention: false`.

Rollback through the real folder Reinstall/grant flow made the released extension
show **Progress service is not responding**, **It may still be starting. Try again
in a moment.**, and **Try again** in both observed surfaces. The host service proxy
returned HTTP 502, `SERVICE_FAILED`, **The extension's service failed to start.**
Retry and an isolated OpenCode restart did not recover it. No companion rollback
control was available in this failure state, so the current companion remained
installed; a desktop companion downgrade was not forced or tested. Schema, plan,
run rows and loss metadata stayed intact. The operational store was not
byte-identical: the still-current companion's recovery job/lease housekeeping
also changed, alongside epoch/revision bookkeeping. Restoring the current folder,
approving its grants and restarting the isolated runtime recovered the rail and
Work Status; service health returned HTTP 200 with `ready: true`.

The released UI's suggestion that this persistent incompatibility may merely be
startup delay is a rollback UX limitation, not evidence that retry can repair it.
No product code was changed. The launch used a fresh private HOME/XDG/profile,
the extracted AppImage, an empty inherited environment, private loopback ports,
and the existing Wayland socket. Owned-process checks found no real-home
environment/FD/cwd/writable-map references or inherited sensitive configuration;
the stable live desktop PIDs/start times/listeners were unchanged before and after
cleanup. All owned desktop/runtime/service processes were stopped. This does not
certify the standalone board-page entry (only the rail and Work Status were
observed), ZIP/Git installation, version-driven update discovery, model-driven
runs, desktop companion downgrade, Windows or macOS.

## Sub-agent activity — tested native and workspace signals

The initial credential-free feasibility probe targets OpenCode **2.1.4**,
`@opencode/plugin` **2.1.4**, `@openchamber/sdk` **2.5.1**, and cached
oh-my-opencode-slim **2.2.25**. Built-in and slim profiles run separately in
fresh private homes with loopback-only networking; neither uses an installed
user profile or an external provider.

Nine isolated probe invocations are recorded. The first failed bootstrap; a
location-scoped readiness request fixed that. The second exposed a test transport
marker issue. The third and fourth completed the native probe; the fourth also
attempted a disposable OpenChamber 2.5.1 renderer. Three focused continuations
proved slim V2 activation but not a usable Xvfb/X11 renderer. Two subsequent
Wayland/AppRun runs mounted a metadata-only guest through direct disposable
fixture loading and captured actual workspace SDK records. The accepted
built-in/slim matrices were not rerun in those workspace continuations.
No user profile was used.

| Profile / mode | Native observation |
| --- | --- |
| Built-in foreground / background | Structured `result.output.sessionID`, verified native parent and complete ancestry; foreground returned completed, background running |
| Built-in resume | Returned and verified the same child ID |
| Built-in parallel / delayed second call | Two candidates share an assistant-message identity; never bind the first result optimistically |
| Nested delegation | Refused by the native tool; separately API-created native nested records are fixture evidence, not successful nested delegation |
| Slim 2.2.25 V2 setup: foreground / background | Activation and actual slim hooks proven; native `subagent` executor retained, structured results and verified native child ancestry observed |
| Slim immediate resume before terminal-result acknowledgement | Slim's before hook refuses the request; no matching after hook or authoritative result. No binding. Resume after acknowledgement was not tested |
| Slim competing calls | Both verified native child results observed, but two candidates in one spawning message are ambiguous. No binding |
| Workspace onSessions / listSessions | Actual C1/C2 parent A and API-created N1 parent C1; ready Alpha/Beta directory coverage; unrelated B remains a root and Beta is absent from Alpha |
| Workspace activity | Running, idle, unknown, waiting-question and failed outcome observed; unchanged lists and another child's updates do not establish a new observation of the first child |

Native execution-start/succeeded/failed/interrupted events, active snapshots and
persisted outcomes were observed. These are session/turn observations, not task
completion or accepted handoff. A disconnected test client recovered a terminal
outcome from a native snapshot; that is not proof of SDK replay or host recovery.

The supported binding-signal boundary is: wait for the spawning assistant
message's **`session.step.ended`**, require exactly one delegation candidate in
that session/message group, and verify the matching structured result's native
child and ancestry. Otherwise do not bind. `session.step.streamed` and the first
result are not uniqueness fences. This supports the tested built-in
foreground/background/resume and slim V2 foreground/background signal paths;
it is not production automatic-binding or task-completion verification.

Slim proof uses the cached package's unmodified V2 setup through a thin test
observer entry. Its observed tool transforms add task-management tools but never
add, update or remove `subagent`; actual before/after middleware executes around
the native tool. This does not certify V1 loading, other versions or resume modes
that the slim guard refuses.

Actual workspace `GuestSessionRecord.parentId` is now proven on the pinned host;
the separately observed selected-session context has no parentId field.
Both native-created children were visible without progress reports. The test
catalog contained only the enabled metadata fixture with the existing `sessions`
grant; no folder installation/approval was needed.

Two important limits apply to this host version:

- A native interrupted execution produced SDK `idle` with raw outcome `completed`.
  That SDK value cannot distinguish success from cancellation; treat the
  unsupported end reason as unknown, never as successful completion.
- During an observed roughly ten-second native-process outage, SDK reads still
  returned cached `ready` coverage and `running`. Readiness is not a heartbeat or
  proof of connection. Do not renew per-child freshness from repeated reads,
  unchanged snapshots, title changes or another child's activity. Same-endpoint
  restart retained IDs/parentage and yielded idle with unknown outcome, not proof
  that the lost turn succeeded. Native last-completed outcome can also be stale.

These are supported observations with cancellation/liveness limitations, not a
new activity archive or alternate API. Explicit reporting/linking remains the
fallback; observation never establishes assignment, task completion or acceptance.

The opt-in probe entry is `tests/backend/subagent-activity-runtime.test.ts`
(`SUBAGENT_ACTIVITY_PHASE=probe`); both Wayland workspace-only invocations passed.
The slim subprocess passed in both focused two-profile continuations. Normal test runs
do not silently launch the exploratory probe. All owned processes and roots
were cleaned up. Loading/error coverage, retrying/waiting-permission activity and
switching to a different runtime/source were not exercised by this probe. The
bounded signal probe is complete with those limits; production integration/UI
verification remains separate. No installed-host
operation is authorized or certified.

### Production native integration — tested with bounded freshness

The isolated `SUBAGENT_ACTIVITY_PHASE=regression` now runs the real companion
entry, report tool, delegation hooks, Store and authenticated production read API.
It is the default phase, not an exploratory fallback or a skipped acceptance test.
Temporary builds leave checked-in generated outputs unchanged. A supplied
`ACTIVATION_COMPANION_ENTRY` is copied and hashed unchanged with sibling guidance;
final generated-byte verification remains a separate gate.

On OpenCode 2.1.4, both built-in-only and explicitly activated slim 2.2.25 V2
profiles demonstrate a declared, unambiguous delegation producing exactly one
persisted assignment with `items.data[].assignmentBinding`. Built-in same-ID
continuation adds a declared task without replacing that child's explicit task;
slim fresh-child delegation retains the existing other-child assignment.
Statuses, task reporters, totals and report time stay unchanged. Restricted
children have no report tool; a scripted report attempt does not mutate progress.
Discovery alone adds no plan membership. Real authenticated health/list/detail/
history reads pass, and a request without the ephemeral bearer returns 401.

Competing native calls, an unknown-agent error, wrong caller, cancellation before
the result/fence, and a labeled synthetic wrong-result identity fault remain
unbound. The fault fixture executes the native tool but substitutes an unrelated
native root in its structured return; it is not evidence of the unmodified tool
returning a wrong ID. Binding trusts installed tools to identify the child they
delegated to; correlation and lineage gates cannot independently prove that act.
Built-in resume preserves native identity and links. Slim immediate pre-ack resume
is refused without assignment; post-ack resume remains untested.

The real production rail, Work Status and page bundles were also mounted in the
disposable OpenChamber 2.5.1 Wayland host. Current native screenshots show a fresh
bound child, an unassigned restricted child and API-created nested N1. A→B→draft
retires the rail census; returning to A restores it. N1 is still an official
native API fixture, not successful nested tool dispatch.

The incorrect use of SDK integration-link state as native transport liveness has
been corrected and verified in the disposable native host. Fresh bound and
unassigned rows are current on all three surfaces, with ready coverage and no
disconnected copy. Fresh screenshots demonstrate this correction.

The same native session subscription emits loading/ready about every 45 seconds,
even without changed child activity/outcome. Per-session receipts now survive
these reloads and error phases for the subscription lifetime; unchanged cached
records do not renew them. During incomplete coverage, retained rows are not
current. A genuinely new subscription or changed activity/outcome establishes a
new receipt; none of these observations establishes task progress or acceptance.

The combined production native regression now passes in both profiles. A silent
bound child expires to unknown at its original 60-second deadline despite the
native reload, with ready/complete coverage restored. A subsequent genuine native
turn renews that child to Running while a silent sibling remains unknown. Fresh
rail/status/page, actual stale/unknown and renewed-child screenshots are captured;
the earlier defective unknown image remains historical only. Parent acceptance
and final generated-byte checks remain separate. Linux native proof is not
Windows, installation, package or release certification.

## Historical Big Pickle attempt — capacity path abandoned

The initial attempt used the already-present **free Big Pickle only**, with no
sign-in, credential copy, new account or paid fallback. Later bounded tests used
an existing z.ai key with tiny billed usage; there was no free-model retry or
automatic fallback.
The pending OpenAI OAuth attempt was cancelled through the isolated native UI;
all owned host/CLI/service processes are now stopped.

Actual2.1.4 catalog confirms `opencode/big-pickle` enabled/active, tools=true, all
input/output/cache prices0. Exactly one short synthetic root request selected that
model explicitly, with temporary `max_tokens:900` model-body override and bounded
wait. It returned **HTTP429 provider.free-limit** before tokens or tools; session
usage and cost are0. No retry or other model was used. Catalog/free pricing proof
does not establish usable allowance. See `backend-model-catalog.json`,
`backend-model-root.json`, `backend-model-capacity.json` and `probe.md` under
`evidence/compatibility/`.

```sh
node scripts/model-probe.ts catalog
# Historical one-root-attempt command; do not repeat to evade the free limit:
# node scripts/model-probe.ts root
./node_modules/.bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck scripts/model-probe.ts
```

The TypeScript helper restores only its temporary config and stops its independent
CLI. No root manifest/shared/service/UI changes or new dependency were needed.
The free attempt alone proved no executor identity. Later accepted z.ai evidence
proves actual caller attribution, native-child reporting, move attribution and
compaction/resume, with guarded output caps. Inline skill invocation, slim access,
model-exercised parent relay and exact billed-token measurement remain unproved.
Probe receipts alone do not prove production membership/assignment enforcement.

## Historical credential-only transfer and bounded live evidence

The reviewed runner copied one active
existing `zai-coding-plan` key in memory into each fresh isolated destination.
Real `glm-5.3-flash` calls proved root attribution, native reporting, root move
attribution and manual compaction/resume. Root used3 admissions/3 dispatches;
native-move5/5; compaction6/6, including one compaction-kind dispatch. All responses
were200, with no retries; hooks enforced the900-token output cap and per-run6/12
bounds. Known destination credential removed, empty store checked before stop,
fresh roots disposed, zero owned processes/roots verified. Source auth unchanged.

Final claim/gate record: `evidence/compatibility/probe.md`. Sanitized results:
`backend-auth-live.json`, `backend-auth-subtests-summary.json` and per-scenario
JSON under `evidence/compatibility/`. `backend-auth-live-review.md` and
`backend-auth-safety.md` record source/protocol provenance, historical refusals,
reviewed fixes, hashes and cleanup. Strict typechecks,25 auth tests and a
scenario-specific synthetic runtime probe passed before each subtest run.

Limits: slim blocked/uninstalled/no safe binding recipe; model-exercised parent
relay unexercised (fixture-only); title/generate not dispatched; wire fallback
unproved; web/relay extension runtimes unexercised. New locations/reload/restart
remain prohibited while a copied credential exists. Legacy OpenAI capped-route
incompatibility was not bypassed; z.ai was selected explicitly, not as an automatic
fallback. These are historical test limitations, not restrictions on the shipped
production artifacts.

## Sub-agent runs revision-1 read seam

The additive run extension preserves schema/protocol 2. A missing extension or
older service is unavailable, not a certified empty archive. A read-only open
and authenticated GET never install the extension. Activation validates the
whole extension and refuses partial/future schemas without destructive repair.
Run storage format 2 is upgraded only by matching companion activation. Exact
epoch-bearing format 1 is read-only-compatible with the new service beforehand,
without notice metadata; new run mutations refuse until activation. Epochless
version 1 still needs activation for run reads (`503 schema`); it is admitted for
setup and progress, with health200/ready=true but no run-read capability. Its
exact migration shape is accepted by install/update without migrating it there.
Both upgrades preserve all evidence and leave
old loss unknown-date, non-attention. Failed migration rolls back atomically.

During admission and reads, the current build meeting a newer run storage format
or base schema keeps the
service host-ready with health200/ready=false and `schema` diagnostics, retains
setup status, and refuses store-backed routes with `503 schema` without changing
store bytes. Guests show “Progress data needs an update”, not a startup delay.
This does not change the released 1.0.0 rollback behaviour described below.
Service-controlled install/update also checks existing run storage before any
installation change and refuses unsupported formats with `503 schema`. This is
only a preflight: a concurrent upgrade during the action can leave store or
installation changes before admission refuses the unsupported store, with no
automatic rollback. The fallback's compatibility check and capture disabling
share one immediate transaction and never disable an unsupported store.

Mixed versions have distinct limits:

- New service/guest with format 2 support dated, store-wide dismissed attention.
- Old guests ignore additive notice metadata and retain their original permanent
  loss presentation; they cannot dismiss or claim complete coverage.
- New guests with an old service retain muted unknown-date loss without dismissal
  or a short recent-loss line. This does not prove the loss predates an update.
- Pre-run base schema-2 writers can still perform independent progress operations;
  preserved triggers fence capture toggles and remove deleted plan associations.
- Older **run-aware** services/companions reject the exact new schema. The older
  service's health path can return `503 schema`, making guests unavailable, not
  merely hiding the notice. Reload already-running companions explicitly; do not
  silently restart them or weaken schema checks.

An already-running older companion that has not been reloaded can still advance
the observation epoch allocator and run revision when it reconnects or disposes.
This retires held read cursors, but does not grant continuity evidence across a
gap or invalidate another active observer's token. It cannot record, clear or
dismiss recording-gap state, change the format, or perform its other guarded run
writes. Existing loss, detection sequence and dismissal checkpoint remain intact;
incomplete coverage cannot become complete from that bookkeeping. Reloading the
companion with the matching version ends this old-observer behaviour.

Before activation, code rollback needs no store change. After activation, keep
the upgraded store intact and recover forward with format-2-capable binaries.
No automatic down-migration, metadata/loss/fence deletion or restoration of a stale
backup is supported. Choosing an older backup could discard subsequent progress
and requires separate owner authorization. Service and guest outputs ship together
after the muted-disclosure prerequisite, with no intervening release.

Portable read-seam tests now exercise an unmodified base schema-2 writer in a
separate Node process, a read-only reopen, DDL/write rollback, real SQLite/HTTP
reads and the actual companion registration with controlled native get/list
metadata. They preserve existing progress snapshots and verify persistent
capture-generation fencing. Additional isolated tests exercise the unmodified
released 1.0.0 runtime's v1 reads, migration rollback recovery, upgraded-store
health/capture refusal and subsequent recovery with the new code. A separate
process uses that release's source and actual companion capture registration to
create and populate format-1 stores, with and without recorded loss; current
activation preserves their run evidence and counts and migrates old loss as
undated, non-attention evidence. The frozen format-1 fixture is checked against
the release-created schema. These history-based tests require the `v1.0.0` tag
and fail with fetch instructions if it is missing. These portable checks use controlled
host seams, not a real host or the release's built service/companion entries. Controlled
backend time, two connections and authenticated HTTP cover attention and fenced
dismissal; no live profile or model is used. This is not a new native-host or Windows claim;
the native observations and screenshot limits above remain historical.

### Isolated built-release upgrade rehearsal

On 2026-11-10, `tests/backend/subagent-upgrade-runtime.test.ts` rehearsed the
released **1.0.0 built companion** from `v1.0.0` on an independent Linux
**OpenCode 2.2.6** runtime. Both the released and current tracked companion entries
were installed verbatim through the lifecycle installer; neither was wrapped or
patched. The real plugin loader created format 1, then migrated to format 2 only
after lifecycle update and an explicit `POST /api/location/reload`. This also
exercises a same-package-version update with different payload fingerprints.
Before reload, setup returned `activation: "reload-required"`; health, setup and
run GETs through the current **built service** left the format-1 store unchanged.

Two fresh isolated stores cover no loss and recorded loss. Host sessions and
parent/child lineage are real. Recording inputs are **synthetic**: a separate
diagnostic plugin delivers before/after and execution-event inputs to the
release's source capture implementation using real host identity lookups. It
does not prompt or execute a native subagent/model loop. The loss variant calls
that release capture's unavailable path. Migration itself is performed by the
unchanged current built companion inside the real loader, not by the diagnostic
plugin or a test call to the migration method. Run rows/counts survive, revisions
advance, and old loss remains undated with `attention: false`. Authenticated run
GETs exercise the current packaged service entry, not just a Store seam.

After putting the released companion back and reloading, plugin inventory reports
`status: "failed"`, with error first line `Error: schema`; its status RPC returns
`RPC is unavailable: agent-progress-status`. Setup still reports `installed: true`, `captureEnabled: true`,
`activation: "reload-required"` and `diagnostics: ["rollback-payloads-retained"]`:
installed/enabled is not proof of active capture. The **current** built service
continues to return HTTP 200 and format 2 for run reads. Schema, run evidence,
loss metadata and other durable facts remain intact; disposing the outgoing
matching observer can advance the epoch allocator and revision. Live companions
also renew recovery leases and maintain job/traversal bookkeeping, so preservation
of these facts is not whole-store byte equality. Restoring the
current companion and reloading restores active capture registration and
`activation: "control-applies-to-loaded-instances"`, without a down-migration or
backup restoration.

The repeatable test uses a fresh HOME/XDG/cache/state/runtime/temp tree, rejects
ancestor/system configuration, uses OS-assigned loopback ports and synthetic local
passwords, checks empty credentials, rejects/counts model/transport attempts, and
stops its owned runtime/service processes and removes its fixture. It needs the
independent runtime and release tag and is excluded from portable CI. This is not
a real OpenChamber desktop host, extension update-UI, native model-driven dispatch,
Windows or macOS certification, nor a rerun of all native regression families on
2.2.6.

Recorded native execution events distinguish succeeded/failed/interrupted from
SDK idle/completed. Historical native `outcome` with `time.idle` is labelled a
session observation, without invented dispatch/start/duration. Updated time is
not end time. Neither elapsed age nor transport uncertainty terminates a retained
Running fact or makes cached SDK activity proof of success. A native outcome is
not proof that requested work was correct and never advances plan-task progress.
No-plan UI hiding is independent of passive plan-free capture. Current-bundle UI,
implementation review and owner acceptance remain separate gates.

### Run producer boundary

The current native 2.2.2 execution events omit optional `location`, despite
carrying event ID, creation time, aggregate and sequence. Capture retains such
events as metadata candidates; native same-source/project/location child lineage
must still be proven before attachment. A present wrong location is refused.
Parent interruption/failure may omit an after-hook: that retires the unconfirmed
dispatch reservation, not the child's outcome, and cannot poison later calls.
Foreground tool errors without structured child identity remain unconfirmed;
they must not be relabelled failed child runs. Background post-return native
failure/interruption is separately observable once identity is proven.

The isolated production fixture has an explicitly labelled backend-only mode
for source/built run and reporting assertions without launching a browser or
certifying the three guests. It exercises registered child handoff, native
foreground/background completion, controlled native provider failure, native
interruption, metadata reconciliation and a real isolated producer restart with
durable next-dispatch intent. Slim pre-acknowledgement resume refusal remains a
reported unsupported result, not a text-parsed child or successful execution.
Controlled faults and actual native events are distinguished in evidence. The
default combined fixture still includes its independently owned UI checks.

## Assigned-child reporting and session entry compatibility

The current report tool accepts an optional explicit `handoff.taskUpdate` and
returns `taskReceipt` alongside the authored claim. Older companions reject the
unknown field without changing tasks; never strip it and claim atomic success.
After checking current state and capability, deliberate separate `change` and
bare `handoff` operations remain possible, but are not atomic. Ordinary task
contributions and bare claims remain readable with schema/protocol 2 and run
format 2. Legacy or pruned claim evidence cannot prove a combined task commit.
Rollback must retain reports/receipts/claims and revert matching source, manifest
and generated entries together, without down-migration or deleting child reports.

Assigned-task guidance is after-binding only. A single-turn child may finish
without direct progress, and scripted-provider acceptance is not proof of model
compliance or guaranteed first-execution participation. Restricted tools and
unverified ancestry/source still refuse authority.

The session action uses the existing open-mode panel item contract on OpenChamber
>=2.7.1 / SDK 2.7.0, without a new capability or background entry. It pins the
clicked session after source/location verification; ordinary opening restores
current-session scope when the host actually supplies no item. The isolated
2.7.1 host retained its previous item on ordinary toolbar reopening, so that
restoration journey is not accepted on this host; see the UI guide's reopening
limitation. Optional host agent/resource titles are informational,
not task authority. Workflows navigation is omitted because this SDK exposes no
supported destination/availability contract. Linux web evidence does not certify
desktop, relay, macOS or Windows; see the isolated test records for actual coverage.
