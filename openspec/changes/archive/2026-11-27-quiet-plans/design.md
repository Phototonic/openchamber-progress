# Design

## Existing boundaries

`PlanSummary.reportedAt` already reaches ordinary lists, detail and search summaries. `Store.applyMutation` stamps explicit committed reports; staging and replay do not advance it, automatic delegation binding preserves it, and archive/restore leave it unchanged. No last-report query or history scan is needed.

Agent finish currently belongs to the coordinator. It advances one ordinary revision, preserves unfinished task statuses for cancellation and clears current blocker annotations on closure. Reopening requires coordinator `revise` or `commit` with `reopen:true`; staging alone never reopens. The service has authenticated archive/restore/delete actions but no user lifecycle write. Cleanup has no user actor and does not change progress revisions.

The report `Actor` is an OpenCode session identity, not a human identity. The host bearer authorizes the existing local service proxy; the integration-account string is not an authenticated human principal. User cancellation must not borrow a coordinator session, populate a fake session, or call the agent tool on the person's behalf.

## 1. Factual age

Use a shared pure UI helper receiving lifecycle, stored `reportedAt` and an explicit `now` in milliseconds. Eligible means active, a valid canonical stored ISO instant, and elapsed time at least `7 * 86_400_000` milliseconds. Display whole elapsed days using floor, not calendar-date subtraction. Invalid or future times produce no quiet classification and never hide a plan.

`now` is browser wall time, as for existing report-age presentation, not a new server timestamp. The wording describes the latest recorded report, not actual activity; the existing failed-read and capture-off qualifications stay visible. Clock skew can change the classification. An absolute report timestamp remains available with the label. Tests inject `now` or control the browser clock; no sleeps or real-day waits.

Reevaluate on the existing visible refresh/repaint path, including unchanged successful reads and clock corrections. Invalidate only when label/day or membership changes. No per-plan timer, new polling owner or service request is added. A newly observed report immediately removes the label when below threshold.

Seven days is fixed. Existing preference surfaces support language and bounded view choices, not numeric settings; adding a threshold editor is unnecessary for this outcome.

## 2. Filter and persistence

The owner chose to hide quiet plans initially. The visible control is **Hide plans with no reports for 7 days**, initially checked. Put it in board Filters and in the rail More menu as a checked view preference, available even when filtering leaves no selected plan. The rail picker and narrow-board picker show only admitted choices. Quiet labels appear in picker hints, board rows/results and the selected header when those plans are shown, without duplicating the old age line. **Show all plans** disables this preference through the same save path; it does not clear unrelated filters.

Use one device preference shared by rail and board. Extend the existing `DeviceViewState` owner and its serialization, feature gate and refresh lifecycle, but use a separate tiny versioned `quiet-plans.v1` record `{v:1, hide:boolean}`. The existing `progress-view.v1` parser rejects unknown fields; adding this boolean there would make older frames discard all three established view preferences. A separate key preserves those bytes and needs no new controller or storage abstraction.

Read/write only through SDK device storage. Missing means the filter is enabled. Malformed/failed reads use that same documented default with a fixed explanation, do not repair bytes and allow an explicit retry. Failed writes retain the last confirmed value (or loaded default) and report failure, never “saved.” Without device storage, filtering starts enabled and the choice lasts only in the frame with an explicit explanation. Other frames converge at the existing preference-refresh cadence; no cross-frame channel or person-isolation claim.

Apply the predicate before browse grouping, picker positions and selection fallback. Preserve relative ordering and whole-plan task counts. If a selected plan is excluded, choose the existing first eligible fallback without overwriting the saved rail choice merely because it was filtered; if none qualifies show a filter-specific empty state and **Show all plans**, not “No plan reported.”

Board search remains bounded and explicit. Add the local predicate alongside its existing location predicate before accepting hits and classification deltas. Freeze the age cutoff for each search traversal, include the preference in its local identity, and keep existing “as searched”/partial coverage qualifications. A preference change retires the old search reading and offers Refresh search; only explicit submit/refresh begins another bounded traversal, never the device-storage read/save itself. Browse filtering updates immediately. No wire search field or automatic scan to fill beyond existing budgets. Refreshing a known plan's summary clears its label; an excluded, unobserved search candidate is not promised live rediscovery.

