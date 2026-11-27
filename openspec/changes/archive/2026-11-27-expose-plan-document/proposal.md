# Expose Plan document beside Map and List

## Why

The read-only preview in [issue #178](https://github.com/Phototonic/openchamber-progress/issues/178) should be directly reachable from the plan view, without opening More.

## What Changes

- Move Plan document from More to the Map and List control group in Pages → Agent Progress and the right sidebar.
- Keep the existing document panel, with Back and Escape returning focus to the button that opened it.

## Impact

Changes `progress-surface-hierarchy` and its shared navigation. No change to Markdown rendering, capture reads, comparison, persistence or Work Status.
