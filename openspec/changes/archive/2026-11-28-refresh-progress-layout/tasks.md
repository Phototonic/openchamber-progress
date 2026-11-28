## 1. Establish the comparison and shared shell

- [x] 1.1 Capture the existing board and rail in isolated Chromium with repeatable synthetic plans, widths, languages and host themes. Keep matching inputs for the refreshed views.
- [x] 1.2 Extend the common shell, menu and view controls with the four-view selection, opener-specific focus return, summary preview buttons, eligible inline cleanup and panel lifetimes. Define the board/rail placement hooks and document header/body hooks before the entries consume them.

## 2. Wire the two surfaces

- [x] 2.1 Move search, quiet filter, remaining Filters and Settings to the board bar; put the active count and Select in the list header and Tidy by Finished. Preserve browse, search, archived, selection and narrow modes.
- [x] 2.2 Move the board inbox trigger and its single list to the bar; keep one authoritative global count, optional selected-plan scope, saved expansion and hidden-item recovery. Wire board views, digest, comparison and task handoffs through the shared shell.
- [x] 2.3 Wire the session rail's chooser, settings, quiet filter, summary buttons and four views. Serve only selected-plan revisions in rail History; preserve rail selection, scoped Needs you and setup/error access.

## 3. Finish reading and presentation

- [x] 3.1 Size the common document reader to the remaining height. Consolidate the header, shorten the capture note in three languages and contain wide tables without changing content safety or capture facts.
- [x] 3.2 Restore Map, List and Document positions across view changes within the current reading, respecting explicit jumps and retiring stale positions on a plan, identity or capture change.
- [x] 3.3 Apply one type/spacing/control scale and header pattern to board and rail, preserve phone and forced-colour interaction, and stabilize the legend and History Refresh during detail arrival.

## 4. Prove the change

- [x] 4.1 Update affected rendered driver navigation, browser tests and the regressions for position, overflow, delayed detail, menu focus, count scope and explicit actions. Exercise production guests with real Chromium input.
- [x] 4.2 Update `docs/ui.md`, `docs/setup.md` and `README.md` navigation, including empty/error instructions. Build locally; do not commit generated runtime outputs on the development branch.
  - The navigation text landed in #215; that PR did not replace existing documentation illustrations.
- [x] 4.3 Run the relevant type and browser checks and strict change validation. Compare matched before/after board and rail screenshots in both themes, wide and narrow, including Simplified Chinese. Obtain visual approval before opening a pull request.
  - #215 records visual approval and isolated Chromium checks. The standalone change-digest prerequisites driver timed out on the base as well; it passed with the later test-only fixes in #218.
