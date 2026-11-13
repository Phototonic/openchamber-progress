# Proposal

## Why

Choosing between the OpenChamber language, English and Russian lets users read progress and share summaries in their chosen language without changing user data. The capability is already implemented; the 2026-11-12 update aligns its description with the project's current surfaces rather than starting implementation again.

## What Changes

- A compact Language control sits in the lower utility area of the side panel and full-screen page next to Setup and Details. It is available regardless of plan presence, loading state or setup completion; Work Status applies the language without a separate switch.
- Follow the OpenChamber language by default while allowing an explicit choice of English or Russian. Save one choice through SDK device storage for the current profile, runtime and extension installation, without tying it to a plan or session or sharing a server setting with other clients.
- Localize extension-owned labels, messages, hints, accessible control names and the formatting of time, durations, numbers and plural forms in all three views.
- Also localize the utility headings, state names, warnings and explanations in copied progress update / handoff summaries, including the historical summary-only variant. Preserve Markdown structure, the set of disclosed data and the match between the displayed preview and copied text.
- Do not translate or overwrite user-provided titles and contents of plans, tasks and documents, session names, blocker reasons or other recorded user values. Preserve machine keys, identifiers and the diagnostic support payload; do not change the language of OpenChamber itself or its host-owned controls.
- Clarify the existing contract's coverage: map help, deselection and the right-hand map panel, arrow-state explanations, the incomplete sub-agent coverage indicator and recording-gap warnings. Translation does not perform these surfaces' actions or change their own rules for readiness, animation, warning acknowledgement or data completeness.

### Completion after the conformance review

The core capability is implemented, but a review of the current baseline found two contract violations and unfinished browser acceptance checks. Continuing this change addresses those discrepancies without changing the product goal:

- Update the accessible announcement of the sub-agent warning dismissal result when the language changes, without repeating the action itself.
- Keep revision and structural revision numbers in History and Details free of localized grouping; continue formatting actual quantities for the language.
- Investigate reading QA failures and check language changes with the new map and coverage controls expanded, without weakening assertions to obtain a passing run.

### Boundaries of the continuation

Only this change's existing artifacts are modified during planning. After separate task approval and implementation authorization, necessary UI fixes, tests, documentation and rebuilds of affected bundles are allowed. Backend/wire/storage, main specifications, dependencies and CI remain out of scope; this agreement does not authorize commit, push, sync, archive, live-host installation or publication. A discovered discrepancy must not be resolved by weakening a requirement.

## Capabilities

### New Capabilities

- `interface-localization`: choosing and saving the extension's interface language, applying the shared setting across all views, localized display and generation of user-facing summaries while preserving source data and machine contracts.

### Modified Capabilities

None. The main specifications [dependency-map-arrow-state](../../../specs/dependency-map-arrow-state/spec.md) and [subagent-loss-notices](../../../specs/subagent-loss-notices/spec.md) already exist and define their capabilities' behavior. Only their display language is clarified here, without changing those contracts. The main `interface-localization` specification has not yet been created through sync/archive, so the delta retains `ADDED Requirements`.

## Impact

- The reviewed baseline for the update is `develop`, `b0f3805`, package 1.1.1, `@openchamber/sdk` 2.7.0. This is not the old pre-implementation baseline: later upstream changes affected the map, sub-agents, storage-state handling and compatibility checks.
- The shared lifecycle in `ui/shared/app.ts`, three entrypoints, distributed shared UI text catalogs, `format.ts` and `summary.ts` remain the integration points. Details and current boundaries are in [design.md](design.md) and [docs/ui.md](../../../../docs/ui.md).
- Unit/controller tests and two separate language QA scripts exist: `interface-language-qa.ts` for the setting and three frames, and `interface-language-reading-qa.ts` for preserving reading state and avoiding extra operations. [tasks.md](tasks.md) distinguishes historical completion marks from fresh verification results. Planning needs no rebuild; during authorized implementation, fixes in `census-view.ts` and `components.ts` must include regressions and updated affected guest bundles.
- Localization uses the existing SDK; it adds no backend endpoint, changes no progress wire contract and introduces no runtime dependency. Later run storage and API changes belong to their own capabilities, not this language setting. Export respects the selected language while preserving the previous English format for the same inputs.
- Automatic mode without device storage, the English fallback, reconciliation on the existing cycle and preview translation from a retained snapshot are preserved. Current documents and the old 19 completed items do not by themselves prove fresh runtime/native-host acceptance.
