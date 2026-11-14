# Extension-managed capture setup

## Install, review, confirm

Use **OpenChamber 2.7.1 or later**. Install Agent Progress through **Settings →
Extensions**, using the repository Git URL or a release ZIP. No consumer build,
dependency installation or permanent global plugin is needed. Git installs execute
the committed JavaScript. The extension contributes `build/companion`, including
the existing report tool, inline skill and native guidance.

Approval includes **Add a plugin to OpenCode** and **Allow and enable**. Plugin
code runs inside OpenCode with the account's full access, like the extension's
service. Declining approval or a host policy refusal is not bypassed. Installation
approval alone does not authorize selecting existing progress data.

Open **Agent progress → Setup**. Optionally choose a dedicated private progress
store, inspect it, and review the resolved config/data scope and exact store.
Explicit acknowledgement and confirmation are required. Config/data roots must
already exist, be canonical, belong to the current account and pass platform
checks. They are not inferred from a project, PID, browser or account label.
Unsupported `OPENCODE_DB` or `OPENCODE_CONFIG_DIR` scope overrides are refused.
The service's scope observation is not proof of the runtime's effective scope;
the companion independently validates it.

The private store is a directory, not a SQLite filename or the OpenCode data
directory itself. A custom store remains an explicit choice; existing unrelated
sources remain readable but do not grant reporting authority. A matching retained
source is reused only when unambiguous. Corrupt, future-schema, foreign or unsafe
state is refused without reset, permission repair, takeover or deletion.

The sole managed descriptor is
`<OpenCode data root>/agent-progress-managed/progress-binding.json`, beside a fixed
product ownership marker. Both processes derive the data root from absolute,
canonical `XDG_DATA_HOME` plus `opencode`, or HOME/homedir plus
`.local/share/opencode` **only when XDG data is absent**. An invalid explicit XDG
value is an error, not permission to fall back. `XDG_STATE_HOME`,
`AGENT_PROGRESS_BINDING`, package siblings and project folders are not production
managed discovery selectors. No root scanning or automatic legacy adoption occurs.

Opening Setup, inspecting status or loading an unconfigured companion creates no
binding directory, marker, descriptor or store. Confirmed configuration creates
private product state (0700 directories and 0600 files on Linux, equivalent ACLs
on supported Windows). Mutable state never lives in the extension code folder.
After configuration, the next eligible native context/report boundary can activate
a previously dormant companion; no global install or automatic restart is needed.

## Reach and disable/removal

| Delivery | Effect and limits |
| --- | --- |
| OpenChamber-owned watched managed config file | After the host removes the contribution and disposes it, later reporting stops. Re-enable can resume using validated retained state; normally no restart is needed. This is not an instantaneous UI-click deadline. |
| Caller-owned `OPENCODE_CONFIG` / content fallback | Changing the extension toggle requires an **explicit OpenCode restart** to change the runtime contribution. The toggle alone is not a live-stop guarantee. |
| External local/remote server, terminal OpenCode, isolated spaces, VS Code | Not delivered or captured by this extension-managed path. Shared directories do not extend its reach. |
| Legacy plugin or explicit host **Add to global config** entry | Independent of the extension and can outlive its disable/removal. Deliberately remove that separate entry; the extension never silently edits user configuration. Do not add one for normal setup. |

The service currently reports delivery mode as unknown, so Setup and reporting
health explain these alternatives rather than claiming to know the live mode.
Closing a progress view does not disable capture. Disable/removal retains the
store, binding, expected metadata and history. Reinstallation validates retained
state; it does not reset it. An in-flight report held at read permission cannot
append a late report/capture after retirement, but its session may still need
explicit interruption. **Graceful session cancellation or bounded session
completion is not guaranteed.** Never automatically restart a real instance.

## Legacy migration and recovery

For at least one release, Setup supports a single confirmed **Switch to
extension-managed capture** for a fully validated canonical legacy installation.
A folder name alone is not ownership. Inspection validates its complete ownership
manifest, releases, descriptor and actual Store/source identity. Modified or
foreign files are a conflict, not permission to delete them. A different selected
store/source refuses before disabling or changing either selection.

Busy, corrupt, unsupported-schema or platform inspection failures instead show
**inspection unavailable**, with the fixed underlying diagnostic. Resolve that
failure and retry inspection; unavailable does not mean ownership conflicts or
authorize manual deletion. During either conflict or unavailability, **Turn off
capture** remains available if the selected managed Store/source verifies. Its
review and explicit confirmation change only that Store's capture flag; no
legacy ownership/removal check is needed, no legacy files change, and an
unselected legacy Store is not controlled. Enable and migration stay fail-closed.

