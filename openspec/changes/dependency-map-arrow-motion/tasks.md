# Tasks

## 1. Implement state cues and bounded motion

- [ ] 1.1 Add pure map arrow classification, picture eligibility and cost-gate tests for the specified status table, lifecycle/cleanup/currentness, filter/selection counts and inclusive limits. Verify wrong endpoint direction, stale-picture emphasis and filtered bypass of the total-edge ceiling are rejected.
- [ ] 1.2 Extend the shared map renderer/CSS with the approved beads, static blocked bar, separate moving drawing, map-local motion permission and zoom-time gate. Regenerate panel/page entries and extend production final QA for both frames, phase continuity, capture off/on, failed/superseded reads, closed/archived plans and hidden/left/disposed frames. Verify edge counts, geometry, focus and preview motion-off behavior remain intact; update the relevant arrow/motion/theming portions of `docs/ui.md`.
- [ ] 1.3 Add the help key and waiting-inspector counts; verify direct-only deduplication, hidden prerequisites, zero/singular counts, skipped warnings, currentness, decorative SVG and unchanged card names/live-region behavior. Verify screenshots in light/dark, selected/unselected, reduced motion, forced colours and narrow/reflow layouts, updating the inspector/accessibility documentation with the same change.
- [ ] 1.4 Extend the motion CSS regression to inspect both stylesheets, allowing stroke-dashoffset only for map SVG motion while retaining transform/opacity-only list rules. Verify reduced-motion and hidden overrides, including pseudo-elements, and retain existing production accessibility and preview coverage.

## 2. Choose shipped limits within the contract

- [ ] 2.1 Compare final-build small, mid-size and large-plan idle rendering and panning with preserved pre-change guests using one-time, external measurement tooling. Record the numbers and judgment in delivery evidence and a sanitized pull-request summary; use them to choose limits within the spec's allowance, not to introduce a permanent benchmark gate.
- [ ] 2.2 Apply and document the shipped limits in `docs/ui.md` and test below/at/above them. Verify zero running map animations during fallback, a large plan staying static despite filters, all excess flows stopping together, ordinary small and reference mid-size plans animating, and recovery on the shared phase without new reads. Add fixtures only where behavior checks need them; rebuild affected guests and refresh evidence affected by tuning. No spec edit is needed for compliant tuning.

## 3. Integration acceptance

- [ ] 3.1 Run relevant root/UI typechecks, browser and automation suites, and existing production map final/accessibility/large and preview regressions against stable regenerated entries. Verify existing large-plan responsiveness budgets, no unrelated output/request/focus/status/geometry regression, and retained sanitized UI evidence.
- [ ] 3.2 Run portable CI once in the repository-prescribed fresh full-history disposable checkout, including generated-entry parity. Verify `docs/ui.md` no longer makes a blanket no-map-animation claim while retaining static inspector/session activity and instant viewport contracts. Audit public output for private data and unrelated release changes.
