# Design

## 1. Existing owners and reasons for a contract extension

Reuse `managed-inspection`, `managed-step-engine`, `managed-step-effects`, `managed-migration`, `SetupRequestWorker`, `PlatformRequestBudget`, the private-publication helpers and `StepDriver`. No second execution or recovery system is needed.

Format 2 cannot honestly encode fresh setup. Its strict parser requires a distinct `legacyInstallId`, manifest or removal-receipt evidence, a legacy-derived plan grammar and corresponding coarse phases. Its target digest includes those legacy facts. A fresh target has none. Reusing the shorter receipt-recovery plan with a fabricated receipt or legacy ID would grant false authority. Furthermore, `readManagedStepJournal` calls `readBinding`, which requires the store directory to exist; fresh preparation must be observable before that directory exists.

Use **format 3 only for fresh operations**, at the same private `migration.json` location, with an explicit `planKind: fresh`. Preserve format-2 parsing, hashing, publication and execution for legacy operations, including format-1 recovery. Do not convert existing journals merely because the code changed.

The format-3 contract retains the Binding projection with server-proposed identities, operation/sequence, consent, package expectation, frozen plan, intent, last receipt, capture renewals, capture observation and diagnostic. It replaces legacy evidence with bounded **fresh facts**: create/retain store mode, reviewed store-directory/database object or absence claims, create/reuse source mode, and capture policy. Phase is pending or complete, never fictitious removed. Retain durable created-resource identity checkpoints needed after directory/database creation. They are observations, not ACL authority. Changes to them are legal only as completion of the matching creation intent; original consent and target facts stay immutable.

The fresh reader validates private journal/container/roots and the planned missing paths without calling the ordinary selected-binding reader on an absent store directory. Only the fresh creation phases may accept absence. Ordinary `readBinding`, companion admission and `verifyStore` retain their existing requirements. A proposed Binding is not a published selection or authorization to open missing storage.

## 2. Review, consent and retained stores

An explicit fresh inspection uses read-only pages through the existing inspection owner: roots, managed state, canonical legacy absence, store and review. No legacy-release scan is needed. A legacy entry, conflicting selector, unknown journal or ambiguous bootstrap refuses or directs the UI to the existing migration journey; it never silently changes the consent category. Reopening a format-3 operation observes that operation rather than offering another begin.

The review shows canonical config/data/store folders, whether a store/source will be created or reused, package version, the actual ordered steps, capture consequence, privilege and managed-reach disclosures, retained history and pause/recovery limits. For absent storage, store/source identities are **proposed**, not observed. Generate missing IDs once in the private inspection session and freeze them on begin; retain the existing managed install-ID derivation. Reuse unambiguous verified source IDs in retained stores. Never replace or silently verify an unverified/conflicting source.

Bind the review digest to the service nonce, `planKind`, canonical target, create/retain and source modes, proposed/retained IDs, reviewed directory/database/selector/journal/legacy claims, relevant source facts, capture observation, package expectation and ordered plan digest. The format-3 target digest hashes the Binding projection, `planKind`, immutable fresh facts and expectation; the existing canonical JSON owner defines serialization. Missing objects are absence claims, not invented native identities. Fresh validation must compare all relevant facts again under the target and Store fence before begin and every effect. Expected changes caused by this operation are accepted only through its intent/checkpoints, not by ignoring changed objects.

Mutation requests carry no caller paths or replacement IDs. Begin echoes only the negotiated version, operation ID, confirmation and expected digest. Exact lost-begin replay uses the durable receipt, including after service restart; before that receipt exists, reinspection/confirmation can be necessary. Changing store, scope, package, plan, mode or proposed IDs invalidates consent. Capture re-consent reuses the existing single-use renewal protocol, binding the same operation/sequence/intent and freshly observed bit.

**Retained-store reconnection is preserved.** Retain the Store ID, all existing source IDs, reports, receipts, history and capture setting. If the selected source is absent, disclose and freeze a new source ID; publish its expectation before registering it, preserving the existing order that prevents expectation failure from stranding an admitted source. Reconnection never disables or enables the shared store. A later manual capture change is observed, not overwritten. A selected valid same-target binding is already configured, not permission to start a second fresh operation.

## 3. Frozen plans and creation boundaries

| Case | Ordered plan, each batch 0 |
| --- | --- |
| New database, missing store directory | `prepare`, `store-directory`, `create-store`, `expectation`, `register-source`, `publish-binding`, `enable`, `reconcile` |
| New database, reviewed existing private directory | Same, omitting `store-directory` |
| Retained database, new source | `prepare`, `expectation`, `register-source`, `publish-binding`, `reconcile` |
| Retained database, matching verified source | `prepare`, `expectation`, `publish-binding`, `reconcile` |