The reviewed confirmation explains the narrower managed reach, retained history,
global discovery removal and possible reload. Immediately before mutation,
ownership and identity are checked again. Migration disables capture, uses the
existing verified `remove-capture` operation, durably writes the same-target
managed selection and expected metadata, then enables only after those steps
succeed. Store/source IDs, reports, receipts, captures, cleanup fences, run
records, installation history and retained legacy payloads survive. Successful
filesystem removal is not proof of managed activation.

An uncertain/failed reply must be inspected before retry. Setup can show a pending,
capture-off state and offer a fresh explicit same-target review/confirmation.
Failures before removal or after recorded complete removal can be recovered by
that bounded retry. **An interruption midway through sequential discovery-file
removal can leave an incomplete package that fails full ownership validation.**
That is a conflict: do not automatically repair/delete remaining files, restore a
global loader or enable capture. Preserve the pending selection and retained
files. Manual cleanup requires a separately authorized review of the retained
ownership/removal receipt and the exact remaining product files; never recursively
delete a config/store directory or remove unrelated files to clear the conflict.

Migration errors retain fixed platform codes such as
`windows-security-unavailable` and `private-permissions`, rather than reducing
them to `storage`. The response and subsequent Setup diagnostics retain one
in-memory `lastAction` stage/code until the next migration attempt or service
restart. Stages are `managed-state-create` (including admission before creation),
`lock` (including locked revalidation/cleanup), `expectation-publication`,
`migration-record` (including capture disable), `legacy-removal`,
`binding-publication` and `capture-enable`. These identify the failed boundary,
not proof of rollback or permission to repair it. Cleanup failure does not replace
an earlier primary failure. No raw exception, path, SID, token, command or database
content is included. A successful inspection does not erase the previous failure;
a successful explicit migration retry clears it.

A crash while holding the private configuration lock leaves **busy** state. There
is no time-based stale-lock takeover or automatic lock deletion. Stop only the
known configuration operation, establish that no owner is active, and arrange
separately authorized manual recovery of the exact lock after verifying the
private selection. Do not treat busy as absent configuration or select a new store.

Already-running legacy processes may retain code after discovery removal. Stop or
reload those processes explicitly if global execution must end before capture
resumes. The host may also need an explicit affected-location reload to retire a
cached legacy duplicate-ID winner. No runtime is restarted automatically.

The standalone companion archive and `build/setup/main.js` are **legacy/recovery
support**, not a new global-install journey. An existing owned install's
`remove.js disable` / `remove.js remove-capture` can disable/remove its verified
discovery files even after extension absence; history and payloads are retained.
These utilities preserve their original ownership checks. They do not remove a
manually added host global-config entry or grant authority over modified files.
Updating a pre-managed default-only loader refuses with
`legacy-update-requires-managed-migration` before selecting or staging a release.
The previous selected release keeps working. Use Setup's **Switch to
extension-managed capture** rather than updating that loader to managed-only code.

## Updates, observations and integrity

Host extension updates now choose companion bytes under the host's approval/update
rules. There is no independently selected normal-path companion version or
per-companion-update confirmation. Use **Settings → Extensions → Check for updates**
(the icon is labelled **Check installed extensions for updates**), then the
extension's **Update** action when **Update available** appears. Checking alone
does not install. On tested web 2.7.1, reopening Settings reuses a cached successful
check; an explicit check fetches again. The one-hour cache boundary was verified
with the host's module-clock input, not an hour-long browser wait.

The ordinary unchanged-permission Git update needed no new approval and retained
grants, scopes, installation storage, device language, private binding and history.
Synthetic host account/settings records and the paused flag were retained too;
this is not real integration/OAuth retention certification. Paused-state retention
was additionally checked through an explicit updater-module call, not a UI offer.
When an update requests an added capability, the host opens its approval dialog.
**Not now does not roll back the package**: in the tested host the new files/version
were already installed, while the new capability remained ungranted and its use
was refused. **Review permissions → Allow and enable** grants it later.

Agent Progress no longer fetches version metadata or displays an official-main
notice. For at least one release, authenticated `GET /v1/extension-update` remains
as a fixed, network-free unknown/unavailable compatibility reply. Its one-hour
backoff is not a promised future check. An old notice cached in an open frame can
remain until a successful compatibility read or a frame remount. Current guests
never call that route; host Git traffic is separate.