The same predicate and captured cutoff must constrain Select all/count/cleanup scan targets; hiding a row cannot silently leave it eligible for a bulk action. Changing the preference retires open confirmations and search/selection scope. Tidy's closed-plan eligibility remains unchanged. Do not narrow the independently owned Needs you inbox or alter its counts. Work Status and composer/session background selection remain unchanged.

## 3. Narrow service operation

Advertise additive ready-health `planUserCancel:1`. This is protocol support negotiation, not a rollout flag. Offer cancellation only for a visible active plan in the service's current verified bound source. The authenticated host proxy is the user-control authority, as with cleanup; neither the selected OpenCode session nor browser-supplied actor fields grant authority.

Freeze this query-free route before its producer and consumer implementation:

```text
POST /v1/plan/cancel
{storeId, binding:{sourceId,verified}, source, plan, rev, cleanupRev, oid, confirmed:true}
```

Use existing identifier and positive/nonnegative safe-integer rules, strict UTF-8/JSON, unknown-field refusal, the 16,384-byte request ceiling and fixed code-only errors. Accept no outcome, task changes, paths, actor, session or timestamp. Reuse fresh managed Store admission, bearer authentication and loopback transport. Inside the Store write transaction recheck actual store/binding/source verification, enabled recording, cleanup state/generation and expected progress revision. Recording-off refuses `disabled`; do not borrow cleanup's capture-off exception for a progress revision.

Success is a bounded receipt with `{storeId, sourceBinding, source, plan, oid, rev, structuralRev, lifecycle:"cancelled", actor:"user", reportedAt}`. `rev` is the one new revision. Invalid input is 400, auth 401, missing/deleted 404, wrong method 405, oversize 413, revision/binding/cleanup conflict or closed/disabled/unverified/operation-reused 409, and unavailable/busy/corrupt/schema/storage 503. Replies retain JSON, no-store and nosniff. The UI validates receipt identity and expected revision advancement before acknowledging success.

Implement a narrow Store method, not a generic HTTP reporting API or an authority bypass argument to `applyMutation`. Reuse the existing transaction and close-state rules. Keep owner, title, items/statuses, assignments, location, links and document references; clear only closure-invalid current metadata as ordinary finish does. Preserve all earlier snapshots, captures, receipts and contributions. A user cancellation is an explicit recorded lifecycle outcome and stamps the new snapshot's existing `reportedAt` with service time, not browser time. It cannot create a quiet active plan because it closes it; a later explicit reopen is a new report.

Use the existing revision row's JSON `actor` for a distinct server-authored `{kind:"user", action:"cancel"}` identity. Do not change the plugin's session `Actor` or add a contribution attributed to the coordinator. There is no named-person claim: “User” means an authorized host UI action. Project this fixed discriminator as optional `actor:"user"` on the existing bounded history rows; do not expose raw actor JSON. History renders **Cancelled by user**. Legacy rows with no discriminator keep existing generic labels, never guessed attribution.

Use existing receipts, with a domain-separated canonical hash of the complete user request and action. Verify authority/recording and archive/delete fences before replay. Identical admitted retries return the original receipt without another revision, even after a later reopen; they never cancel again. Changed semantic input or an agent/user operation-ID collision refuses. New requests use fresh IDs and reviewed revisions; conflicts never auto-rebase. Transaction failure leaves no partial outcome, actor or receipt.

Pending old-revision reports and staged commits conflict; ordinary new reports to the closed plan refuse. Check the existing delegation lifecycle fence so late dispatch binding cannot assign after cancellation. Reopen remains an intentional coordinator action using current revision and existing semantics, not an automatic response to `closed`. Update agent guidance to include explicit user cancellation in its stop-and-ask rule without changing tool inputs.

## 4. Confirmation, lifetime and copy

