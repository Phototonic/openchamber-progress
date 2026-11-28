# Design

## Use the session snapshot, not an issue tracker

OpenChamber’s [2.5.2 release notes](https://github.com/openchamber/openchamber/blob/v2.5.2/CHANGELOG.md) introduce session `links`. The [published 2.7.1 workspace declarations](https://unpkg.com/@openchamber/sdk@2.7.1/dist/workspace.d.ts) define `GuestSessionRecord.links?: GuestSessionLink[]`: `title: string`, `url: string`, `kind: 'issue' | 'change'`, `linkedAt: number`. The [guest API](https://github.com/openchamber/openchamber/blob/v2.7.1/packages/sdk/API.md) documents the existing `sessions` grant, `onSessions` updates when links change and the standard `openUrl` host action. This checkout already uses that SDK and requires host 2.7.1 or later. The session-action item identifies a clicked session; it is not the link payload.

`change` includes pull, merge and change requests. There is no provider, resource number or open/closed/merged field on this record. Show the bounded host title: “PR #95” if that is the title, not a guessed number for a URL or a “PR” label for every change. Use the supplied kind in localized context and accessible names. Never promote words in a title, `linkedAt`, a session outcome or a plan lifecycle into resource state. Skip richer status and provider enrichment.

## Keep the join and the address narrow

Extend the existing `hostWorkContext` projection in `LiveWorkspace`, not the report or HTTP adapter. Its small guest interface remains `links` with `title` and `kind`, now with an optional admitted `url`; `moreLinks` remains a qualification, not an exact total. Keep the existing limits (inspect at most 100 records, retain at most five, cap each title at 200 code units) and kind/timestamp checks. An admitted address must meet the existing document web-link policy: absolute HTTP(S), at most 2,048 code units, a host, no credentials, whitespace, controls or backslashes. Reuse the small URL policy **without** importing a Markdown parser into live subscriptions. Never truncate an address into a different target. Drop invalid records or leave them inert; do not invalidate the session. Do not store or export addresses outside the current guest reading.

Resolve the **selected plan’s recorded owner session** from the existing ready workspace coverage and verified matching source, as for source-qualified session details. Use neither a pinned/visible chat nor a contributor as a fallback. An ambiguous match, unverified/foreign source, missing session, pending reload or retired snapshot is not a basis for a chip. A link-only host update can add, replace or remove the chips without a progress revision. No new subscription, service read, timer or cache is needed.

## Presentation and opening

Use the existing `ProgressShell` header metadata area on board and rail to make the links visible without opening a panel. Do not add a rail location row. Keep the host attribution short and visible, distinguish individual destinations accessibly, and let the controls reflow at narrow widths. A long title may be shortened visually; its admitted literal label remains accessible. Use the existing more-links qualification compactly when the adapter knows there are additional links. Keep the expanded Sessions list’s per-participant text, including child-only links; do not make those links look like the main session’s. Work Status and list rows do not get these controls.

An explicit pointer or keyboard activation sends the admitted address through `host.openUrl`, which owns the destination and routing. Never set a navigable guest `href`, interpret title markup, fetch a preview, call `window.open` or fall back to another opener. A host refusal uses short localized, non-sensitive feedback like the existing document link failure, not a persistent notice or automatic retry.

## Compatibility and rollback

Missing optional data is the ordinary no-chip view on a supported host. No install-floor, grant, service, protocol, schema, migration or captured-data change; mixed guest/service versions need no negotiation. Reverting these guest changes restores text-only Sessions details without unlinking resources or touching progress or host data.
