# Agent Progress 1.5.0: Simple by default

## Why

The rail, board and Work Status answer three questions: what the agents are doing, how far along they are, and whether anything needs the person. Today those answers sit under coverage notices, diagnostic panels, repeated disclaimers and internal vocabulary. Needs you lists every plan in the OpenCode install, shows a full card per task, offers no way to act and includes blockers that sub-agents addressed to their own parent. Closed plans pile up because archiving is one plan at a time.

None of this helps when no plan is recorded. A coordinator ran a complete planned workflow, with a planner, a spec change, a review and three parallel implementation lanes, and mirrored nothing until asked. Its model provider rebuilds the system prompt and forwards only the parts it recognises, so the companion's guidance section and every hint were dropped before the model saw them. The plan was written as spec-change files and in a sibling worktree, which the plan hint does not recognise. The one sentence saying when to report sits in the middle of a tool description of about 5,000 characters that is mostly prohibitions.

## What Changes

- Make the dependency map the main component of a plan on the rail and board: title and progress bar directly above it, one Map | List switch, one help-and-filters control, and an opening view that shows the whole plan when it stays readable and current work otherwise.
- Make Needs you compact and scoped. It defaults to the current session's plans (board: the selected plan) with all plans as the secondary scope, collapses to one line, lists one line per item, and shows the agent's reason and request only when an item is opened.
- Add two Needs you actions, Open session and Copy reply. Resolution stays reported state only.
- **BREAKING (visible behaviour):** only a plan's main session can put a task in Needs you. A blocker reported by a sub-agent stays on its task as a blocked task and is no longer listed or counted as needing the person.
- Add Tidy: archive a session's or board's finished and cancelled plans in one confirmed, undoable action through the existing archive and restore routes, and hide a Needs you item on this device until its reported state changes.
- Replace the Partial cue and every coverage notice with one calm, dismissible "counts may be incomplete" indicator. Counts that may be low carry `+`.
- Reduce Work Status to a title, a bar with done/total, one activity line, a stale time only when stale, and Open progress.
- Move Details, Reporting health, Language, Setup, Plan document, History and Sessions behind one More menu. Remove advanced-only controls from the default UI. Presentation only: no service data or route is removed.
- Remember three view states per device: hidden Needs you items, Needs you collapsed or expanded, and the dismissed incomplete-count note.
- Rewrite visible text in plain language across all surfaces, including Setup presented as four grouped steps, in English, Russian and Simplified Chinese together.
- Make agents mirror plans without custom instructions. Every guidance surface opens with one short checklist of when to report, with prohibitions after it, and the tool description gets shorter. Hints also travel as a short fixed note on the result of the observed dispatch or plan write, so they reach the model under providers that drop plugin system text. The plan hint recognises spec-change task lists and proposals, and plan files written in another worktree of the same project. Hints stay advisory: nothing is reported, assigned or inferred.

## Capabilities

### New Capabilities

- `progress-surface-hierarchy`: reading order of rail and board, the single More menu and its panels, what leaves the default UI, and the compact Work Status card.
- `dependency-map-view-controls`: map opening view, the single help-and-filters control, the reduced toolbar and preserved navigation.
- `incomplete-count-indicator`: one neutral indicator and `+` counts in place of coverage notices.
- `closed-plan-tidy`: confirmed, undoable bulk archive of finished and cancelled plans.
- `device-remembered-view-state`: the three view states saved per device and their limits.
- `plan-mirroring-guidance`: the reporting checklist, its delivery without custom instructions or forwarded system text, plan document recognition, and the limits that keep hints advisory.

### Modified Capabilities

- `needs-you-inbox`: main-session-only membership, default scope, compact presentation, bounded automatic continuation, Open session and Copy reply, hide per device.
- `dependency-map-arrow-state`: arrow help and the waiting-task summary move to the new controls and plain wording.
- `subagent-loss-notices`: recording gaps fold into the incomplete-count indicator instead of the Partial badge.
- `interface-localization`: the language choice moves into the More menu; plain-language copy rules for three languages.
- `phone-progress-surfaces`: the new surfaces at phone width.
- `windows-setup-responsiveness`: fresh setup presented as grouped plain-language steps.
- `session-progress-context`: the plan picker shows position instead of a chosen/automatic note.

## Impact

Affected owners: the Needs you read projection and plan summary (one additive fact), the shared UI controller, adapter and model, the inbox, census, cleanup, reporting-health, setup and dependency-map views, the three surface entries, the interface catalogs, companion guidance text, browser fixtures and QA drivers, and every tracked guest and backend output those sources build. `docs/ui.md` and `docs/contracts.md` change with each behaviour; `docs/setup.md`, `docs/backend.md` and `docs/compatibility.md` change where they describe the affected presentation or read. Protocol and schema stay at 2. No store migration, new table, new route, new permission, host floor change or SDK change.

Plan mirroring guidance touches the companion only: the advisory activation hooks, the report tool description, the skill and its listing line, their tests and native driver, the tracked companion output, and the activation and active-tool sections of `docs/contracts.md` and `docs/backend.md`, plus `docs/compatibility.md` for the provider finding. The report tool's input, validation, authority and replies do not change.

## IN / OUT / Must NOT have

IN: the capabilities above; English, Russian and Simplified Chinese together; keyboard and screen-reader behaviour; 390 px rendered checks; documentation and regenerated outputs in the same pull request as each behaviour.

OUT: inserting a reply into another session's message box or any "open with draft" host capability; bulk archive of failed plans; bulk or automatic deletion; any per-task review, acceptance or "resolved" control; notifications; new polling loops; a redesign of the task list beyond the removals listed; regrouping of legacy migration steps; release preparation and promotion to the distribution branch. For plan mirroring guidance: automatic reports or automatic plan creation; reading plan files, spec files or repository metadata; observing shell-written files; a check of whether a plan is already mirrored; changes to any model provider or to the host; messages inserted into a session; per-provider special cases.

The release MUST NOT send a report, start a plan or link a task on an agent's behalf, manufacture a plan file, alter the original output of a call a note is added to, or require any instruction file, skill or prompt outside the companion for mirroring to happen. It MUST NOT infer completion or resolution, present a possibly incomplete count as exact, hide a failed read behind the calm indicator, drop a reported blocker from view, rewrite or migrate stored blockers, delete plans from a bulk action, store the three view states anywhere but device storage, remove a diagnostic fact without leaving it reachable from Troubleshooting or the support summary, or weaken Setup's consent binding, capture honesty or pause semantics.