Join the selected plan's existing More actions, separate from archive and from permanent deletion. Do not touch Map/List/document switch code. Use the existing inline confirmation and focus-handoff conventions, not a new dialog framework. Initial focus goes to **Keep plan active**. Opening, declining and Escape send nothing; focus returns to More. Confirmation names the literal plan and explains preserved work/history, coordinator reopening, and that running agents are not stopped.

Capture account/frame generation, store/binding, source/plan, progress revision and cleanup generation when opening. Selection/scope/authority changes, hide/disposal, newer revisions or loss of capability retire the confirmation. Recheck before sending. Pending disables duplicate activation. A dispatched request may commit after the view retires; a late reply cannot affect another reading. On accepted success retire affected caches and use one ordinary reconciliation refresh. Refusals and uncertain lost replies remain distinct; no automatic retry or success toast on an unreadable receipt.

### String inventory

Ship every entry below in **en, ru, zh-CN**, including accessible names and announcements, using existing catalogs/plural/quantity formatting. These are English reference strings, not translations of user text.

| Purpose | New reference copy |
| --- | --- |
| Age | `No reports for {days} days` (locale plural forms) |
| Filter / checked menu item | `Hide plans with no reports for 7 days` |
| Empty / recovery | `No plans match this filter.` / `Show all plans` |
| Preference unavailable | `This choice lasts only while this view is open.` |
| Preference read failure | `Couldn’t read this filter choice. Using the default: hide plans with no reports for 7 days.` |
| Preference save failure | `Couldn’t save this filter choice. Keeping the previous choice.` |
| Pending preference | `Saving filter…` |
| Menu / confirm button | `Finish as cancelled` |
| Confirmation heading | `Finish “{title}” as cancelled?` |
| Confirmation body | `History and unfinished tasks will be kept. The coordinating agent can reopen this plan when you ask. This does not stop running agents.` |
| Decline | `Keep plan active` |
| Pending action | `Finishing as cancelled…` |
| Success / history | `Plan cancelled by user.` / `Cancelled by user` |
| Conflict | `This plan changed. Review it again before cancelling.` |
| Ineligible | `This plan can’t be cancelled here. Refresh to see its current state.` |
| Recording off | `Recording is off. Turn it on before cancelling this plan.` |
| Confirmed refusal | `The plan was not cancelled. Try again after refreshing.` |
| Uncertain result | `Cancellation could not be confirmed. Refresh to check the plan before trying again.` |
| Preference-change announcement | `Plan filter changed.` |

Reuse existing localized More, Retry, Refresh, absolute-time tooltip and generic unsupported/error labels where their meaning matches. Do not concatenate English day suffixes, translate titles or display raw errors.

## Compatibility, risks and documentation

No schema/table/index change, migration or backfill. Existing schema-2 revision actor JSON and receipts suffice. Old services lack the capability and receive no cancel request; quiet presentation still works from existing timestamps. Old guests ignore the history field; old writers retain lifecycle/revision fences and can explicitly reopen. Prove the cancelled snapshot remains readable by the previous released Store, including detail pagination with no new agent contribution. User audit remains in immutable history after reopen and rollback; older UIs may not display its attribution.

Rollback removes presentation/route support, not data, receipts or device records. Never reset the database or silently reopen cancelled work. Existing archive/delete guards remain intact.

Update the guides in the same implementation PR: `contracts.md` for route, actor/history, capture gating and report-only age; `backend.md` for Store ownership and audit/replay; `ui.md` for label, filter, persisted-state exception, More confirmation and failure/focus rules; `README.md` for a short factual discovery/cancellation explanation. Correct only related historical statements. Narrowly update companion guidance's cleanup/refusal wording; no reporting redesign.

The owner confirmed initial hiding and rail/board-only scope; Work Status selection and visibility remain unchanged. No owner decision remains open. The requested plan-level action does not require per-task interaction. Recording-off and unverified-source refusal deliberately preserve safety rather than expanding authority. The additional stored preference is an explicit modification of the prior view-state restriction, not an undocumented exception.
