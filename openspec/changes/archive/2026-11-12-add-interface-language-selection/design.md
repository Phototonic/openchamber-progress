# Design

## Context

Motivation is in [proposal.md](proposal.md); observable behavior and criteria are in [interface-localization](specs/interface-localization/spec.md). This is a cross-cutting guest UI change, not a backend or progress-protocol change.

### Verified implementation baseline

The verified baseline as of 2026-11-12 is `b0f3805`, package 1.1.1. Localization is already implemented in `294d3e6`, documented in `fb67190` and fixed in `bd55769`/`fa81341`; this updates the design of existing behavior rather than planning its first implementation. The historical pre-apply baseline `c0d9a9ab`/`ad9e4816` no longer describes the runtime. Behavior contracts remain in [docs/ui.md](../../../../docs/ui.md) and [docs/contracts.md](../../../../docs/contracts.md).

According to [CONTRIBUTING.md](../../../../CONTRIBUTING.md#local-development), Node 24.x >= 24.19.0 and Bun 1.3.14 are accepted; 24.19.0 is the verified baseline, and newer 24.x versions are not separately certified. Both tools are confirmed available, but that does not mean runtime tests have passed. Explicit invocation with `mise exec node@24.19.0 bun@1.3.14 -- <command>` remains allowed without changing global settings. The OpenSpec version for artifact validation is checked separately from the runtime toolchain.

Confirmed integration points:

- `package.json` pins `@openchamber/sdk` 2.7.0. Its `API.md`, Extension storage section, defines `undefined` as an absent record, `null` as a stored value, `{scope:'device'}` and the required `features.deviceStorage === true`. Storage without options is server-side and unsuitable for language. SDK components and standard `Intl` are used, without a new translation library.
- `ui/shared/app.ts` creates each frame, passes the already effective language to `Env.locale` and the ticker, updates data through one `RefreshGate` (3 seconds, 8 seconds after an error) and pauses the timer when hidden. `spec.refreshed` is called only after a successful progress read and is unsuitable for language synchronization when the service is unavailable.
- `ui/panel/main.ts` has an early return without `read`; `ui/page/main.ts` already renders the utility area without data. The switch therefore cannot depend on a successful read or a selected plan. Work Status remains without its own switch.
- EN/RU catalogs are distributed across existing text owners: formatters, models, projections, controllers and renderers. Historical digest dependencies on `Refreshing…` and map dependencies on English singular regexes have been removed; state and structured facts are separate from translation.
- `summary.ts` contains pure deterministic Markdown formatters. `app.ts` retains the preview result/historical snapshot and considers language during reuse. Clipboard captures the displayed string and guards feedback with a generation. `tests/browser/preview-summaries.test.ts` fixes the exact English output.
- Restoring disclosures preserves the ready/error state without another document read; repaint is not permission for I/O. `source.ts` already categorizes health as `corrupt/schema/busy/storage` for safe UI labels: this is existing service behavior, not a new localization endpoint.

## Goals / Non-Goals

**Goals:**

- Separate the saved language mode, resolved language and read/write state; make translation a presentation-only operation over existing verified data.
- Use one mechanism for three frames, SDK device storage and existing repaint/focus/scroll/map seams. Preserve external contracts and the exact English summary format.
- Deliver a complete translation of all extension-owned surfaces without an intermediate public mode with a partially Russian interface.

**Non-Goals:**

- Translation of user text, search queries, document contents, CLI/companion, package metadata and host-owned chrome, including host section names and its clipboard/toast buttons.
- A new i18n library, dynamic dictionaries, translation loading, automatic translation, additional languages, a server setting, cross-device sync, CAS, a new endpoint or host subscription.
- Moving other UI preferences to device storage or changing review checkpoints, readiness, task order, export safety or action permissions.

## Decisions

### 1. Two languages and an explicit presentation context without a global mutable translator

`ui/shared/i18n.ts` defines `LanguagePreference = 'auto' | 'en' | 'ru'`, `InterfaceLanguage = 'en' | 'ru'`, pure language resolution and a typed switch catalog. Other local EN/RU catalogs and helpers belong to existing UI modules rather than a single catalog of all text. Compound messages are defined as complete phrases with named parameters/functions rather than concatenating English word order. Completeness is ensured by local types and checks of the corresponding surfaces, not one global schema.

In automatic mode, `Intl.getCanonicalLocales` validates the host tag; `ru` with any valid regional variant resolves to `ru`, and everything else to `en`. Explicit mode does not depend on the host locale. Formatting uses effective `en`/`ru`, not an arbitrary host region; region-specific formatting is out of scope. Auto applies until the first successful read; this value is not written automatically.

The presentation context is passed through the existing `Env`/`ViewContext` and explicitly to pure formatters/text helpers. Existing pure public UI helpers may default to `en` to preserve current callers and exact tests; production calls pass the effective language. Calls to `resolveLanguage('auto', env.locale)` in renderers normalize the already effective `en`/`ru` rather than choosing the host preference again. The catalog has no SDK/DOM imports, and the wire adapter performs no translation. Controllers pass semantic codes and parameters for translation at display time without changing their semantics.

Alternatives: a global mutable singleton hides dependencies and mixes test languages; a full i18n framework adds a dependency for two static catalogs. Neither is needed. DOM post-processing of English strings is also rejected: it misses callbacks, aria and new phrases and risks translating user data.

### 2. One small device preference instead of the review checkpoint scheme

DOM-free `ui/shared/language.ts` owns reading/writing the fixed key `interface-language.v1` with the value `{v: 1, preference: 'auto' | 'en' | 'ru'}`. Only these two fields and values are allowed; `undefined` means absence, while `null`, a different version/type or extra fields mean a corrupt record. It must not be repaired/overwritten automatically. The key contains no account, plan, session, store or source: the host already provides the partition.

The controller retains the last confirmed mode (or absence), separate read and write error states and a pending write. The resolved language is not saved. Error messages are fixed and localized; raw storage errors are not shown. A read failure keeps the last confirmed mode, or auto if none exists; a write failure does not change the mode and allows retry through the switch. A subsequent successful read/write clears the corresponding error. Confirmed external absence returns the mode to auto without a write.

If the feature is absent/disabled, new storage requests are forbidden, the effective mode is auto and manual selection is disabled with an accessible explanation. When support is advertised again, a read is performed rather than restoring an unconfirmed assumption. Do not use instance storage, `localStorage` or a temporary per-frame override. Do not reuse checkpoint-key history, hashes, enumeration or compaction: an ordinary replaceable language setting is not monotonic.

### 3. Reconciliation on the existing cadence, separate from progress success

```text
HostReady(locale, features) --> language controller --> presentation context
                                     ^                       |
existing RefreshGate / focus / visible|                       v
                              device storage          panel / page / status
                                                     + pure summaries
```

`startView` creates the controller after connecting the SDK. The first ready event and locale/feature changes recompute presentation; the setting is read on ready, at the start of each visible pass of the existing refresh before any progress/search `await`, on focus and on visibility. Storage reads are not awaited before progress reads, and their failure does not change service state. Focus alone rereads the setting without initiating a progress retry. Coinciding focus/visible/poll events are coalesced; one read is allowed at a time. There are no new timers or device subscriptions.

A local choice immediately invalidates an earlier in-flight read. One write is allowed at a time: the control is disabled only during the write, and repeated activations do not send new sets. Apply the new mode after a successful `set`, then allow subsequent reads. A late read does not undo the view's own confirmed choice; the next ordinary read brings the frame to the value actually saved. Across frames, the final atomic storage write applies, without a promise of ordering by click time and without client timestamps/revisions.

A hidden frame does not start checks; hiding and disposal make held callbacks stale for the UI, and becoming visible starts a fresh check. An already sent `set` may complete and save only the captured value: it cannot be cancelled by a promise. If a frame returns before a write completes, `finally` clears pending and unlocks the select even when the retired result is not accepted as a confirmed choice; a fresh read follows. The language preference is not reset when account, progress store/source, plan or project changes and is not part of their identity. A new runtime/installation receives its own namespace from the host.

Limitation: the cadence depends on completion of the existing refresh; instant delivery across frames is not promised. Focus/visibility allow checking the language independently of a stalled progress read. This is smaller and safer than a separate poller or unsupported broadcast protocol.

### 4. One SDK switch in the utility area and presentation-only repaint

The shared renderer in the existing `components.ts` uses `mountSelect`, with stable `data-testid="interface-language"`, a localized Language / "Язык" label, option IDs `auto/en/ru`, the names English and "Русский" in their own languages and localized "Язык OpenChamber". An error/unsupported explanation sits nearby, linked through an accessible description; the operation result is announced as an ordinary status without displaying arbitrary errors. There are no flags or new modal.

Panel and page render the control exactly once in the lower utility area regardless of early returns, before/without setup, a plan, a read or health. Existing Setup/Details retain their own rules; do not create new duplicates for language. Work Status only applies the shared presentation context and an error/unsupported explanation where needed, without a select or new header control.

A language update changes only the presentation version, not `initialUi`, reading identity, cache generation or navigation hooks. The plan, tab, filters, entered search, disclosures (including an external update while another frame has focus), selected map task, pan/zoom and focus/scroll are preserved through existing seams. An external update uses background repaint with existing deferral for an independent SDK popup; a local choice keeps focus on the select trigger after closing it. Focus is not stolen from another frame/control. After `applyHostReady`, `document.documentElement.lang` is set to the effective language; the host context is unchanged. The ticker and visible refresh labels use the same language, including unknown time and tooltips.

Restoring a document disclosure must populate its ready/error state without another request; a repeat is allowed through explicit opening/retry or the ordinary data lifecycle, not translation. Similarly, repaint does not start a new digest/search/map/diagnostic visit or write a review checkpoint. Message semantics remain unchanged; announcements are translated without repeating the action.

### 5. Complete string and formatting coverage without translating machine values

Localized text owners and responsibility boundaries:

| Area | Files and responsibility |
| --- | --- |
| Lifecycle and main surfaces | `ui/shared/app.ts`, `ui/{panel,page,status}/main.ts`, `ui/shared/components.ts`, `style.ts`: footer, states, focus notices, picker/tab labels, clipboard feedback and layout |
| Shared text and values | `format.ts`, `model.ts`, `primitives.ts`, `readiness.ts`, `live.ts`, `scope.ts`, `progress-projection.ts`, `ui/status/projection.ts`: status/lifecycle/document/readiness/live labels, accessible names, quantities, durations |
| Additional surfaces | `setup.ts`, `official.ts`, `cleanup.ts`, `cleanup-view.ts`, `search.ts`, `search-view.ts`, `change-digest.ts`, `change-digest-view.ts`, `capture-comparison-view.ts`, `census-view.ts`, `subagents.ts`, `reporting-health.ts`, `reporting-health-view.ts`, `dependency-map-view.ts`, `dependency-map-interaction.ts`: utility phrases and retained messages; change corresponding controllers only where they actually create text |
| Export | `summary.ts`, task Copy details in `components.ts`, summary lifecycle in `app.ts`; `source.ts` preserves machine failure kind/code, while presentation translates their fixed descriptions, not arbitrary error.message |
| Checks and documentation | `tests/browser/*`, `tests/fixtures/preview-summaries.ts`, `docs/ui.md`; `i18n.ts`, `language.ts` and targeted language fixtures/tests/QA |

Existing filters/decisions compare codes, not translated names. The digest state machine and map numeric forms no longer depend on English text; Russian regexes are not needed in place of semantic facts.

`DependencyMapInteraction.select` passes structured announcement facts with the user title and numbers to the renderer, not a finished string for translation. Search retains a literal title only with provenance from the same session ID; when selection changes, it uses the label of `selectedOption` itself, including sessions found only in search results. Generated root-session/main-checkout labels follow the language; recorded names remain literal, including after reload or an option disappears. Existing `ViewSpec.prepareUi/preserveFocus/retire` and in-place `refreshLabels` are used; language does not become a new navigation context.

After the first implementation, the map gained collapsible help, deselection and a wide inspector, an arrow legend and summaries of unfinished prerequisites. Their own text is covered by localization, but geometry, motion gates, selection and service I/O do not change. Arrow semantics remain in [dependency-map-arrow-state](../../../specs/dependency-map-arrow-state/spec.md), without transferring ownership to this change.

Sub-agents localizes Partial, dated loss warnings, statuses and the explicit dismiss button. Server authority and the `runs.ts` action remain in [subagent-loss-notices](../../../specs/subagent-loss-notices/spec.md): age/attention, sequence and dismissal outcome are not derived from language. Translation does not initiate GET/POST, reconcile or dismiss and is not equivalent to explicit warning dismissal.

`Intl.NumberFormat`, `DateTimeFormat`, `RelativeTimeFormat` and `PluralRules` handle formatting without a new dependency; catalogs define one/few/many/other forms. Boundary cases include 0/1/2/5/11/21, short units, unknown, zero and invalid duration. Visible map quantities use `formatCount` for RU (`1000` → `1 000`, U+00A0); EN retains raw decimal. Machine `data-count` and revision IDs are not formatted. Only labels change, not numbers, time thresholds or task calculations. Copied machine IDs, literal paths and codes remain as recorded. The support payload from `supportSummary()` remains byte-for-byte identical for the same facts; its surrounding UI is translated.

### 6. Summary is translated from a retained snapshot, not reread

`formatProgressUpdate`, `formatHandoff`, `formatSummaryOnly` and safe `describeDetailFailure` accept a language defaulting to `en` and remain pure. Section/item order, Markdown escaping, LF, UTC ISO timestamps, disclosure limits, omissions and completeness rules do not change. English golden fixtures are preserved without rewriting expectations for the new implementation. Russian has separate exact fixtures; unknown diagnostics yield only a fixed safe phrase.

The preview stores the language of the generated text alongside the retained `result`/historical snapshot. On an effective-language change, regenerate from the same data, including selected summary-only; the reuse condition considers language, not just object identity. Do not create `freshPreview`/`loadDetails` solely for translation. Loading/error messages are also translated. When the displayed string changes, increment the preview generation and clear selection/copy status; an earlier clipboard write completes only its captured text and does not confirm the new preview. An auto → explicit change with the same effective language and unchanged string does not change the text generation.

Task Copy details also translates its own labels while preserving the same set of displayed facts; use the existing text/generation guard in `components.ts`. No automatic copying on language changes.

## Risks / Trade-offs

- [Broad scope and missed aria/deferred phrases] → local EN/RU catalogs, a surface inventory and rendered QA of states in both languages; do not treat the absence of English letters in user text as a completeness criterion.
- [Translation breaks logic or creates I/O on repaint] → semantic codes separate from phrases, request/write counters in fixtures, an open document in an error state, open History and map/search in regressions.
- [Storage unavailable or older host] → auto and an explicit localized message; no server fallback or unconfirmed saves. Initial auto may briefly change after an asynchronous read; do not block progress on storage.
- [Concurrent frames] → the final atomic saved write and subsequent rereading; do not promise latest-click-wins or immediate consistency.
- [Russian strings wider than English] → SDK controls and wrapping, checks at 190 px Work Status, 280 px rail, page and 200%/400% reflow; existing height-sync remains active.
- [Exported text changes language] → document the chosen language as part of presentation, preserve exact English and the machine payload, and do not promise Russian compatibility to English-language parsers.
- [Unknown support in the real host] → the installed SDK and isolated fixtures do not prove native-host integration or screen-reader compatibility; record these checks separately.

## Completion after the conformance review

The continuation was agreed separately from the historical implementation: tasks were approved and the owner authorized apply. The reasons and boundaries of the fixes are recorded below; their actual status and acceptance results are determined by the new items in [tasks.md](tasks.md), not the historical 19 checkmarks.

### Warning dismissal result announcement

Before the fix, `announceLoss()` in `census-view.ts` deduplicated the outcome only by `lossOutcome`, although the persistent live region is outside the repainted root. The same error token therefore left English text on a language change. Reproducing the actual function confirmed the discrepancy; this is not a missing catalog translation.

The fix separates operation identity from generated announcement text: unchanged outcome and text are not updated, while another language updates the text without calling `dismissLoss`. The deferred `requestAnimationFrame` write generation belongs to the latest text update, so an old callback cannot restore the previous language. The single existing live region and separate repeated errors are preserved; no new controller or service action was added. Regressions in `interface-language-followup.test.ts` execute production code and check the same token across en → ru, no repeated announcement on unchanged repaint and callbacks delivered in reverse order.

### Revision numbers are not quantities

The shared `say()` in `components.ts` formats numeric parameters through `displayCount`. Previously, `historyBlock` and `detailsBlock` passed `revision`/`structuralRevision` numbers as numbers and received Russian grouping. The fix is limited to these calls: numbers are passed as strings, and localization of actual quantities is preserved; the shared formatter and wire/model types do not change. `interface-language-followup.test.ts` executes the real History/Details renderers and distinguishes numbers from quantities at values of at least 1000.

### Reproducible reading QA and new disclosures

The initial wait for a plan row does not prove detail pagination is complete; current telemetry cannot attribute the second `/v1/plan` specifically to translation. The result-only timeout also requires separate observation of the query, response and displayed state. First reproduce each failure and check readiness boundaries; do not replace assertions with delays, empty checks or broad request exclusions. If QA is wrong, fix its wait/synthetic fixture while preserving the original behavioral oracle. If the UI is wrong, capture it in a red test and fix the root cause within the localization contract. Unrelated product changes require a separate decision.

Add language changes with map help open, a task selected and coverage/loss notes expanded to the existing isolated QA. Check preserved disclosures, selection/pan/zoom and no read/reconcile/dismiss caused solely by translation, including accessible text for the warning dismissal result. No live profile, model or changes to the main map/recording-loss spec. If infrastructure is unavailable, retain the specific blocker; do not mark an unperformed check as successful.

## Migration Plan

1. The core capability is already implemented; discovered discrepancies are fixed within its existing boundaries. Progress, checkpoints and server storage are not migrated for language; an absent language key means auto. Preparing artifacts changes no code or generated outputs and does not authorize implementation or publication.
2. Subsequent fixes preserve behavior through a meaningful red/green test and update the `docs/ui.md` contract if they change it. Structural text moves must not change semantic states or external actions.
3. Future source changes require relevant root/UI typechecks, browser regression and isolated rendered QA; only affected guest entries are regenerated with the existing `bundle:guest` (all three only for a shared change affecting all frames). A documentation edit needs no build. A backend/companion build and version bump do not follow from localization. Checks may be run through the explicit `mise exec` above.
4. Rollback on the evolved tree is a minimal compatible UI-only patch, not a wholesale revert of the original runtime commit. Progress data, run records and `interface-language.v1` are not deleted; reenabling the same version reads the saved choice. This does not make an old binary safe for run-format 2: compatibility and backend migration are governed by separate contracts, without down-migration for language rollback.

The verification map includes language/controller/format/summary suites and isolated rendered QA described in `docs/ui.md`. The historical 19 completed tasks are not fresh acceptance of the current baseline. Actual rerun results and unverified scenarios are recorded in [tasks.md](tasks.md); the existence of a test does not mean it passed or fully covers later surfaces.