The parser validates these specific grammars, not arbitrary steps or a general plan registry. `prepare` keeps the existing binding-directory/marker and initial-journal bootstrap and settles sequence 1. It does not create the store. The proposed five-step shortcut is rejected because prepare already consumes the entire six-launch envelope, and it conceals database/source writes.

`store-directory` creates only the missing dedicated private directory through the existing platform owner. Completion records its native identity. Do not add a store claim file or a directory-adoption mechanism. Existing reviewed directories remain subject to fresh ownership, privacy and content checks; a newly discovered directory is not substituted for the reviewed absence.

`create-store` uses a narrow extension of the existing Store creation owner: exclusive absent-file creation, the frozen Store ID and capture **off in the initial schema transaction**. Ordinary Store creation defaults remain unchanged for other callers. Do not create enabled and disable in a later transaction. Preserve base protocol/schema 2 and the existing receipt-index initialization. Source registration stays a separate transaction after expectation publication. Only the exact journaled fresh-creation path may initialize its newly reserved file; normal opens must still refuse empty/partial databases. Check the newly created file and ancestors freshly before schema initialization; do not carry a pre-create security result across that boundary.

`register-source` uses the Store owner and is idempotent only for the same frozen source in the same verified database. Another source for those roots or conflicting ID refuses. Before this step, fresh-only validation may verify the Store ID/schema with the planned source absent; ordinary admission cannot. `publish-binding` follows verified Store/source and expectation publication, using the existing no-clobber owner. New-store capture remains off until the explicit `enable` step. Retained plans contain no capture effect. `reconcile` verifies the selected binding, expectation, Store/source and actual capture and durably completes; it never enables capture or fabricates a loaded-companion observation.

## 4. Launch and time budgets

Counts below are **call-site estimates for the proposed fresh path**, not executed measurements. The existing portable HTTP/prepare fixtures establish 6 for migration prepare, 5 for ordinary effects, 3 for controls, 1 for replay and up to 4 for ordinary active-operation Setup status. The old fresh flow's 3/24 counts do not prove these new estimates.

| Request | Allocation / expected successful launches | Ceiling | At 2.5 seconds per launch |
| --- | --- | --- | --- |
| Each fresh inspection page | 1 known-path batch; allow another for newly discovered retained-store paths | 6 | Normally 2.5–5 s |
| `prepare` | 1 review admission + unchanged directory helper 3 + journal publication validation 1 + readback 1 = **6** | 6 | 15 s |
| `store-directory` | admission 1 + intent 1 + effect preflight 1 + private-directory creation 1 + checkpoint validation 1 + readback 1 = **6** | 6 | 15 s |
| `create-store` | admission 1 + intent 1 + effect preflight 1 + new-file privacy/identity validation 1 + completion validation 1 + readback 1 = **6** | 6 | 15 s |
| `expectation` | admission 1 + intent 1 + effect validation 1 + completion validation 1 + readback 1 = **5** | 6 | 12.5 s |
| `register-source` | same five-boundary envelope; SQLite transaction adds no security process | 6 | 12.5 s |
| `publish-binding` | same five-boundary envelope | 6 | 12.5 s |
| `enable` (new store only) | same five-boundary envelope, including fresh capture observation | 6 | 12.5 s |
| `reconcile` | conservative five-boundary envelope; no capture mutation | 6 | 12.5 s |
| Pause/stop/resume | expected 3; capture review has separately bounded inspection pages | 6 | Normally 7.5 s |
| Exact settled replay / step status | expected 1–2, no effect | 6 | Normally 2.5–5 s |
| Ordinary Setup status | expected at most 4, including partial-bootstrap observation | 6 | Normally at most 10 s |
| Health / old Windows inspect-configure refusal | **0** | 0 | No security wait |

The directory estimate requires combining the helper's existing read-only preflight with full effect/intent admission, then ending that scope **before** its creation query. Calling the unchanged helper after a separate effect batch would cost an extra launch. Extend that existing owner narrowly if needed; do not call its raw security backend as a bypass. The database estimate similarly requires creation-specific phases rather than invoking the current constructor inside an enclosing read scope. It must preserve exclusive creation, fresh post-create privacy and normal schema checks. The portable counter must measure these boundaries before claiming feasibility or advertising support.

All attempts, cold/failing launches, readbacks and cleanup count. Five-launch paths have one spare; six-launch paths have none. Failure settlement may retain running/uncertain intent when no safe settlement budget remains; it must not force two extra journal launches or perform a final synchronous status scan. Reserve the remaining full effect and settlement budget before writing. Keep the 17-second work / 18-second response deadlines, six-launch cap, no cold retry, and fence until actual worker exit. Every native undelayed request must be at most 8 seconds; the deliberately delayed successful journey must stay below 20 seconds. Existing worker startup and transport consume the same deadlines.