Package versions are independent of protocol/schema 2. A development checkout can
share a version label with a release; labels alone do not prove identical bytes.

In the isolated web 2.7.1 Git journey, replacement stopped the old service process;
subsequent access started a new one with retained progress. The continuously open
board got a new package execution context; rail and Work Status were checked on
subsequent access with matching counts. This is not proof that every session or
all three frames reload simultaneously.

Reporting health separates configured delivery, last loaded-companion observation,
capture control, selected recorded revision and viewer freshness. Load is not a
heartbeat, effective tool inventory, a report receipt or completion. Restricted
sessions can lack the report tool despite an earlier matching load. Its bounded
explicit check does not probe conversations, restart OpenCode or call a model.
Previewable support text excludes paths, IDs, fingerprints, timestamps and content.

The service records expected package/version/binding fingerprints in owned private
store metadata; the companion records its successful activation observation.
Unknown/not observed, matching, and differing loaded bytes are distinct. A
same-version difference **warns only** and does not stop otherwise authorized
reporting/guidance. Binding, ownership, schema, control and permissions still fail
closed. An unavailable expected observation is unknown, never matching or authority
to recreate a missing store.

Check Setup/Reporting health after replacement rather than assuming every Git
update needs a restart. In a fresh caller-owned `OPENCODE_CONFIG` test, the service's
loaded-fingerprint observation went matching → different → matching after the next
report turn without a restart. That is not independent proof of which cached
importer executed. The explicit restart caveat for adding/removing/toggling the
contribution in caller-owned configuration remains distinct (see Reach above).
Unknown or differing observations do not establish universal activation; no
automatic restart or graceful session cancellation is promised.

**This is explicitly weaker than the former private hash-attested immutable
payloads.** These observations measure bytes read around activation, not publisher
authenticity or proof of exactly what a cached importer executed. A restart/update
may establish a new baseline. Coordinated same-account changes can agree. Folder
installs reference host-controlled source; ZIP permissions follow the host/umask,
and shared writable groups can permit cross-user modification. The extension does
not chmod host-installed code or promise private payload permissions. Inspected
Git updates use two renames, and ZIP replacement also has an absent-path interval:
neither is a gap-free atomic exchange. Ownership-manifest release selection and
hash-attested payload descriptions apply only to retained legacy installations.

## Data, failure and rollback

Plans and captured documents live in the dedicated private SQLite store and can
contain sensitive text and paths. Treat stores, backups and screenshots as private.
Disable/removal does not purge or securely erase anything. Explicit archive/restore
and confirmed permanent plan deletion are separate progress-view actions; original
plan files remain untouched. First cleanup creates a private recovery snapshot.
Deletion does not erase backups, journals or free pages. Preserve cleanup guards,
tombstones and run records through rollback; never reset schema or automatically
restore a snapshot to undo cleanup.

Unsupported base schema/run storage stays untouched; health/setup remain reachable
with fixed diagnostics. Restore valid ownership/access or use a compatible build;
restarting cannot make a future format compatible. Reads revalidate and can recover
when access is restored, without automatic reset or permission repair.

Authenticated `/health` is a cheap liveness snapshot, not a new storage or legacy
inspection. A newly started managed service reports `starting`, `ready:false` and
`sqlite:false` until a real Setup/data operation validates it. Later snapshots are
`unconfigured`, `ready` or `refused`, reflecting the last admission only. A ready
snapshot never authorizes a data access: each such operation still revalidates.
The views explicitly read Setup then health once on `starting`/`refused`, so a
restored store can recover without a restart. Health alone does not retry checks.
There is no timer, worker or background admission; synchronous Setup/data checks
can still delay other requests while that explicit operation runs.

Code rollback retains private selection/history but older services may not discover
the new descriptor. Migration does not reinstall global capture on rollback.
Prefer forward recovery with a compatible managed build. Deliberate legacy recovery
requires separately authorized verified retained targets, not store downgrade or
automatic global restoration.

## Proactive guidance after loading

Verified binding/source, enabled capture and effective `agent_progress_report`
availability gate recurring native guidance. No named agent, planner, manual skill
load or global prompt edit is required. Reporting remains best-effort model
participation; guidance never infers progress or completion. Structured/non-Markdown
plans require no source file. Conditional plan-file and dispatch/tracker hints read
no document bodies and do not themselves report, capture or grant restricted tools.

## Git distribution validation and main promotion

The Git URL is `https://github.com/Phototonic/openchamber-progress.git`; selected refs
determine committed bytes:

