# Compatibility commands and evidence

## Current use and development

Agent Progress is an installable early-access extension with Linux and native
Windows capture. OpenCode 2.1.4 is the tested capture version; broader
compatibility is not established. Use the [setup guide](setup.md) for installation,
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
Node24.19.0 runs backend tests and standalone HTTP smoke. Independent downloaded
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

Run the production activation and native tests with Node24.19.0 and existing Bun;
the native probe requires the independent 2.1.4 binary plus working rootless
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
and Store lookup on pinned OpenCode **2.2.2** at the actual outgoing scripted-provider
boundary. It uses direct synthetic Store construction and local plugin loading,
not installation. The observer records metadata and the synthetic recovery section
from actual outgoing system parts; it never manufactures recovery in regression
mode or retains conversation/summary text. No real model or provider credentials
are used. The test requires Node24.19.0, existing Bun/dependencies, working rootless
`unshare -Urn`/`ip`, and the already-present independent binary below. A missing or
wrong-version binary fails closed; do not substitute the managed PATH launcher,
download a runtime, or select the older installer-based native case for this check.

The host pin is distinct from unchanged `@opencode/plugin`/client **2.1.4** and
`@openchamber/sdk` **2.5.1**. Verified independent2.2.2 archive SHA-256:
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

### Current native proof pin — 2.2.2

Verified on 2026-10-30: the official URL above now supplies an archive whose SHA-256 is
`3a38b8c284450a5ca81a2c1ebbf29ebe05e618518f095da0066652167eb0eb33`.
The extracted independent executable reports `opencode v2.2.2`; its SHA-256 is
`4452778e23fbda075eb2f83c2574b1d7452af8e347c52b8d9e016838b9c530d9`.
The archive remains `cli.tar.gz` and the executable remains `opencode` in the
disposable `/tmp/opencode/agent-progress-probe-cli` fixture directory. Native runtime
tests now require 2.2.2; installed plugin/client SDK packages remain pinned to
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
