# Design

## Context and evidence

The current companion reads an explicit binding override or a sibling descriptor; the service defaults to a separate state-root selector and can auto-adopt a package-local descriptor. `readBinding`, `verifyStore` and platform validation already protect descriptor privacy, canonical source roots and durable store/source identity. `setup/lifecycle.ts` owns full legacy package validation and the disable-first `remove-capture` operation. `Store.observeLoaded` records optional latest-load metadata without changing protocol/schema 2.

A disposable Linux OpenChamber web 2.7.1 / OpenCode 2.2.7 experiment loaded the existing companion folder, tool, inline skill and guidance through the manifest contribution. Watched-config install, disable, re-enable and removal worked without restarting OpenCode. Removal retained history. The extension service and managed OpenCode shared `XDG_DATA_HOME`, but only the latter received `XDG_STATE_HOME` and an explicit binding override. The global legacy plugin won duplicate-ID resolution and continued reporting after extension disable. A report suspended at document permission failed without a committed report after disable, but session completion did not settle without interruption. These are bounded observations, not certification of all hosts, platforms or disable interleavings.

Public references: [SDK 2.7.0 manifest types](https://unpkg.com/@openchamber/sdk@2.7.0/dist/manifest.d.ts) already declare `opencodePlugin` as a package directory and its approval capability. [Host managed-config documentation](https://github.com/openchamber/openchamber/blob/main/packages/web/server/lib/opencode/DOCUMENTATION.md) explains watched-file delivery versus caller-owned `OPENCODE_CONFIG` environment fallback. Current upstream documentation is supplementary; published 2.7.1 runtime/source evidence bounds compatibility claims. Service `provides:["opencode"]` reads sessions/messages/projects/events, not plugin/tool inventory or plugin RPC; it cannot prove activation.

## Decisions

### 1. Host delivers code; the product still authorizes its data binding

Use `build/companion` with its existing package entry, plugin ID, tool, inline skill and native guidance hooks. Do not add `contributes.skills`, `contributes.instructions`, an inventory provider, a second plugin ID or a global-config entry. Approval must include the host's **Add a plugin to OpenCode** disclosure: plugin code executes inside OpenCode with the account's full access, like the service. Denied approval or host policy is not circumvented.

Keep the manifest floor `>=2.7.1`, build SDK 2.7.0 and plugin SDK 2.1.4. Existing parser support does not certify a host below the declared floor. Preserve the existing background actions and mentions. Normal Git installation consumes committed runtime bytes without compilation or dependency download.

### 2. One discovery location, with read and creation separated

Use a shared resolver in the existing binding/platform layer. Resolve the canonical OpenCode data root from absolute, lexically canonical `XDG_DATA_HOME` plus `opencode`, or the supported HOME/homedir fallback plus `.local/share/opencode` only when XDG data is absent. An explicitly invalid XDG value is an error, never permission to try HOME. Use the same platform identity rules in both processes.

The selected product subfolder is `agent-progress-managed` under that root; its sole binding is `progress-binding.json`, with a fixed product/format `.ownership.json` marker. It is distinct from both the OpenCode data root itself and the existing suggested progress-store child `openchamber-progress`. The descriptor names a dedicated private store directory, not OpenCode's own database. Code and mutable state never share the extension folder.

Preserve private 0700 directories and 0600 state files, current-account ownership, non-symlink/canonical paths, marker validation, `readBinding`, `verifyStore`, and the equivalent existing Windows ACL/object/ancestor checks. Reject foreign, modified, unsafe, partial or future state without repair, chmod, takeover or deletion. A missing owned descriptor is unconfigured; a present invalid descriptor is a distinct fail-closed error. Opening the service, status, inspect, or dormant companion creates no binding directory, marker, store or descriptor.

Remove automatic package-local/old-state adoption from the managed production path. Do not use `AGENT_PROGRESS_BINDING`, `XDG_STATE_HOME`, sibling descriptors, project paths, recursive searches or alternate roots as production managed discovery fallbacks. Explicit test construction may inject a verified fixture dependency; production environment overrides must not silently select another managed store. Retained legacy loaders/removal utilities retain their original behavior for compatibility, not as a managed fallback. No upstream environment-forwarding fix is required.

Fresh configuration reviews the resolved managed source and private store, privileges and lifecycle, then requires explicit confirmation. The normal view no longer asks users to install a global plugin or identify three arbitrary global roots. Canonical config/data roots still undergo validation; a custom store remains an explicit choice. Unsupported effective scopes, including `OPENCODE_DB` or `OPENCODE_CONFIG_DIR`, must not be guessed into verification. Service-side path observations are not proof of the active runtime scope; the companion independently verifies its actual resolved roots. Preserve explicit unverified/unknown states and current navigation/source association gates.

For retained history with no canonical legacy install, support deliberate configuration of an explicitly supplied private store through the same review/validation path, never automatic discovery. Reuse an unambiguous matching existing source namespace; refuse conflicting selection rather than overwriting it. Unrelated sources remain readable but never become reporting authority.

### 3. Handle approval-before-configuration without an installation race

The host can load the plugin before the service has a binding, and changing a descriptor outside the package does not itself reload the plugin. Do not make fresh setup depend on service startup order, a failed initial plugin import, a new model call, or editing the host's managed config.

Keep a dormant, disposable companion registration while unconfigured. At a supported native session/context or report boundary, one coalesced initialization attempt reads the single descriptor, validates identity and opens the existing Store. Until this succeeds, no reporting, document capture, delegation observation or verified guidance is authorized. A request without a usable binding returns an existing fixed failure code. Following explicit configuration, the next eligible context/tool boundary can activate capture without a global install or automatic host restart. Reuse the existing activation/delegation owners; if a hook is factored for deferred initialization, retain its effective-tool checks and one-owned-guidance-section rule. Do not introduce a timer, directory watcher, fallback root, background probe or second reporting executor.

Pin the verified binding for an active runtime generation. Changed identity is a refusal/retirement, not an implicit switch to another store. Registration failure cleans up partial hooks and Store handles. Disposal retires the generation synchronously before awaited teardown, prevents deferred initialization from publishing after disposal, and checks held report work after awaits before existing mutation calls. The existing fixed `storage` failure is acceptable; no new report-tool result contract is required. A committed report before retirement remains committed; work held across retirement cannot append a late report or capture. Existing teardown bookkeeping is not a new progress report.

### 4. One explicitly confirmed legacy migration, not takeover

Inspect only the known canonical legacy package location under the validated config root. A directory name or file's existence is not an owned install: reuse the full `owned()` validation behind `lifecycle('inspect', ...)`, including root/release contents, descriptor, source/store match and removable selector rules. A foreign or modified package produces a conflict, not a migration button authorizing deletion. Validate the actual bound Store as well as the package.

When valid legacy data exists and the new binding is absent, it is a proposed migration target, not selected authority. If a new binding already exists, require the same canonical store, store ID, source ID and config/data scope. A different store/source refuses migration without disabling either store or selecting a new one. A canonical descriptor that is already invalid also blocks migration; do not fall back to the legacy descriptor.

Offer **Switch to extension-managed capture** in the panel and shared Setup view. Its single confirmation explains removal of global discovery, the narrower managed-runtime reach, retained history and any pending reload. Immediately before side effects, revalidate the reviewed identity and full ownership. Use the existing `remove-capture` path, not recursive deletion or a weaker replacement. Preserve history, receipts, captures, cleanup fences, run records, installation history and retained legacy payloads.

Order the operation so capture is disabled before publishing an activation-ready managed binding, and re-enable only after verified legacy removal and durable binding/expected-fingerprint persistence succeed. Reuse atomic private state publication and a narrowly scoped migration-pending record where needed for interruption recovery. No active descriptor may authorize a half-finished migration. The one user confirmation authorizes this bounded sequence; it is not permission to touch another install. Duplicate submissions must either observe the completed same-target result or refuse safely, not remove twice or create a second source. A failed/uncertain response is inspected before retry, never assumed undone.

A failure after disable/removal may leave capture off, retained files or a pending private selection. Show the actual partial state and a safe explicit retry of the same validated target. Do not silently restore a global loader, enable capture, erase staging or claim an atomic cross-filesystem/SQLite transaction. Persist enough validated same-target information to resume after removal without scanning old roots. Full validation is repeated on retry, with the already-removed same-target case distinguished from an unknown disappearance.

The host may need to reload the affected location to retire a cached legacy winner. A matching managed observation, not successful filesystem removal, supplies activation evidence. Do not automatically restart any runtime or use unsupported host inventory APIs. Already-running independent legacy OpenCode processes can retain old code; migration cannot promise to revoke them. Warn that these processes must be explicitly stopped/reloaded before resuming capture if the user needs global legacy execution ended. Keep migration and legacy removal/recovery support for at least one release. Do not offer fresh global installation in the normal UI/service path or advertise the standalone archive as a new global-install journey.

### 5. Warn-only fingerprint observations, not executable attestation

The service derives the expected managed package version and activation fingerprint from its own shipped companion entry/guidance and the verified binding identity. Record that expectation in an owned 0600 metadata sidecar inside the verified private progress-store directory, not a new SQLite table or schema change. Validate its store/source/install identity and private ownership before reuse/replacement. Establish it during confirmed configuration/migration and once for a newly admitted service package generation; setup GETs compare observations but do not continually overwrite the baseline. A restart/update may establish a new baseline from the then-installed package; this is not a trusted publisher signature.

Use the existing activation fingerprint/`loaded_activation` owner for the companion's successful registration observation. Managed version comes from the running companion release, not the legacy descriptor's frozen `version`. Include that runtime version and binding in the comparison; equal version labels with different bytes remain different. Do not change the report protocol or database layout. No legacy ownership-manifest selection is required for managed execution.

Expose **unknown/not observed**, **matching observation**, and **loaded bytes differ** separately. A mismatch warns but does not stop startup, reporting or guidance when binding/control/host permissions are otherwise valid. Missing or unreadable expected metadata is unknown, not matching; it does not authorize recreating a missing store. Binding, ownership, schema and control failures still fail closed. Keep fingerprints, paths and IDs out of the support summary; include only bounded fixed classifications and numeric version metadata.

This measures bytes read around activation, not a cryptographic proof of exactly what a cached importer executed. It cannot distinguish stale loaded code from all forms of tampering or detect a coordinated same-account rewrite. If both service and companion read altered bytes, they may agree. The executable folder is host-controlled: folder installs reference the source; ZIP copy permissions follow host/umask behavior; a permissive umask and shared writable group can permit cross-user alteration. Same-account execution was already trusted. The product does not chmod host-installed code or claim its old private payload permissions still apply.

Explicitly retire normal-path claims about hash-attested immutable payloads, `.ownership.json` selecting runnable releases, gap-free/atomic code replacement, independent companion versions and per-companion-update confirmation. Host extension updates now select the companion bytes and follow host approval/update behavior. Inspected Git updates use two renames; ZIP replacement also has an absent-path interval. Preserve old payload/ownership descriptions only as clearly labelled legacy/recovery history. Leave the separate official-version metadata checker and its notice unchanged.

### 6. Observation and lifecycle presentation

Extend the existing setup DTO and its UI adapter together with a discriminated managed-delivery revision. Do not silently reinterpret an old `installed` boolean or the literal `separateLifecycle:true` as managed proof. Freeze the narrow fields/actions in `docs/contracts.md` before sequential consumers switch. New UI encountering an old service keeps an explicit legacy/unsupported state and does not dispatch managed actions; unknown future delivery metadata makes no success claim. Service and guest outputs ship together.

Use existing authenticated setup/control owners. Provide bounded fixed actions for managed inspect/configure/migrate, with confirmation and expected reviewed identity on mutations. No request may supply executable bytes, a descriptor filename, URL, command or SQL. Capture enable requires a valid managed binding instead of legacy executable ownership; capture disable keeps its existing verified-store safety fallback. Setup changes cannot mutate report/task facts. Ordinary health and store-read errors remain distinct from missing configuration and use fixed codes.

Reporting health keeps installation/delivery, matching loaded-companion observation, capture control, selected recorded revision and viewer freshness separate. Local package presence is not host grant or effective tool inventory. A stored enabled flag is not proof the extension is on, a matching observation is not a heartbeat, and an old revision is not a recent report or completion. Keep the bounded explicit setup/selected-plan check, source/store association, retirement rules and privacy-safe copy flow. No `provides:["opencode"]` permission, auth discovery, RPC probing or polling loop is added.

Lifecycle guidance must distinguish:

| Delivery | Disable/removal meaning |
| --- | --- |
| OpenChamber-owned watched managed file | Host removes the plugin contribution and disposes it; later reports stop, re-enable can resume using retained binding/history. No restart normally required. This is not an instantaneous UI-click deadline. |
| Caller-owned `OPENCODE_CONFIG` / content fallback | Changes require an explicit OpenCode restart. Do not promise a live stop from the toggle alone. |
| External local/remote server, terminal OpenCode, isolated spaces, VS Code | Not delivered/captured by this extension's managed path; shared directories alone do not change reach. |
| Legacy plugin or explicit host **Add to global config** entry | Independent global entry can outlive the extension. Do not create/recommend it or silently edit user config; explain the exception and deliberate removal. |

Where the service cannot establish the mode, show conditional/unknown mode copy rather than claiming a live-toggle guarantee. Closing a progress view does not disable the extension. Disable/removal retains store, binding, expected metadata and history; reinstall must validate retained state, never reset it. An in-flight permission-waiting report may fail safely while its session still needs interruption; do not promise graceful cancellation or bounded session completion.

All new extension-owned labels, errors, consent and accessible names follow existing English/Russian localization and SDK UI conventions. Keep the language selector, failure-state reading, focus retirement and compact/narrow layouts. Global-install/update/removal controls leave the normal path; the migration action is explicit and legacy-scoped.

## Compatibility, rollout and rollback

The data protocol, schema, run-format and cleanup semantics remain unchanged. This change migrates delivery/selection, not progress data. Existing Store activation behavior for an already-supported older run store remains its existing boundary; no new migration or down-migration is introduced. Preserve durable identifiers and cleanup protections.

Existing legacy installations remain independent until explicitly migrated; an extension update alone never removes them. New setup must not report managed activation while a legacy winner remains. Old guests may not understand the managed setup revision, so ship matching service/guest/generated entries. Old companions never become managed merely because their version matches, and old loaded observations cannot certify a new managed install identity.

Code rollback removes the new contribution/consumers but retains private data and selection. Older services may not discover the new descriptor, and a migrated global loader is not automatically restored. Prefer restoring a compatible managed build; any deliberate legacy recovery uses verified retained targets and a separately authorized procedure. Never reset schema, delete cleanup fences, restore an old snapshot or reinstall global capture automatically to make rollback appear seamless.

## Documentation and validation

- README: host floor, plugin approval, explicit private-store configuration, managed-only reach and conditional lifecycle. Keep the official-version network notice in scope only for wording that must no longer claim a separate companion update.
- `docs/setup.md`: replace the normal global installation/three-root journey, discovery location, consent, migration/retry, delivery matrix, version/update/integrity and rollback contracts; label retained legacy commands/history accurately.
- `docs/contracts.md`: managed setup revision/actions and mixed-consumer handling; replace independent-capture and ownership-gated-enable claims without altering report/cleanup contracts.
- `docs/backend.md`: shared discovery, deferred binding activation/disposal, expected versus observed fingerprints and strict authority boundaries.
- `docs/ui.md`: managed Setup, migration, observation rows, localized warnings and accessible controls.
- `docs/compatibility.md`: measured 2.7.1/2.2.7 proof, fallback/global exceptions and unresolved platform/session-cancellation limits. Preserve historical results as historical, not fresh certification.

Use real disposable-host install/approval/report/disable/re-enable/remove journeys and rendered screenshots for all three views. Test migration with an actual legacy installation, mismatched store/source, modified ownership and interruption. Exercise the pending-permission disable race and no late report, absent/invalid binding, restricted tools and warning-only byte differences. Package checks must load the declared directory from folder/ZIP/Git without a consumer build and reject below-floor hosts. Reuse repository portable/native checks and retain exact generated-entry parity. Independent security review must resolve plugin execution, mutable-folder integrity, binding creation, legacy removal and ambient-authority concerns before delivery. No live profiles, credentials, real-instance restarts or paid model calls are permitted.

## Open Questions

None. The delivery, binding, migration, guidance, warn-only integrity and host/dependency choices are settled. Runtime acceptance and independent review remain execution gates, not evidence already obtained for the implementation.
