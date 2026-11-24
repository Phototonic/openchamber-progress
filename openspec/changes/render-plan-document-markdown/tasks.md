# Implementation tasks

## 1. Shared presentation

- [ ] 1.1 Resolve the implementation checkout before editing: use a source-only branch from current `upstream/dev`, carry only the intended change, and verify that the eventual `dev` diff has no release commits or generated bundles.
- [ ] 1.2 Add focused behavior coverage for the shared ready-body path, using the synthetic sample in the spec delta. In the sidebar and Pages → Agent Progress, cover formatted `.md`, identical literal `.txt` and unknown-suffix input, and inert checklist marks. Keep the document-body focus/scroll behavior and existing loading, retry, no-text, and capture-state messages under test.
- [ ] 1.3 Implement the shared preview at the ready-text branch of `documentBlock`, with the link and image policy in the design. Do not change document requests, comparison rendering, report/progress behavior, or backend code.
- [ ] 1.4 Update `docs/contracts.md` (document body presentation) and `docs/ui.md` (shared Plan document preview, links/images, capture qualifications, and unchanged literal comparison) in the same source change.

## 2. Verification and delivery

- [ ] 2.1 Use a disposable browser profile and synthetic captures in both surfaces. Change the isolated bound file after capture and open the document without a new report: assert that only recorded text is shown and that viewing/attempting to toggle marks makes no progress write and does not change the file or capture. Exercise delayed/error/retry, no available body, retained capture after a failed check, and an earlier capture returned during a newer-capture race. Verify comparison still displays literal Markdown and preserves its existing metadata.
- [ ] 2.2 In both surfaces, inspect the DOM and monitor requests/navigation for inert HTML, images with alt text, allowed web links, and disallowed destinations. Assert no document-originated requests before activation, and use an intercepted synthetic destination to check pointer and keyboard activation without visiting a real site. Check visual parity, keyboard reading, narrow reflow, and light/dark readability; keep only sanitized evidence.
- [ ] 2.3 Run `bun run build:all` before drivers that depend on built outputs, `bun run typecheck`, `bun run tsc --noEmit -p ui/tsconfig.json`, and the focused browser tests and rendered checks from 2.1–2.2 with bounded timeouts. Run `openspec validate render-plan-document-markdown --strict` and `git diff --check`. Report unavailable checks honestly. Use no live OpenCode/OpenChamber profile or paid model.
- [ ] 2.4 Verify the PR diff against `dev` contains only source, tests, documentation, and OpenSpec as applicable. Do not include generated bundles, QA artifacts, or version bumps.
