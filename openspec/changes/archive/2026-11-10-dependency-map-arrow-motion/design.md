# Design

## Context

See [proposal.md](proposal.md) for motivation and exclusions and [the capability delta](specs/dependency-map-arrow-state/spec.md) for normative behavior. `docs/ui.md` remains authoritative for the rest of the map.

The board and rail already share `dependency-map-view.ts`, its map-only stylesheet and a frame-owned, revision-paired picture. The map is not inside the ordinary plan element's motion gate. `showsLiveness` supplies the existing reported-work gate; `app.ts` aligns animations to the document timeline and handles `ap-` animation starts. Root replacement, frame retirement and instant viewport commands must remain intact.

The map coordinator sets `current: false` on a read failure or a mismatched picture. Therefore the exploratory suggestion that new static cues survive *all* stale/failed reads conflicts with the existing current-picture safety boundary. Picture eligibility takes precedence: those cases revert to ordinary arrows. Capture-off alone can retain current static cues. Do not change the coordinator to retain emphasis after failure.

## Goals / Non-Goals

**Goals:** extend the existing renderer, keep one classification per recorded edge, separate state eligibility from motion permission, and bound main-thread paint cost without a new scheduling system.

**Non-Goals:** no new graph/model protocol, layout algorithm, animation registry, feature preference, runtime instrumentation, task mark animation or broader shared-CSS refactor. Ordinary list motion remains transform/opacity only; the SVG dash-offset exception is map-specific.

## Decisions

### Visual direction

The approved direction is round working beads about 3.4 CSS px in diameter, one every 10 px at 100% map zoom, over a faint 1.5 px info-blue line with a blue arrowhead. Use a seamless 2.4 s linear cycle: a dash offset of 40 world px per cycle traverses four bead spacings, about 16.7 px/s at 100%. The amount traversed is independent of arrow length, task age, counts and completion. No filling effect or per-arrow travel-time calculation.

Blocked arrows are static: warning colour, solid 2 px line, and a stop bar just before the arrowhead. No blocked pulse alternative remains. Selection uses existing chain colour and width precedence; working beads and the blocked bar preserve state shape. The stop bar can retain warning colour on the chain. Forced colours use `CanvasText` for state shapes, a thicker blocked line, and `Highlight` for chain lines/beads/heads; the bar stays recognizable in system text colour. Exact anti-aliased pixels are not a test contract.

### State table and reviewable defaults

Apply this table only to eligible pictures; all other pictures use the prior styles. Columns are dependent reported states, not inferred scheduling state.

| Prerequisite | Pending | Working | Blocked | Done | Skipped |
| --- | --- | --- | --- | --- | --- |
| Pending | ordinary | ordinary | ordinary | ordinary | ordinary |
| Working | beads | ordinary | beads | ordinary | ordinary |
| Blocked | stop bar | stop bar | stop bar | ordinary | ordinary |
| Done | quiet | quiet | quiet | quiet | quiet |
| Skipped | dashed | dashed | dashed | dashed | dashed |

The following are adopted design defaults, not claims that each case received separate visual approval; they are explicitly available for review to overrule:

- Working → blocked keeps beads: they describe the prerequisite's report, not resolution of the dependent's separate blocker.
- Working → working stays ordinary: neither endpoint is waiting for this work to start, and motion would obscure the intended waiting signal.
- Blocked → working keeps a bar: it reports a recorded blocked prerequisite without rewriting the dependent's working status.
- Working/blocked → done or skipped stays ordinary: avoid implying an outstanding wait for terminal work.
- Off-chain beads stop and recede on selection: attention follows the selected relationship chain; state remains visible.
- Closed and archived plans receive no new cues: align with existing active/current guidance rather than implying ongoing dependency work.

A pending dependent with a skipped prerequisite can still have a working arrow from another prerequisite. Keep the skipped warning; no skipped work becomes done.

### Ownership and gates

Keep a small DOM-free classification/gating seam beside the existing map renderer, not a new generalized graph abstraction. It reads the accepted picture's endpoint statuses. Keep `data-from`/`data-to` on the one canonical base edge; decorative overlays must not double relationship counts in current QA selectors.

`createMapFrame` supplies affirmative motion permission using the existing `showsLiveness` and `vc.env.view` freshness/capture facts, with the displayed picture's lifecycle and working count. Make the view input optional and false by default so read-only previews do not accidentally animate. The map region owns its own `data-motion` gate. Also reject archived cleanup state explicitly, including an archived plan whose lifecycle is active. No changes to `model.ts`, `app.ts`, shared `style.ts` or the picture coordinator are expected.