At six launches of three seconds, security alone costs 18 seconds. Therefore acceptance is successful completion at **2.5 seconds**, plus timely honest refusal/uncertainty above the budget, not guaranteed completion at the top of the 1–3 second range. Endless refusals at 2.5 seconds fail acceptance. If measured creation cannot meet six without losing checks, stop that implementation unit for technical redesign; increasing budgets or caching authority is not an allowed shortcut.

## 5. Crash and recovery contract

Hold the same target-derived scope/Store slots, nonce and Windows late-child mutex barrier. Route fresh Store locking from the private reviewed candidate before begin, including a missing/custom directory; subsequent operations use the journal. A hint routes a lock only; fresh admission must match the held key. Never hold a lock across user think time or clear a retained configuration lock by age.

| Interrupted boundary | Explicit recovery |
| --- | --- |
| Inspection/review cancelled | No product writes; expired review requires inspection again. |
| Prepare before directory creation | Fresh review or exact eligible request may retry; no store exists. |
| Binding directory created, marker absent/invalid | Refuse and retain. Never adopt an empty unmarked directory. |
| Valid private marked binding directory, no journal | Fresh validation/consent can publish the initial journal only. This is the existing exception, not a claim that every pre-journal crash resumes. |
| Journal/expectation/binding publication leaves stage or two links | Refuse ambiguous state and retain it; no sweeping, overwrite or link adoption. |
| Prepare checkpoint committed, reply lost | Exact begin receipt replays; no directory/store effect repeats. |
| Store-directory intent, directory still absent | Resume/retry revalidates and may perform the intended creation. |
| Store directory exists but its creation completion was not checkpointed | Refuse and retain for separately authorized diagnosis. Privacy/emptiness alone is not same-operation ownership. |
| Store-directory completion committed | Revalidate its recorded identity before database creation; replacement refuses. |
| Create-store intent, database and sidecars still absent | Resume/retry may create only the frozen database after fresh validation. |
| Database reserved/created but schema transaction incomplete, orphan sidecars or identity unprovable | Refuse and retain; do not initialize an existing partial file, delete sidecars or recreate a missing completed store. |
| Database initialization committed but journal completion lost | Reconcile read-only only if the same intent, frozen Store ID, directory identity, private file/object checks, supported schema, initial off bit and expected pre-registration state prove the result. Otherwise refuse. No writable repair open is used as evidence. |
| Expectation or source registration committed before checkpoint | Reconcile the exact expectation or exact source row in the same freshly verified store; no duplicate registration or expectation substitution. |
| Binding committed before checkpoint | Reconcile exact same-target selection; no replacement of foreign/changed bytes. New-store capture remains off. |
| Enable uncertain | Observe actual capture; off/unknown does not authorize blind enable. Reuse single-use reviewed re-consent with the warning that it can override a later manual change. |
| Reconcile checkpoint/reply lost | Validate and settle/replay completion without enabling; later manual disable remains effective. |

Failure after any completed boundary preserves the remaining plan and enables explicit pause/stop/resume. Stopped controls retain unresolved intents. Unknown capture is not off; before a database exists it remains unknown with explanatory fresh-setup copy. Do not present expected absence as corruption in ordinary partial-bootstrap status. A database that disappears after a creation checkpoint is a refusal, not a new-store opportunity. No startup, status, close/reopen or timeout continues effects automatically.

This preserves the trusted-same-account-process assumption and Windows process-recovery, not POSIX directory-fsync/power-loss guarantees. Narrow refused creation windows are documented manual-recovery limits, not normal-path success. No files are deleted and no ACLs changed to make retry pass.

## 6. Negotiation and mixed versions

Advertise `managedFreshSteps: 1` independently in authenticated health (including starting/refused) and managed Setup delivery, only with the complete implementation. Retain `managedMigrationSteps: 1` and delivery revision 1.

Use the existing `/v1/setup/managed-step` route with **wire version 2 for fresh operations**, retaining the action/sequence/receipt conventions. Version 1 remains migration-only, with its existing response shapes and step list unchanged. Version-2 review/progress identify `planKind: fresh` and disclose the frozen plan; the new three creation/registration step names cannot leak into version-1 replies. An action's version must match its journal before any mutation. Keep the same byte/path/claim limits and fixed errors.

Expose fresh journal progress as an optional `delivery.freshProgress`; keep `migrationProgress` exclusively version-1-shaped. Both feed the **same** driver/card through a discriminated shared type, not competing local state or queues. Coarse pending/complete status remains conservative for older clients. A version-1 inspector encountering a fresh journal refuses unsupported rather than translating it into legacy recovery.

