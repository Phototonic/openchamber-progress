# Proposal

## Why

Agent Progress calls currently use the chat's generic tool presentation. A recognizable report label and checklist icon can improve scanning, but a compact summary must not mistake a submitted request, replayed receipt or unchanged task status for an effective progress update.

Investigation establishes a no-go for an outcome-bearing subtitle under the frozen tool contract. Receipts identify a plan and revision, but do not reliably describe effects or document-capture failures. Use the permitted title/icon-only fallback rather than imply success.

## What Changes

- Add one exact-match declarative tool contribution for `agent_progress_report`, with a neutral report title, checklist icon and `text` output layout.
- Omit an extension-authored subtitle and dynamic success wording. Preserve the host's normal error presentation and access to the complete tool output.
- Document why the row is not a success/effect summary, and verify the result in an isolated OpenChamber 2.7.1 chat using actual scripted tool calls.
- Keep the existing host floor, SDK pin, permissions and tool contract unchanged.

## Scope

**IN:** manifest presentation; focused manifest and real-host regression checks; UI and compatibility documentation; explicit evidence of the subtitle limitation.

**OUT / Must NOT have:** changes to tool registration, inputs, outputs, metadata, receipts or report semantics; a second copy of receipt data; inference of task effects, approval or completion; a custom renderer, page, service route or background process; added permissions; new dependencies, version bumps or engine-floor changes; changes to setup, the official-version notice or existing progress views.

## Capabilities

### New Capabilities

- `report-tool-presentation`: declarative identification of report calls without overstating their results.

### Modified Capabilities

None. Existing canonical capabilities and the frozen report protocol are unchanged. `docs/ui.md` remains the presentation contract of record and must describe this fallback; `docs/compatibility.md` records the tested host scope.

## Impact

The production change is confined to `package.json`. Existing packaging preserves the complete `openchamber` block. No runtime source changes or regenerated bundles are expected. Verification adds focused test coverage using existing isolated-host and scripted-provider patterns, not a parallel reporting implementation.
