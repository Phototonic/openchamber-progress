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

Observed archive SHA256:
`2edaf8cf96e81dec5ee996a3196b03345cf59e5a1673d83a4599bb4afc5c5f6d`.
`latest` is mutable: verify downloaded version again, do not assume future bytes.

Recovery on2026-10-24 re-downloaded the official archive: actual version2.1.4,
same SHA256 shown above. The host restart cleared retained temporary CLI/desktop
fixtures and the extracted AppImage; repository evidence remains available.
Future desktop/UI reruns require fixture regeneration; none was performed for this
recovery. Early live refusals and later accepted z.ai root/native/move/compaction
successes are distinguished in the dated auth safety/review evidence; final
credential cleanup and zero owned processes/roots were verified.

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