| Combination | Behavior |
| --- | --- |
| New UI + new service, any supported OS | Fresh capability selects version-2 fresh inspection/review/steps. Migration continues on version 1. |
| Old UI + new Windows service | Old `managed-inspect` and `managed-configure` return exactly HTTP 409 `{ "error": "managed-action-required" }` with zero security launches, workers or product writes, before expensive admission. No user-agent guessing or partial-success 200. |
| Old UI + new Linux/macOS service | Existing old fresh routes remain only with no legacy discovery or journal, under the existing fence. Presence/conflict refusals remain unchanged. |
| New UI + service without fresh capability | Fresh action shows update-together guidance and sends no fresh mutation or old-route fallback, regardless of browser OS. Supported migration/capture behavior remains available independently. |
| Old/new client addresses wrong journal family | Refuse without writes or sequence changes; no automatic journal conversion. |

The service cannot identify an old UI reliably; platform-wide Windows route refusal is smaller and safer than selective fallback. Offering fresh steps on all platforms avoids browser-OS inference while retaining older non-Windows callers. Ordinary bodyless capture-off remains available for a validated selected store; ordinary enable refuses unfinished fresh work. Neither can substitute for source/binding completion.

## 7. UI, docs and verification

Reuse review acknowledgement, Cancel focus, busy handling, Pause/Stop, Continue/Resume, uncertainty/status-first handling and context retirement. Show the actual frozen fresh plan and omit irrelevant legacy removal stages; do not say stage out of nine or call creation a migration. Say whether capture will be enabled for a new store or preserved for a retained store. New progress, partial-bootstrap warnings, recovery/manual-diagnosis guidance and announcements must exist in EN/RU/zh-CN. Off and unknown remain conspicuous until completion. No percentage, polling, automatic retry or claimed undo is added.

Portable tests use the existing fake OS-spawn boundary with real engine/SQLite/filesystem/HTTP and actual `StepDriver`/parser journeys. Count all per-request launches, including refusal/replay/cleanup; do not equate logical queries with processes. Exercise the crash table and same-target contention, late workers, altered consent, unsupported journals, ACL/object changes, retained off/on stores, matching/new source, and migration regression. Use representative native failure paths in addition to the portable crash matrix.

Extend `tests/backend/windows-service.test.ts` and its existing driver/observer, under the existing non-admin native CI job. Start with config/data roots but no legacy, managed directory, store or journal. Complete default/custom-store journeys undelayed and at 2.5 seconds per helper; independently count actual PowerShell starts. Check concurrent zero-spawn health within the existing 1.25-second bound. Include retained-store reconnection, post-creation restart, dropped reply, pause/resume and deadline/late-worker refusal. Traces contain only stage/code/count/duration/state and boolean effect facts; not paths, IDs, accounts or raw logs.

Extend the existing rendered Chromium QA shell, not another browser harness. Capture fresh review, running creation, paused off/unknown, failure/recovery and completion; verify keyboard/focus, context retirement and all three languages at phone width. Synthetic screenshots prove presentation, not native security or host installation.

Update the six guides named in the proposal, including protocol grammar/digests, bootstrap/manual recovery, capture preservation, capability/version matrix and the obsolete fresh-flow exception. When synchronizing the responsiveness specification, replace its current-purpose exclusion of fresh setup with this supported scope, retaining the 1.4.0 limitation only as history. Extend native CI inclusion/trace retention only where its current explicit lists require it. No release/version work is bundled.

## 8. Delivery, rollback and remaining risks

Freeze the wire/journal/fixture interface first. Then backend and UI can work independently; native evidence and rendered checks join their accepted outputs. Creation-budget feasibility is the first backend acceptance milestone, before broader integration. A resolved independent trust-boundary/error-path review is required before acceptance, because new durable initialization and mixed-version refusal cross several owners.

Rollback uses matched source/generated artifacts. Keep format-3 journals, bindings, stores, expectations and history; never down-convert or restore a global loader. Older setup code refuses format 3, including complete records. A published valid binding/store can remain independently readable by compatible consumers, but rollback does not certify old Setup controls; use a fresh-capable build for recovery. The old non-Windows configure route also refuses any retained journal.

Risks are the unmeasured six-launch creation envelopes, tight native timing at 2.5 seconds, conservative partial-creation refusals, accidental ordinary-binding admission of a proposed target, and old-client misinterpretation of fresh progress. The gates above resolve feasibility and regression risk; they do not claim universal slow-machine or power-loss recovery. Package changes during unfinished work still invalidate original package consent rather than silently substituting bytes.
