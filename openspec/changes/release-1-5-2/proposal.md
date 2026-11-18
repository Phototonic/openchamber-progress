# Agent Progress 1.5.2: Cleanup follow-ups from the 1.5.1 review

## Why

1.5.1 added Tidy and multi-select. Review of that release accepted a set of follow-ups and deferred them, because none lets an archive or a deletion reach a plan the person did not choose: every request still carries the plan's revision and the service checks it. They do leave a count, a selection, a focus position, a result line or a QA result less precise than the interface says.

- **A count can be stated as exact when it may be low.** A plan list read in several pages is not a snapshot, yet Tidy and Select all count from it as if it were. While searching, a freshness check can be credited to a result page it never asked about, a check started before a cleanup can still act after it, a plan confirmed gone can stay counted as selected, and a plan the person never deselected can be left out of the next action.
- **Cleanup state can cross an account or store switch.** A bulk run that finishes after the switch clears caches and selection on the new board. A remembered list can bring back cleanup controls after the service stopped offering cleanup.
- **Background cleanup updates interrupt the person.** A count that finishes while a button is held replaces that button, so its click is lost. A focus move queued for the Tidy button is applied after the person has moved on to another control.
- **A lost reply is reported as "skipped".** A request whose answer never arrived may have been applied, but the result line files it with the plans the service refused.
- **The large-library gate attributes idle traffic imprecisely** at window and refresh boundaries, and can report a pass for a comparison it could not make.
- **Four small inaccuracies.** Guidance for work that moves back to a prerequisite keeps a task blocked on a prerequisite the plan no longer has. A malformed delegation receipt can produce a confident refusal in coordinator guidance. Two documentation statements about bulk counts say more than the code does.

## What Changes

- Tidy and Select all say that plans may have been missed when their count comes from a list read in more than one page. A single-page list and explicitly chosen rows stay exact. No read is added.
- A search freshness reply certifies only the result page it was asked about, a cleanup retires freshness checks already in flight, a plan confirmed gone leaves the selection whichever page is shown, and a plan a cleanup receipt took out of a Select all rule is kept apart from plans the person deselected, so a plan that returned to the view is counted again.
- A bulk run that finishes after the account or store changed changes nothing on the new board. A remembered list never brings back cleanup support that a later health reply withdrew.
- A count that finishes in the background, and the deferred focus move after a run, wait for the person: neither replaces a held control nor takes focus from a control the person has since chosen.
- **Visible copy change:** the bulk result line separates plans that were skipped from plans whose request could not be confirmed and may have been applied, in English, Russian and Simplified Chinese. Undo still restores only plans with a validated receipt.
- The selection QA driver waits longer for the fixture service and asserts that every plan was archived before it uses Undo.
- The large-library gate bounds its idle window exactly, keeps delayed follow-up requests with the refresh that caused them, records how an artifact attributed its traffic, compares both inbox request forms separately and reports a comparison it could not make as unverified instead of passed. QA only.
- Guidance tells an agent to clear a dependency block against the plan's current prerequisites. Coordinator refusal guidance validates a receipt's state against its dispatch before inferring that cleanup retired it. `docs/ui.md` and `docs/contracts.md` state when chosen plans are checked by point lookup and which revision a retry compares against.
- Three adjacent defects are fixed with the follow-ups they sit beside: a newly opened search result page no longer inherits the previous page's checked state; a run progress update no longer replaces a held control; and cleanup controls on the new board no longer stay pending after an account or store switch until the earlier request settles.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `closed-plan-tidy`: count exactness for a multi-page list, the result line for unconfirmed requests, results and cleanup support bound to the current account, store and service answer, and background updates that do not interrupt.
- `plan-selection-actions`: how a selection follows confirmed changes during a search, and departures kept apart from deselection.
- `large-library-responsiveness`: precision of the idle-traffic check that guards the no-larger-reads requirement.
- `plan-mirroring-guidance`: clearing a dependency block against the plan's current prerequisites.
- `delegation-intent-visibility`: refusal guidance rests on validated receipt evidence.

## Impact

Affected owners: the shared view controller (cleanup run, count and focus paths, remembered list scopes), the search controller's freshness and paging, the cleanup model (selection rule, run engine, result copy) and its view, the full page entry's selection reconciliation, the list read, the delegation refusal reader, the companion guidance text, browser and backend tests, the cleanup service test fixture, the selection QA driver and the large-library driver and gate. `docs/ui.md` and `docs/contracts.md` change with each behaviour.

Protocol and schema stay at 2. No route, request field, receipt, capability fact, store format, migration, permission, host floor or SDK change. No refresh sends more or larger reads.

## IN / OUT / Must NOT have

IN: the follow-ups above; English, Russian and Simplified Chinese together where copy changes; a regression test that fails first for every defect; documentation in the same pull request as each behaviour; release preparation for 1.5.2, whose pull request also archives the 1.5.0 change, the 1.5.1 change and this one, in that order.

OUT: repairing the stale rendered QA drivers that predate 1.5.1 (tracked separately); a list read the service can vouch for as a snapshot, which is what would let a multi-page count be exact again; changing how the ordinary list read pages; retrying an unconfirmed request automatically; an Undo for plans without a receipt; a bulk route; any change to the service's cleanup contract.

The release MUST NOT relax a documented safety contract: the service's per-plan revision and generation check stays the final safeguard, and every rule of the 1.5.1 change still holds. It MUST NOT report a plan as archived, restored or deleted without its validated receipt, call a request that may have been applied "skipped", or call a plan the run never attempted "possibly applied". It MUST NOT present a possibly low count as exact, or mark a selection count with a plus where the 1.5.1 rule does not. It MUST NOT apply one account's or store's receipts, cache resets or selection changes to another. It MUST NOT add a timer, polling loop, route or read, defer a repaint the person asked for, or defer freshness without bound. It MUST NOT let the gate pass a budget it could not compare, and it MUST NOT commit measurements, stores or logs taken from a real library.