Use an `ap-`-prefixed animation, so existing alignment covers initial paint, root replacement and CSS-driven restart. Keep the global reduced-motion and `[data-ap-hidden]` overrides effective even though map CSS is inserted later. On hidden/left/disposed retirement, revoke the view's stored and painted motion permission through the existing map-frame owner, without replacing the root. This matters because the shared visibility handler removes the hidden attribute before revalidation finishes: retained DOM must not restart old flow in that gap. Only a fresh eligible paint can restore permission. Read-only preview tests continue to prove absence of motion; production rendered QA proves the positive gate. No live-region message, count mutation or network request follows a motion-only change.

### Drawing and paint containment

Reuse each existing routed path and marker machinery. Draw base lines, arrowheads and stop bars statically. Place motion-candidate bead paths in a separate, pointer-transparent, decorative SVG layer with the same dimensions, viewBox and world transform. When selected, stationary off-chain beads belong with static drawing; only chain candidates enter the moving layer. Keep chain visual priority and card occlusion intact. At a global cost fallback the candidate layer is static, not removed.

The alternative of animating paths in the full base SVG is simpler but can repaint thousands of unrelated edges. A count cap alone does not isolate that invalidation. Use this small second layer, not one layer per arrow, canvas rendering, path-length sampling, containment registries or speculative GPU promotion. Layering is not a compositor-only guarantee; measurement remains required.

Set cost/zoom attributes during existing paint and viewport application. Crossing the zoom boundary updates motion permission in the existing action-local viewport work, without a root repaint, new loop or timer. The existing coalesced viewport frame is allowed; an animation-driving frame loop is not.

### Accessibility copy

Extend existing Map help with an arrow key: beads mean prerequisite reported working; moving beads are a looping sign, not progress or proof of current execution; stationary beads mean the same reported state. Explain bar = explicitly blocked prerequisite, dashed = skipped, quiet = done. Keep the existing arrow qualification and permission caveats.

Extend the waiting-task inspector's current readiness explanation with nonzero working/blocked direct-prerequisite counts from the same accepted picture, independent of filters. Preserve the skipped warning, full prerequisite list, blocked reason/next action and recorded-only qualifications. Card names and announcements stay unchanged; SVG decorations remain `aria-hidden`, non-focusable and non-intercepting.

### Fixed outer bounds and implementation tuning

The spec's outer bounds are **300 full-plan task arrows**, **24 eligible visible working flows** and **zoom ≥ 0.50**. Counts are deduplicated task-to-task edges, not groups or SVG elements. Eligible-flow count applies endpoint visibility and selection-chain restriction before the cap; total-arrow count never applies filters. If either count exceeds its inclusive ceiling, disable all flow rather than animate the first N edges. Fallback leaves stationary cues and zero running map animations.

The implementation can choose tighter limits, provided ordinary small plans and the specified 100-task/180-arrow/12-flow reference at 75% still animate. State the shipped limits in `docs/ui.md`, the UI contract of record, and test below/at/above them. Tuning within this allowance changes no requirement and needs no spec amendment. If measurement shows no allowed choice can preserve the user-visible goal, return for design amendment rather than quietly disabling normal motion or exceeding the outer bounds.

Keep permanent verification behavioral: pure classification/gate tests, the map-specific CSS regression, and the existing production final QA for state, phase, reduced motion, forced colours, retirement and fallback boundaries. Use small and mid-size fixtures where needed to prove positive motion; retain the existing large-plan responsiveness checks. Do not add permanent performance-harness options or a new benchmark gate. One-time final-build frame-cost measurement against pre-change guests is delivery evidence, with its method and judgment recorded in the execution plan. Zero animations removes ongoing animation work; it does not prove that added static drawing has identical paint cost.

## Risks / Trade-offs

- SVG paint cost varies with route density and zoom → separate the moving drawing and bound it; validate representative long-span and selected cases, not just animation counts.
- Source freshness and visual state can diverge → current-picture eligibility outranks static-cue retention; do not borrow a later header or another frame's data.
- New overlays can duplicate edge selectors, cover chain paths or intercept input → preserve canonical edge identity and pointer/AX exclusion; test actual production navigation and counts.
- Global reduced-motion/hidden overrides can lose to later CSS → inspect actual animations and computed styles, not just stylesheet text.
- Tests that assume every map is static can pass without exercising the feature → retain preview coverage but explicitly enable normal motion on production entries.
- Browser/AX evidence is not native-host or human screen-reader certification → retain existing documented limits; do not expand certification claims.

## Migration Plan

No data migration or persistent preference exists. Ship the changed renderer, map CSS, UI contract and affected generated panel/page entries together. A source revert plus regenerated affected entries restores ordinary arrows without changing stored plans. Delivery-specific validation and rollback actions belong in the execution plan.

Mixed versions need no new negotiation: a new guest uses the existing graph capability and statuses; an older service without graph support keeps the existing unavailable state and list alternative. An old guest continues to show ordinary arrows against the same service. Independently loaded old/new frames do not share map state and can temporarily differ in decoration without changing task facts. No service, companion, schema or protocol update is required by this change.
