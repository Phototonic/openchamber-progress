# Proposal

## Why

Installing Agent Progress should also deliver its capture companion to the OpenCode managed by OpenChamber. The current separate global installation outlives the extension, complicates setup and gives extension disable/removal a surprising meaning. Host-managed delivery solves that lifecycle mismatch, but requires a shared verified binding, deliberate legacy migration and an explicitly weaker executable-integrity contract.

## What Changes

- Declare `contributes.opencodePlugin: "build/companion"`, using the existing bundled plugin, inline skill and guidance. Keep OpenChamber `>=2.7.1` and SDK 2.7.0.
- Discover one private, product-owned binding under the canonical OpenCode data root. Creating or selecting a store remains explicitly confirmed; installation approval alone does not authorize adopting existing data.
- Replace normal global-plugin installation with managed capture configuration. Offer one confirmed migration for a fully validated legacy installation of the same store/source, retaining all history.
- Distinguish packaged delivery, last matching loaded-companion observation, capture control, recorded revisions and viewer freshness. Warn about differing loaded fingerprints without refusing companion startup solely for that difference.
- Explain lifecycle by delivery mode, including restart-dependent environment fallback, excluded runtimes and independently installed legacy/global copies.
- Update distribution checks, generated entries, behavioral coverage and the six affected user/contract guides together.

## Scope

**IN:** manifest contribution; shared binding discovery and explicit configuration; legacy migration and recovery support for at least one release; companion activation/disposal; setup/reporting-health presentation; package/Git/parity verification; generated outputs; README and setup/contracts/backend/UI/compatibility documentation; trust-boundary review.

**OUT / Must NOT have:** report protocol or `agent_progress_report` input/output changes; SQLite schema or run-format changes; cleanup, retention or progress-wording changes; automatic task mutations; hidden/restricted-tool bypass; global config editing; automatic global plugin installation; automatic legacy adoption/removal; root scanning or fallback binding copies; host restarts; new service inventory permissions; host-native skill/instruction replacement; new network/hosted components; replacement of the existing official-version notice or `/v1/extension-update`; dependency/version bumps or release publication.

## Capabilities

### New Capabilities

- `managed-companion-delivery`: approved host-managed plugin delivery, verified shared binding, explicit legacy migration and truthful lifecycle/integrity observations.

### Modified Capabilities

None of the existing canonical OpenSpec capabilities needs a delta. The existing setup, ownership and lifecycle contracts currently live in `docs/`; this change explicitly replaces their normal-path requirements as described in the design. Existing localization requirements apply to all new extension-owned controls and messages without changing language policy.

## Impact

Extend the existing binding/platform, SetupController/lifecycle, companion, Store activation-observation, setup UI and reporting-health owners rather than introducing a parallel installer or reporting system. Preserve source/store identifiers and stored reports. The managed executable runs from the host-installed extension folder, not a private immutable payload selected by the legacy ownership manifest. This is a deliberate integrity downgrade, not an equivalent replacement. The guides remain the contract of record and must be amended with implementation.
