# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). Package versions are independent of the frozen protocol/schema version (currently 2). GitHub Releases additionally carry the native per-release change lists.

## [Unreleased]

## [0.6.0] - 2026-10-31

### Added

- Durable sub-agent run records: the companion keeps a bounded record of each sub-agent dispatch (parent, child, agent type, dispatch description and times) and takes each run's outcome from host execution events — succeeded, failed with an error type, or interrupted with a reason — including background sub-agents that finish after their call returns. Prompts, outputs and transcripts are never stored (#31).
- Automatic plan association for sub-agents dispatched by a session with exactly one open plan, or by a delegation that names the plan. Association never assigns tasks or grants reporting authority (#31).
- An optional `handoff` report action that lets a sub-agent leave one short line and a claimed outcome (done, partial or blocked), shown as a claim rather than as task progress (#31).
- One-time, metadata-only history recovery for sub-agents that finished before capture, with a bounded automatic retry and a manual Retry history action (#31).
- Authenticated, side-effect-free `GET /v1/subagent-runs` and `POST /v1/subagent-runs/reconcile` service endpoints (#31).

### Changed

- The sub-agent section in the rail, Work Status and page now shows three separate layers per sub-agent — Ran (host fact), Claimed (the sub-agent's report) and Accepted (the plan's reported task status) — so a finished run is never presented as a completed task (#31).
- Only running, waiting-on-you and task-linked sub-agents are listed individually; the rest are summarised as counts with an expandable, pageable history, replacing the 128-row list and its routine incomplete-list warning (#31).
- Sub-agent times now come from recorded activity rather than the moment the view refreshed (#31).
- The sub-agent section is hidden entirely when no plan is in scope, including inside child sessions (#31).
- `delegate` now records a durable intent for the session's next sub-agent dispatch instead of a five-minute in-memory declaration; explicit `link` is unchanged (#31).
- Passive capture now covers sub-agent run state only; task progress still changes only through explicit reports (#31).

### Fixed

- Sub-agents that had finished showed as "Idle" and then "Unknown now", and genuinely running sub-agents decayed to unknown after about a minute; running sub-agents now stay Running until host evidence changes them (#31).
- The Work Status card could stay collapsed when the host dropped a height request; it now re-sends its height a bounded number of times (#31).

## [0.5.0] - 2026-10-30

### Added

- A Needs-you view that surfaces reported blockers and plan-specific items needing attention (#22).
- A bounded progress resume pointer delivered after session compaction, so plan state can be recovered without re-deriving it from history (#23).
- Native sub-agent activity display, with observed sub-agents shown and declared delegations bound to verified child sessions (#24).
- Explicit milestone reporting guidance on every guidance surface — including the report tool description, the only surface description-only (MCP) clients see — stating that tracker updates are not progress reports and naming PLAN_READY handoff, review approval, owner approval and actual work start as reporting boundaries; a delegated child's canonical plan write now also reminds its verified direct parent (#27).
- Conditional, fail-closed advisory hints when a dispatch or a tracker update is observed, coalesced into a single reminder per context (#28).

### Fixed

- Progress resume pointer delivery on OpenCode 2.2.2 hosts: compaction events are correlated independently of delivery ordering, restoring the pointer after real compactions (#25).
- Native verification truthfulness on current hosts: the builtin harness waits for assignment readiness before snapshotting and interacts only with genuinely actionable elements (#26).

### Development

- The native test host was re-pinned from OpenCode 2.1.4 (no longer obtainable from any public source) to 2.2.2, with archive provenance and mutability caveats recorded; the full validation aggregate now runs against the current host (#27).

## [0.4.0] - 2026-10-28

### Added

- Previewable progress updates and handoff summaries with explicit copy, privacy controls and freshness checks (#11).
- Since-last-reviewed plan change digests in the board History tab, with bounded revision reads and explicit review points (#12).
- Plan and task search across recorded history, with filters, reusable local views and results beyond the loaded plan list (#13).
- Comparison of two recorded document captures, with pinned selections, literal Unicode and line-ending diffs, bounded reads and deletion protections (#18).
- Optional reporting-health diagnostics in the board footer: compact status rows, expandable explanations and a previewable support summary that excludes private context (#19).

### Fixed

- Review-point identity uses integration-account terminology while retaining existing stored keys (#14).
- Active search refreshes capture state even when plan revisions do not change, keeping warnings and cached summaries current (#16).
- An expanded document-comparison disclosure no longer prevents background updates; pending comparison reads retire before navigation and after authoritative deletion (#18).

### Documentation

- Added regression coverage for unsupported change-item fields and clarified compact versus paged report reads (#10).
- Added the Agent Progress logo and themed README header (#15).
- Current installation and development guidance follows the selected manifest version and is separated from historical compatibility evidence (#17).
- Documented capture-comparison and reporting-health behavior, privacy boundaries and validation limits (#18, #19).

## [0.3.0] - 2026-10-27

### Added

- **Task readiness view with dependency explanations** (#7): active plans now have a Readiness section in the plan detail (session rail and fullscreen board Progress tab) grouping task items into Ready to start, Waiting on prerequisites (with a distinct skipped-prerequisite subgroup) and Blocked. Every recorded prerequisite is listed with its title and reported status, and selecting one reveals and focuses that task in the same plan; assignment labels come only from the recorded assignee. The section states that it is based on recorded prerequisites only; empty, partial, error and stale states stay distinct.
- **Focus controls for large plan hierarchies** (#9): the task view gains reading controls — Show all / Unfinished filtering with ancestors kept and labelled for context, a participant filter that distinguishes explicit assignment, links, direct reports and parent relay (the matching reason is shown on each row), Expand all / Collapse all, and Jump to in progress / Jump to blocked. Plan totals, Now and Readiness always cover the whole plan while the summary labels matching, context and hidden counts separately. The reading state (collapsed groups, focus, scroll) is scoped per view, never persisted, and survives new revisions. Navigation only — nothing changes status, assignment or readiness.

### Fixed

- Session chips in narrow sidebars (around 280 px) no longer squeeze the session name to a few characters: the state text can now wrap below the name, and a name that still cannot fit truncates with an ellipsis. Wide layouts are unchanged (#8).
- Paged plan-detail reads refuse a page from a different store, binding or plan instead of joining it; a malformed `dependencies` value refuses the reply instead of reading as "none recorded"; and a failed detail read keeps a stable error and is retried once per list refresh or on a new revision instead of being re-requested on every repaint (#7).
- A detail reply carrying a newer revision than the plan list no longer triggers a full re-read on every repaint (previously tens of thousands of requests in seconds, including from a hidden frame); host session names are shown only for plans of the verified bound source; tasks with subtasks now show their assignee and relay attribution in the summary; and a plan whose tasks were all removed is no longer treated as still loading (#9).

### Documentation

- Guides are self-contained for outside contributors: internal workflow references were removed, durable contracts (system boundaries, reporting participation, session-move/rebinding and capture-freshness rules) were consolidated into the tracked guides, and stale statements were corrected to match shipped behavior (#6).

## [0.2.9] - 2026-10-27

### Added

- Compact plan picker with management of finished plans (#4).
- Sidebar progress scoped to the selected session (#5).

## [0.2.8] - 2026-10-26

### Fixed

- Native Windows progress capture support, retained-source reinstallation, and clearer progress invocation and working-plan selection (#3).

## [0.2.7] - 2026-10-26

### Fixed

- External worktree project ownership: live grouping and coverage of external worktrees (#2).

## [0.2.6] - 2026-10-26

### Added

- First automated release from `main`: update awareness, live progress cues and proactive reporting (#1).

## 0.2.5 and earlier

Baseline before automated releases; see the repository history.

[Unreleased]: https://github.com/Phototonic/openchamber-progress/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.9...v0.3.0
[0.2.9]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/Phototonic/openchamber-progress/commits/v0.2.6