- No fragment follows the remote default branch (`main` for this distribution).
- `https://github.com/Phototonic/openchamber-progress.git#main` selects main explicitly.
- `https://github.com/Phototonic/openchamber-progress.git#dev` follows development builds.
- A published tag, for example `https://github.com/Phototonic/openchamber-progress.git#v1.1.1`,
  stays at that tag; it does not follow later release tags.

Branches are not immutable commit pins. OpenChamber compares the selected ref's
package version, not commit IDs or changed bytes. A new same-version commit does
not produce an Update offer. Folder/ZIP installs have no Git update discovery:
replace them manually with accepted built files (developers rebuild their source
first). Local folder watching is not remote self-updating. Git-equivalent retention
and approval behavior is not certified for manual folder/ZIP replacement.

`private:true` prevents npm publication, not Git access.
Git, folder and ZIP packages carry the declared companion folder plus service,
setup, background and all three guests. No consumer compilation/dependency fetch.
Standalone release assets remain compatible legacy/recovery transports.

Develop on `dev`, target `dev`, and promote accepted matching built entries only
with maintainer approval. No routine version bump or automatic release is implied.
Follow [CONTRIBUTING](https://github.com/Phototonic/openchamber-progress/blob/main/CONTRIBUTING.md)
for full-history disposable CI, nine-entry parity, SDK validation and release policy.
Never clear existing archives to make CI run. Actual host folder/ZIP/Git and native
runtime gates remain separate from portable checks.

```sh
AGENT_PROGRESS_HOST_MODULE=<isolated-host-install.js> \
  node --experimental-strip-types scripts/verify-git-package.ts <candidate-Git-tree-projection>
```

Use only disposable source projections, unmodified isolated installers and synthetic
profiles. No live profile/auth, real-instance restart or paid model is a test input.

## V1 installable artifacts

Historical V1 standalone/global installation evidence describes its tested bytes,
not managed-delivery certification. Current package versions come from included
`package.json`; published tags/assets are on GitHub Releases. Native platform and
host evidence, including unavailable checks, is recorded in the compatibility
guide. Historical companion-update confirmations are not the managed update path.

## Native Windows

Native filesystem protection uses existing JavaScript and built-in Windows
PowerShell 5.1/.NET, not a new executable/compiler/module. Fixed profile-free,
noninteractive scripts receive UTF-8 JSON through stdin; paths are not executable
command text. Missing/blocked PowerShell is a fixed privacy/setup failure.

The first security query per loaded service/companion has a 30-second attempt and
one identical retry only on timeout (up to 60 seconds configured wait). Later
queries have one 10-second attempt. Termination/OS overhead is additional; these
are not setup-operation deadlines. Non-zero exits, spawn errors and malformed
results are not retried. No path is admitted without parsed security evidence.

Managed service construction and health perform **zero security queries** and no
legacy payload/Store preflight. Read-only validation scopes coalesce their known
paths; security results do not survive the synchronous operation, and mutation
boundaries retain fresh validation. There is no process-lifetime or TTL ACL cache.
The host's liveness deadline is separate from these security-helper budgets.

Use one account and local NTFS storage. Config/data roots require current-account
ownership; dedicated store and managed state require private ACLs permitting only
that account, SYSTEM and Administrators. New roots get ACLs at creation; existing
foreign/permissive roots or replaceable ancestors are refused, not repaired or
taken over. Ancestor ownership must be current user, SYSTEM, Administrators or
TrustedInstaller. Owned hard-linked state files are refused. Journals/side files
remain under the secured store. No elevation is attempted.

Drive-qualified paths support either separator, spaces, Unicode and trailing
directory separators through actual identity checks, not blind lowercasing.
Traversal, junction/reparse escapes, UNC/network roots, device namespaces,
alternate data streams and reserved aliases are refused. Long paths and other
filesystems are not certified; APPDATA is not assumed to be OpenCode config.

Capture checks requested/canonical permissions, opened-file identity and bounded
bytes, then file/ancestor identity and mutation metadata. Source documents do not
need private-store ACLs. Failure retains prior text and valid structured reports.
Trusted same-account processes are assumed; this is not Linux final-opened-path
proof against coordinated hostile filesystem races. Windows flushes writable file
descriptors but lacks POSIX directory fsync/power-loss namespace guarantees.
Historical private payload selection remains legacy-specific, not a claim about
host-managed executable folders. Historical Windows 11 x64/NTFS, OpenCode 2.1.4 /
OpenChamber 2.5.2 evidence does **not** certify Windows managed-host delivery.
