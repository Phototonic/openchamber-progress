## 1. Set the shared boundary

- [x] 1.1 Announce the additive contract revision, define the activity window and row types beside the existing read contracts, document the opt-in History request, compatibility and error semantics in `docs/contracts.md`, and agree the small List-facing page state/actions before producer and consumers diverge.

## 2. Read a revision window

- [x] 2.1 Implement the metadata-only indexed Store read and authenticated History query form, preserving the plain history route. Explain row/time provenance and bounds in `docs/backend.md`.
- [x] 2.2 Exercise actual HTTP against a disposable SQLite store: two assigned children, direct and relayed reports, multi-item and empty contributions, a cancellation and reopen, adjacent windows, malformed input and a missing plan or gap. Compare with the stored rows and confirm the read makes no writes.

## 3. Read and show activity on demand

- [ ] 3.1 Validate one activity reply in the guest wire adapter and manage one page for the active List reading. Cover pins, older/newer navigation, unavailable/legacy responses and retired replies without changing the normal refresh budget.
- [ ] 3.2 Add the shared disclosure in rail and board List, reuse History row elements/cancellation copy and rail report phrasing, and localize normal and failure states in all three languages. Preserve History and the plan-view switch.
- [ ] 3.3 Document discovery and behaviour in `README.md` and `docs/ui.md`; add an Unreleased entry to `CHANGELOG.md`.

## 4. Verify the integrated feature

- [ ] 4.1 After service and reader acceptance, connect the shared List section to the rail, then the board. Use the existing synthetic SDK shell and Chromium fixtures with a disposable service/store to verify on-demand paging on a long history, reporter/time/task fidelity, user cancellation, keyboard interaction while a read is pending, language changes and unaffected History. Capture sanitized screenshots; no live profile or model calls.
- [ ] 4.2 Run focused checks, both typechecks and the repository's portable pre-PR suite on the integrated source; build outputs locally as needed but do not include them in the PR. Strictly validate the proposal and inspect the public diff. No version bump.
