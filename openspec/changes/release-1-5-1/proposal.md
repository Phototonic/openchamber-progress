# Agent Progress 1.5.1: Fast with many plans, and Tidy you can find

## Why

1.5.0 made the rail and board simple by default. Use with a large plan library showed seven problems.

- **The full page stalls.** With about 500 loaded plans, an idle full page spends roughly 40% of its time in main-thread tasks of up to 0.8 s. Dragging or panning the map crawls and switching plans takes seconds, while the rail on the same map stays smooth. Measurement shows the cost is not the map, the service or request volume: every repaint re-derives filters, locations and sessions for all plans several times, re-partitions the whole held Needs you list once per plan row, and rebuilds every row, although nothing was reported.
- **The plan list's scrollbar cannot be dragged.** A background repaint replaces the list's scroll container during the drag, so the thumb stops following the pointer.
- **The rail map is too short.** It shrinks to its content and never exceeds 300 CSS pixels; a plan with one or two rows of tasks gets a frame of about 110 to 210 pixels.
- **"Focus current work" is gone.** 1.5.0 removed the button because the map opens on current work, but after panning or Fit there is no way back to that view.
- **Tidy was never found.** It is a More entry worded "Archive closed plans…", absent while a search or filter is set, limited to 50 finished and cancelled plans per confirmation, and it cannot delete. Clearing a large library is not practical with it, and plans abandoned in progress cannot be cleaned up at all because the service refuses to archive or delete them.
- **Map help is a wall of text.**
- **Counts show "0+" and plus marks nearly everywhere.** An incomplete zero is written "0+", every plan row gets a "0+" badge while the Needs you read is incomplete, and one incomplete reason marks every sub-agent count.

## What Changes

- Make the full page responsive with a large library. Facts derived from the plan list (shown plans, locations, filter choices, each plan's Needs you count) are computed once per change of their inputs, a refresh that changes nothing rebuilds nothing, and the plan list is updated in place. Interface only: no route, service, schema, polling or read-budget change. A measured gate on a synthetic 500-plan library compares before and after.
- Keep the plan list's scroll container across background repaints, so a scrollbar drag, wheel or touch scroll in progress continues.
- Give the rail map more height on a fine pointer: at least 320 CSS pixels, growing with the plan up to 60% of the rail's visible height. The phone cap stays.
- Restore the **Focus current work** map button, with its key in help.
- Replace Tidy's More entry with an always-visible **Tidy** button on the full page that offers **Archive** or **Delete permanently** for every closed plan (finished, cancelled and failed) matching the current search and filters, or all closed plans when none are set, including plans not yet loaded.
- Add **multi-select** on the full page: several plans, or all plans matching the current search and filters. The selection offers Archive and Delete permanently (Restore and Delete permanently in Archived plans) for plans of any status, with a one-line warning when in-progress plans are included.
- **BREAKING (service contract):** archive and delete accept an in-progress plan when the request carries an explicit acknowledgement, and restore accepts an archived plan of any status. A separate capability fact advertises this. Requests without the acknowledgement behave exactly as before. Later reports to an archived plan are refused until it is restored; reports to a deleted plan are refused and its identifier is never reused.
- **BREAKING (visible behaviour):** the rail and the More menu no longer hold a bulk archive entry. Bulk confirmations are one short line with the count and action instead of a list of every plan. Bulk actions can delete, after their own confirmation.
- Shorten map help to keys, what arrows mean, and filters, in three languages.
- Show a plus mark only on a positive number that may really be higher. Zero never carries a plus and never gets a badge.
- Add one sentence to the companion guidance on what a refused report means after the person archived or deleted the plan.

## Capabilities

### New Capabilities

- `large-library-responsiveness`: the responsiveness budget of the full page with a large library, uninterrupted list scrolling and map gestures during refreshes, and the limits that keep the speed-up honest.
- `active-plan-cleanup`: the service contract for archiving, restoring and deleting an in-progress plan, and what later reports to an archived or deleted plan do.
- `plan-selection-actions`: multi-select on the full page and its Archive, Restore and Delete actions on plans of any status.

### Modified Capabilities

- `closed-plan-tidy`: Tidy becomes an always-visible full-page button covering every closed plan in the board's scope, offers Delete permanently as well as Archive, runs larger bounded batches with progress and Stop, and leaves the rail and the More menu.
- `incomplete-count-indicator`: a plus mark only on a positive count that its own reasons can raise; no plus and no badge for zero.
- `needs-you-inbox`: an incomplete zero shows no number and is not presented as a verified empty result; a plan row shows its count only when positive.
- `dependency-map-view-controls`: taller rail frame, Focus current work restored, short help.
- `plan-mirroring-guidance`: guidance for a report refused because the plan was archived or deleted.

## Impact

Affected owners: the full page entry and its board model, the shared view controller's paint path, the scope and live-session lookups, the inbox partition and its views, the sub-agent summary, the cleanup model, view and controller, the board bar and search results, the dependency map view and its styles, the shared cleanup validation and the health reply, the companion guidance text, browser and backend tests, rendered drivers and one new measuring driver. `docs/ui.md` and `docs/contracts.md` change with each behaviour; `docs/backend.md` changes where it describes cleanup.

Protocol and schema stay at 2. No store migration, new table, new route, new permission, host floor change or SDK change. The cleanup storage format and its persistent guards are unchanged. The cleanup request gains one optional field and health gains one optional fact.

## IN / OUT / Must NOT have

IN: the capabilities above; English, Russian and Simplified Chinese together; keyboard and screen-reader behaviour; rendered checks at desktop width and 390 px; documentation in the same pull request as each behaviour; a before/after performance measurement on the synthetic library; release preparation for 1.5.1.

OUT: wheel or trackpad-pinch zoom on the map (the map contract keeps wheel as pan and Ctrl/Cmd wheel as browser zoom); retaining the map's own DOM across repaints; a compact freshness or summary route; a bulk service route or any request that names more than one plan; changing the list ceiling or any refresh budget; a cleanup action for a visible in-progress plan in the per-plan More menu or on the rail; un-archiving a plan automatically when its agent reports; a distinct error code for archived plans; changing which recorded reasons qualify a count on the service side; virtualising the plan list; saved selections.

The release MUST NOT archive, restore or delete a plan without a confirmation that states the count and action; touch an in-progress plan from Tidy, or from any request that lacks the explicit acknowledgement; delete from an action presented as archive; offer Undo for a deletion or imply secure erasure; report a plan as archived, restored or deleted without its validated receipt; retry a refused or uncertain request by itself; continue a run after the store, account or board scope changed. It MUST NOT restore a plan because an agent reported to it, free a deleted plan's identifier, or accept a report to an archived plan. It MUST NOT present a possibly low count as exact, show an incomplete zero as a verified empty result, or drop a plus from a count that a reason can still raise. It MUST NOT add a timer, polling loop or route, raise a refresh or inbox budget, defer freshness indefinitely to protect a gesture, key a cached derivation on the progress revision alone, or weaken duplicate-identifier, source-trust or worktree placement rules. It MUST NOT commit measurements, stores or logs taken from a real library.
