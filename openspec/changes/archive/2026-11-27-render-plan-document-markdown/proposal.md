# Render Markdown in the Plan document view

## Why

[GitHub issue #178](https://github.com/Phototonic/openchamber-progress/issues/178) proposes an enhancement to documented behavior, not a regression fix. Today, Plan document shows saved text literally. Formatting headings, lists, emphasis, and checklist marks makes a saved plan easier to scan without opening its source in another viewer.

## What Changes

- Show the same read-only Markdown preview of the recorded `.md` document in the Agent Progress sidebar and in Pages → Agent Progress.
- Keep other document formats literal. Preserve existing loading, retry, and capture qualifications, including warnings on retained captures.
- Render captured content as untrusted data: no active HTML or asset loads, and only explicit navigation to allowed web links.

### Non-goals

No source editing, checklist interaction, task synchronization, change to comparison formatting, new capture or live-file read, change to permissions, API, storage, or generated outputs in a PR targeting `dev`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `progress-surface-hierarchy`: specify the contents of the existing Plan document panel on the rail and board. Menu behavior and document recognition/mirroring requirements are unchanged.

## Impact

TypeScript guest rendering and shared styles, focused browser coverage, and the document presentation text in `docs/contracts.md` and `docs/ui.md`. The current plain-text contract is changed only for the `.md` preview; the recorded capture and comparison contracts remain intact.
