# Proposal

## Why

Dependency-map arrows currently show relationships but not whether the prerequisite was reported working or explicitly blocked. Add truthful, accessible state cues so readers can find those dependencies without inspecting each card; this deliberately replaces the map's documented blanket prohibition on animation.

## What Changes

- Show looping blue beads from a working prerequisite to a pending or blocked dependent, subject to freshness, lifecycle, accessibility and rendering-cost gates.
- Show an explicitly blocked prerequisite with a static warning-colour line and stop bar before the arrowhead.
- Keep stationary beads when motion is suppressed on an otherwise eligible picture; retain recognizable shapes in forced colours.
- Preserve existing done/skipped styles, selection relationships, geometry, navigation and frame independence.
- Explain the arrow key in Map help and summarize working/blocked prerequisites in the selected waiting task's inspector.
- Check small, mid-size and large synthetic plans, choose shipped limits within fixed motion bounds, and document them in the relevant `docs/ui.md` contracts.

## Capabilities

### New Capabilities

- `dependency-map-arrow-state`: Reported dependency-state presentation, truthful motion, static equivalents and rendering-cost fallback in the board and rail maps.

### Modified Capabilities

None. Existing `subagent-loss-notices` work governs a separate capability; there is no dependency-arrow capability to modify. This change does not back-fill the rest of the map into OpenSpec; `docs/ui.md` remains the repository's broader UI contract.

## Impact

Map rendering and map-only CSS, focused browser logic/rendered QA, the map performance harness, `docs/ui.md`, and regenerated panel/page guest bundles. No service API, storage, dependencies or host capability changes are needed.

### Must NOT have

- No measured-progress claim, completion effect, blocked-arrow pulse or new session-activity interpretation.
- No animation-driven JavaScript timer, frame loop, request stream, persisted preference or per-task animation registry.
- No task/card animation, animated layout, pan/zoom transition, task scheduling or inferred dependency.
- No Work Status map/style additions, unrelated refactor, version bump or release work.
