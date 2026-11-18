# Design

## 1. Existing owners and constraints

- **Blocker provenance is already recorded.** Every valid blocker annotation carries the session that reported the current details, the session they are attributed to and the mode (`direct` or `parent-relay`). A sub-agent reporting its own assigned task, alone or with its final handoff, is recorded as a direct report by that sub-agent. A main session reporting for a sub-agent is recorded as a relay whose reporter is the main session. A status-only report keeps the provenance of whoever wrote the details.
- **The store records each reporting session's identity**, including its parent session or the absence of one, whenever that session commits a report. A plan's main session is the session that started it, so its record always exists after the plan's first report.
- **Needs you rows carry these facts today**: the plan's main session and the whole annotation. The 1.4.x guest adapter rejects a reply whose row group disagrees with its category, so the wire grouping cannot change meaning under the same capability revision.
- **The inbox read is bounded and source-wide.** Each window admits a fixed number of plan slots and rows, counts are cumulative through its cursor, and continuation is explicit today. Refresh reuses the frame's one list read; there is no inbox timer.
- **Guests can open a session through the host but cannot write into another session's message box.** Surface opening carries no payload.
- **Device storage exists** behind a host feature flag and is partitioned by browser profile, runtime, extension and installation. It holds the language choice and History review points. Every other reading state is frame-local.
- **The support summary is a fixed list of ten enumerated observations.** It holds no plan identifiers, coverage reasons or limits. The diagnostic fields of today's Details disclosure are not in it.
- **Cleanup is per plan**: archive, restore and delete accept one plan bound to its revision and cleanup generation, with a replayable receipt. Finished, cancelled and failed plans are eligible.
- **Setup runs eight resumable fresh steps** in a frozen order, fewer when a retained store or source is reused, and nine migration steps with removal batches. The guests have no log sink.
- **Map geometry is fixed**: 220 × 100 px cards, 70 px column gap, 25 px row gap, 28 px world padding. Initial framing today frames working and ready cards and falls back to one card at 75% (100% on a coarse pointer). Arrow motion stops below 50% zoom.
- **The host clamps the Work Status section** to at most 480 px high.

## 2. Needs you membership: main session only

**Rule.** A blocked task is a Needs you item only when all of the following hold:

1. its current blocker details are valid and their category is decision or review (unchanged);
2. the session that reported those details is the plan's main session;
3. the plan's main session is recorded as a top-level session, with no parent session.

Condition 2 excludes a sub-agent's direct report on its assigned task, including one committed with its handoff. Condition 3 excludes a plan that a sub-agent started for its own work, where the sub-agent is that plan's main session and typically addresses its blocker to its parent. A relay made by a top-level main session satisfies both: the main session chose to report it. If a sub-agent later replaces details the main session wrote, the task leaves Needs you; if the main session reports them again, it returns. When the main session's record is missing or its parent status cannot be read, the task is not a Needs you item. Membership needs positive evidence, and the task stays visible as blocked either way.

**Nothing is lost.** A task that fails conditions 2 or 3 stays a blocked task. Its category, reason, next step and waiting time remain on its row in List, on its card and selected-task summary in Map, and it is counted in the quiet "more blocked on other work" figure. It is never labelled or counted as needing the person, on any surface. Sub-agent sessions the host reports as waiting on a question or permission remain a separate fact on the sub-agents line.

**Stored data.** No stored blocker is rewritten, migrated or deleted. The rule is evaluated at read time from recorded facts, so blockers that sub-agents reported before the upgrade are reclassified on the first read after it, and a rollback restores the earlier classification with no data step.

**Where the rule lives.** One pure shared predicate takes the category class, the reporting session, the plan's main session and the main session's top-level fact. The inbox model, the per-plan list and the map all call it; no surface re-derives membership its own way.

**Wire.** The service adds one optional, response-only fact to each inbox row and each plan summary: whether the plan's main session is recorded as top-level, as a sub-agent, or unknown. It is one keyed lookup per plan. The capability stays at revision 1 and the existing row group keeps its category-only meaning, so its counts are no longer the person-facing figure. Guests count membership from the rows they hold, which already equal the cumulative counts through the cursor.

Alternatives rejected: regrouping on the wire under revision 1 (1.4.x guests refuse the reply); a revision bump (the inbox becomes unavailable in both mixed directions for a rule that needs one extra fact); deriving the top-level fact from the host's live session list (incomplete across projects and absent for ended sessions).

**Mixed versions.** A 1.4.x guest on the new service ignores the extra fact and behaves as before. A new guest on an older service receives rows without the fact and reports Needs you as unavailable with the existing update-together wording. It never classifies without the fact and never shows an empty result.

**Guidance.** The companion guidance gains one statement: decision and review blockers reach the person's Needs you list only when the plan's top-level main session reports them, and a sub-agent that needs the person says so to its parent. Guidance stays advisory. No tool input, validation or authority changes.

## 3. Needs you scope, counts and continuation

- **One read, three scopes.** Guests keep reading the source-wide inbox and partition its rows on the client. Rail and Work Status: the plans in the frame's existing session-scoped list, including plans the session helps with. Board: the selected plan. All plans: every row. The count for other plans, needed for the quiet link when the current scope has none, comes from the same rows. A service-side scope filter was rejected: it adds a route parameter and a second read path for data the frame already holds.
- **Never widen silently.** When the default scope has nothing, the list stays in that scope and shows a link naming how many items wait in other plans.
- **Exact or `+`.** A count is exact only when the latest completed traversal covered every eligible plan without a gap, and, for a session scope, the session's plan list is itself complete. Otherwise it reads `N+`. A completed traversal keeps its exact count while its windows are being re-read unchanged; it loses exactness when a re-read differs, fails or is retired. This replaces the 1.4.0 behaviour of withdrawing count authority during every recheck, which would leave a multi-window store permanently qualified. The contract already describes multi-window results as observations rather than a snapshot.
- **Automatic continuation within existing bounds.** While the inbox is incomplete and the frame is visible, each successful ordinary refresh may request at most one further window, with the existing per-window limits, up to eight automatic windows per traversal (512 plan slots, matching the 500-plan list ceiling). Beyond that the indicator offers Load more, one window per activation. Hidden frames request nothing. No timer, retry loop or per-task read is added, and a frame still sends at most one inbox request per refresh cycle. Work Status continues the same way without waiting times.
- **States.** Unavailable, unverified and failed reads keep their own plain line and are never shown as nothing waiting. Rechecking, restart and continuation states are no longer sentences; a busy mark on the count covers loading.

## 4. Needs you actions and hide

- **Open in place.** Selecting a row opens it inside the list: title, plan, kind, waiting time, the agent's reason and request quoted literally, and the actions. One row is open at a time; Escape closes it and returns focus to the row. The separate "Opened from Needs you" plan reading is removed. Where the row's plan is the one shown, its task is also selected on the map or revealed in the list.
- **Open session** asks the host to open the plan's main session. Under the membership rule that session is the one that asked. It is offered only when the existing open gate holds (verified bound source and a host-listed session); otherwise it is absent and one plain line says why. It never sends or drafts a message.
- **Copy reply** copies a short reply frame naming the task and plan, in the interface language around the agent's literal titles, followed by an empty line. It confirms only after the clipboard accepts and falls back to selectable text. Insert-into-composer is not built: the host exposes no such capability to another session's frame.
- **Neither action resolves anything.** A row leaves only when a later report changes the task.
- **Hide.** Hiding is stored per device against the row's identity: store, source, plan, task and the revision at which its current details were reported. A new report of that task's details changes the last part, so the item returns by itself; an unrelated report on the same plan does not unhide it. Hidden items are excluded from the count on every surface of that device, and their number stays visible in the expanded list and the More menu, where they can be shown and unhidden.

## 5. Device-remembered view state

Exactly three states are saved, each as a small versioned record in device storage:

| State | Identity | Bound |
|---|---|---|
| Hidden Needs you items | store, source, plan, task, details revision | at most 200 entries; stale entries pruned after a complete traversal; the oldest dropped at the cap (an item then shows again) |
| Needs you collapsed or expanded | surface kind (rail or board) | one value each; absent means collapsed on the rail and expanded on the board |
| Dismissed incomplete-count note | surface kind, store and the set of active reasons, including the latest recording-gap detection | one record per surface kind |

Rules follow the language preference's precedent: requests only when the host advertises device storage, never instance or server storage, no browser-storage fallback, malformed records treated as read failures and never repaired, and a write confirmed only on success. On a host without device storage, collapse and dismissal last for the frame only and Hide is not offered, because its label promises persistence. Every other disclosure, filter, zoom and selection stays unstored. Other open frames converge on their next existing refresh; there is no cross-frame channel.

## 6. Surface hierarchy, More menu and diagnostics

- **Order.** Rail and narrow board: header, progress, Map or List, Needs you, sub-agents, incomplete-count indicator. Wide board: plan list on the left and the same order on the right. The default-view rule is unchanged (Map when complete detail records a task-to-task prerequisite, List otherwise); a frame narrower than 320 px defaults to List with Map still selectable.
- **One More menu** replaces the plan-actions menu, the footer disclosures and the board's Document and History tabs. Groups, in order: copy actions; Plan document, History (board), Sessions; archive actions and hidden items; Language, Setup, Troubleshooting; Delete for a closed plan. Only applicable entries show. Document, History, Sessions, Setup and Troubleshooting open as a panel in place of the map or list, with Back returning focus to More. The settings group is present in every rail and board state, including no plan, not set up and a failed read, because the language choice must stay reachable there.
- **History dot.** The More button shows a dot when this device's saved review point for the selected plan is older than the plan's current revision. It needs no digest read; without a review point or without device storage there is no dot.
- **Removed from the default UI:** task view options, the participant filter, the order toggle, expand/collapse all, per-task copy, the pinned "opened from" reading, the map's duplicate heading and count line, the pan buttons, the Partial cue, the sub-agent explainer, scope sentences, and the plan-chosen note. Show all / Unfinished remains inside the help-and-filters control.
- **Nothing diagnostic is dropped.** Every field of today's Details disclosure and the seven reporting-health observations move to Troubleshooting → Advanced details. Facts that lose their visible notice (active incomplete-count reasons, this build's limits, record totals, run sources, the map's update number) are listed there too.
- **Support summary.** Its existing lines keep their text, order and values. Fixed-vocabulary lines are appended for the active incomplete-count reasons and this build's numeric limits. They contain no plan text, identifiers or paths, and are identical across interface languages. This deliberately departs from the design note that the summary's bytes stay the same: that note assumed the removed facts were already in it. The guests have no log sink, so the summary and Advanced details are the only places these facts remain.
- **No service data or route is removed.** Detail, document, history, digest, health and run reads are untouched.

## 7. Map opening view and controls

**Opening rule.** Once per reading: compute the scale that fits the whole plan. At 70% or more, show the whole plan. Otherwise open at 80% on current work: in-progress and Needs you cards with their direct neighbours when that group fits the frame, else the first such card in stored order (in progress, then Needs you, then ready). With no current work, including closed plans, fit the whole plan. Fit always shows the whole plan. A coarse pointer keeps the existing full-size opening zoom, the accepted phone rule; this is the one departure from the design's single 80% figure.

**Threshold check against shipped geometry.** World width is 290 px per column minus 14; world height is 125 px per row plus 31.

| Canvas | Columns that fit at ≥ 70% | Example below the threshold |
|---|---|---|
| Rail, about 330 px usable | 1 | 2 columns → 58%, 5 → 23% |
| Rail, about 570 px usable | 2 | 3 columns → 67% |
| Board at 1280 px, about 930 px | 4 | 5 columns → 65% |
| Board at 1920 px, 1478 px | 7 | 8 columns → 64% |

A 300 px rail frame fits three rows at 74% and four at 56%. So every plan with an arrow opens on current work in a standard rail, which is the intent, and the board fits typical plans whole. The 100-task and 980-task reference plans always take the current-work branch. At 70% a title renders near 8.8 px and at 80% near 10 px. The board mockup's five-column plan shown whole at 1280 px needs 65% with shipped geometry, so it opens on current work unless the threshold moves. The threshold may be raised to the shipped 75% if rendered checks find 70% illegible; lowering it or changing card geometry needs a design amendment.

**Controls.** Map | List on the left; zoom out, zoom in, Fit and one help-and-filters control on the right. The control holds the map key, the arrow key, Show all / Unfinished, Group and the shown-task count. An active filter marks the control and adds a line with Clear. The zoom percentage appears briefly after a zoom. Drag, wheel, pinch and every existing key are unchanged; only the pan buttons and Focus current work leave, since current work is the opening view. The frame shrinks to its content up to 300 px on the rail and 64% of the viewport height on the board. The selected-task summary becomes a compact popover: title, state, what it waits on, what it unlocks, its blocker text and the running sub-agent with Open session. Report authorship moves to Advanced details. Arrow rules, motion gates and cost bounds are unchanged.

## 8. Incomplete-count indicator

One neutral line per rail and board, last in the content, shown only while some count may be low. It expands to one more sentence and Load more when more can be loaded. Dismissal is remembered per device until the set of reasons changes. Counts keep their `+` whether or not it is dismissed. Work Status has no indicator line; its counts carry `+`.

It replaces the Partial cue, partial history, host truncation, traversal limit, host gaps, "more not checked", partially checked plans, older plans not loaded, the map coverage note and the recording-gap notice. It never replaces a failed read, recording off, or a plan from another OpenCode install; those change what the person can do and keep their own line.

**Recording gaps** keep their service-owned attention, 24-hour window and store-wide acknowledgement. A gap that needs attention is a reason of its own, keyed by its detection, so it brings a dismissed indicator back. While it is shown the expanded text names it, and dismissing sends the existing acknowledgement. A refused or failed acknowledgement leaves the indicator in place and says so. The indicator is neutral in tone; the warning-tone badge is retired.

## 9. Tidy: bulk archive

The entry lists the closed plans the surface already shows: the selected session's on the rail, the current list's on the board. Eligible plans are those the per-plan Archive action accepts, limited to finished and cancelled; failed plans are never included and one line says they are kept. The entry's label and confirmation name what is covered and never say "closed" for a set that excludes failed plans.

Confirmation is inline, names every plan with its outcome and the count, gives Cancel initial focus, never archives on Enter and sends nothing until confirmed. Archiving then runs one existing archive request per plan, in sequence, each bound to the revision and cleanup generation captured at confirmation. A plan that changed is skipped and reported, never retried blindly. At most 50 plans run per confirmation; a larger set says how many of the total it covers. A context change stops further requests. Lists are invalidated once at the end.

The result line names how many were archived and offers Undo until the next action or refresh. Undo restores each plan this action archived through the existing restore route, bound to the generation its archive receipt returned, and reports any it could not restore. Lifecycle, counts and history never change, and no bulk path can delete. No service change: without the cleanup capability the entry is absent.

## 10. Work Status

At most five lines: title with a position picker (Automatic first), bar with done/total, one activity line, one qualification line, Open progress. The activity line shows running sub-agents, sub-agents waiting for the person and this session's Needs you count, each only when nonzero, or the plan's closing word. The qualification line shows the age of the last report only for an active plan whose last report is over an hour old, or that recording is off; a failed read keeps its own undismissable line. State chips, focus rows, the roster, "more plans" and the Now line are removed. The card stays within the host's 480 px section limit at 190 px in all three languages. Selecting the Needs you count opens the rail; with no opening payload it cannot force the list open, so the rail shows it in its saved state.

## 11. Setup presentation

Fresh setup shows up to four groups derived from the operation's own frozen plan:

| Group | Internal steps |
|---|---|
| Create a private progress folder | prepare, store-directory, create-store |
| Connect it to OpenCode | expectation, register-source, publish-binding |
| Turn on recording | enable |
| Check that it works | reconcile |

Each internal step belongs to exactly one group and the groups are contiguous in the frozen order, so every pause or resume point lies in one group. A group with no step in the plan is not shown, and the total counts only shown groups. A retained store uses a truthful label for its first group. A group is complete only when all its steps are durably complete; a pause inside a group shows it as paused. Internal step names, reviewed paths and facts sit in one disclosure and in failure diagnostics.

Consent stays an explicit acknowledgement bound to the same reviewed facts. While setup runs, recording state is one plain line rather than a warning box; on pause, failure, close and completion with recording still off, the conspicuous state and recovery action stay. Migration keeps its own step sequence with plain wording, because its pause points around turning recording off are safety facts. The step engine, journal, routes and budgets are untouched.

## 12. Copy

One sentence per notice. A caveat appears once per surface or as `+` on the number it qualifies. Buttons start with a verb. Agent-written text is quoted and never translated. The words listed as internal in the copy guide (source, store, revision, coverage, binding, capture, reported, contribution, companion, observation and their variants) do not appear in default visible text or accessible names; they remain allowed in Advanced details, the support summary and Setup's disclosure. The three catalogs change together and keep their established product terms. Strings are built whole with plural rules, never by concatenating fragments around a number.

## 13. Delivery, verification and rollback

Each feature ships as its own pull request with its documentation, three-language copy and regenerated outputs, and passes portable CI alone. The membership rule and its wire fact land first, because every count depends on them. The surface shell lands before the features that mount into it. Shared catalogs and generated bundles are regenerated after each rebase, never merged by hand. Once building outputs at promotion (section 15) has merged, pull requests carry no generated outputs: a rebased pull request drops its bundle changes instead of regenerating them, and builds locally only to run its checks.

Feature checks use source-built disposable guests and real browser interaction with screenshots at 390 px and a desktop width, in three languages where copy changes, with keyboard and accessibility-tree assertions. They are synthetic-host evidence, not physical-phone or native-host acceptance. Service checks use real authenticated requests against a disposable store. Guidance text gets a semantic read, not a phrase search.

Rollback is by reverting pull requests in reverse order. No store format, schema or journal changes, so nothing is migrated in either direction. Device-stored view records are ignored by older guests and may be left in place. The additive read fact is ignored by older guests.

## 14. Plan mirroring guidance

**What was found.**

- The host runs the companion's context hook for every provider, with the host's own tool names, and its outgoing request carries the companion's section and the full tool descriptions. The existing native checks with a scripted provider show this.
- The Claude Code provider plugin (`@openchamber/opencode-claude`, inspected at 1.7.0) receives that request through a local proxy and lets Claude Code bring its own system prompt. It appends only the parts of the host prompt it recognises by their shape: a custom agent's prompt, the Code Mode catalog, MCP server notes, the skills list, instruction-file blocks and host session-context blocks. All other system text is discarded, a plugin's section included. It renames tools to `mcp__<host>__<name>` after the hook has run and forwards their descriptions and results. It raises Claude Code's description cut to 8,192 characters unless the user set one; Claude Code's own cut has been 2,048 and later 4,096.
- So under that provider the section and every hint are lost, while the tool description, the skills list and tool results arrive. The hook's effective-tool check is not the cause.
- The pinned plugin API gives a plugin no per-session instruction entry. Its post-execute hook may replace a completed call's result.
- Plan recognition is lexical and confined to the writer's own directory, and a parent is flagged only when it shares that directory. The hook tests forbid reading project files, and that stays.

**Decisions.**

1. **One checklist, first, on every surface.** Four steps in the agent's order of work: start when the plan is ready, with real tasks and prerequisites; declare or link before dispatch; mark work start; finish explicitly. The tool description, the context section, the inline and packaged skill and the skill's listing line all open with it. Prohibitions follow, stated once each.
2. **A description that survives a cut.** The checklist and one valid start example with a prerequisite sit inside the first 2,048 characters, the smallest cut recorded for a supported client. The whole description is at most 4,096 characters. Delegation, staging, handoff and blocker detail move to the skill, which the description names. These two numbers are checked by a test because clients truncate this field mechanically; wording is checked by reading.
3. **A second carrier for hints: the observed call's result.** When a dispatch, plan write or tracker update qualifies under the existing metadata rules, and the session's latest context showed the report tool as effective, a fixed note of one or two sentences is appended to that call's result. The note is chosen by observation kind, names the report tool in a way that reads correctly under a host prefix, and repeats the hint's condition. At most one note is added per session per model step. The context section and its hint are unchanged, so providers that forward both show the advice twice in one request; the wording already says a repeated hint is no reason to report again. Cadence matches today's hint: one per step that had a qualifying call.
4. **Parent relay on the same carrier.** A child's plan write still flags its verified direct parent. The parent's note is added to the result of the parent's next observed dispatch, plan write or tracker update. For a dispatch the parent was waiting on, that is the result returning the planner, which is the moment a ready plan is handed over. The existing bounds on pending recipients and recent calls apply; no new queue is added.
5. **Recognise spec-change files.** `tasks.md` and `proposal.md` directly inside one folder under `openspec/changes/` count as plan documents. Deeper paths, including the archive, do not.
6. **Recognise sibling worktrees from host facts.** A plan-shaped path outside the writer's directory is accepted only when it lies inside a directory the host lists as the root or a worktree of the writer's own project. The host's worktree list is asked once, and only after the path already has a plan shape. Any failure or absence means no hint. The parent relay accepts a parent in the same project whose directory is another host-listed worktree of it. The companion still reads no file.
7. **Honesty rules are unchanged.** No carrier reports, starts, assigns, links or infers. Notes are fixed text with no path, title, prompt or output. Hook execution still performs no plan lookup, document read or store write, so a note cannot say whether a plan is already mirrored; it stays conditional.

**Alternatives rejected.**

- Shaping the section like the host's instruction or session-context blocks so the provider's patterns keep it: it imitates host-owned content and depends on another project's private parsing.
- Putting the hint into the per-request tool description: it invalidates the prompt cache for the whole conversation twice per hint.
- Appending to the user's message or inserting a synthetic session message: both change the conversation and are presented to the model as coming from the person.
- Branching on the provider's identifier: one more provider with the same design would repeat the failure.
- Looking up whether the session already has a plan, to stay silent when it does: it puts a store read on the tool path and ends the no-lookup rule that keeps hints observational. It can be added later behind the same note if repeated notes prove noisy.
- Dropping the section's hint in favour of the note alone: the section is proven on the native host and still covers a parent that makes no further observed call.
- Observing shell commands: their success, paths and partial writes cannot be qualified from metadata.

**Failure modes.**

- The host may ignore a replaced result, or adding text may hide a result that had structured output only. This is checked first on the native host for each kind of call, by comparing what the scripted provider receives with and without the note. A kind whose original output cannot be preserved gets no note. If no kind can carry one, the note carrier does not ship and this design is amended; no other carrier is substituted.
- A call made inside Code Mode returns its result to a script, not to the model. Unless the native check shows such a call can be told apart and its note reaches the model without changing what the script receives, it gets no note.
- Run recording reads the dispatch's structured result in its own post-execute observer. The note must not alter those fields, and the result must be the same whichever observer runs first.
- With no context seen since the companion loaded, eligibility is unknown and no note is added; the section path still applies.
- A slow or failing worktree list delays only the hint, never the tool, and yields no hint.
- A user-set description limit below 2,048 can still cut the checklist; the skill listing line and the notes remain.
- Delivery is not compliance. The contract still says guidance does not guarantee reporting.

**Mixed versions and rollback.** Only text and hook behaviour change: no store, schema, protocol, route, permission or tool-input change. New guidance bytes change the activation fingerprint, so an updated install reads as needing a reload until the host loads it, as for any companion update. Rollback is a revert; nothing is persisted.

**Verification.** The production plugin runs through the installed adapter against a provider view that keeps only what a system-dropping provider forwards: tool definitions under prefixed names, tool results and messages. The native scripted-provider check covers real dispatch and write results. The guidance text is judged by a recorded read of what an agent holding only the companion's text would do at each step of the reported workflow, not by phrase search.

## 15. Built outputs at promotion

**What was found.**

- Nine generated outputs are tracked: `build/service/main.js`, `build/setup/main.js`, `build/companion/{index.js,package.json,SKILL.md}`, `background/main.js` and `ui/{panel,status,page}/main.js`. All nine are written by the build. The backend build compiles three entries, copies the skill from its source file and writes the companion manifest from the release constant; the guest bundler writes the other four. None is hand-authored.
- Each guest bundle is one minified file over all shared interface source, so two pull requests that touch that source always conflict in it.
- Portable checks hash the committed outputs, run every test, rebuild, and require equal hashes. Tests therefore read committed bytes before any build. The same comparison passes on the pinned Node, on the newest Node 24 and against outputs committed from contributors' machines, which is the evidence that the pinned bundler and lockfile give a reproducible build.
- The Windows job starts the built service entry and has no build step.
- Release eligibility reads the companion manifest and two compiled entries from the pushed distribution revision and compares their version stamps with the package version. Publication requires the check job to pass on that exact revision.
- Promotion so far was a pull request from the development branch into the distribution branch, merged with a merge commit, after which the development branch was moved forward to that merge commit. Checks on a pull request whose head is the development branch are skipped as duplicates of its push checks.
- README and the setup guide list `#dev` as a selectable ref for development builds. The Git-distribution gate installs from a development branch that has built entries and asserts that the outputs are not ignored, because it tracks them with an ordinary add.
- A push made by a workflow with the repository's own token starts no new workflow run, and the contributor guide says automation does not commit to the distribution branch.
- Whether the distribution branch has protection rules or required checks cannot be read from the repository.

**Decisions.**

1. **All nine outputs leave the development branch.** A subset would keep the conflict for whatever stayed, and the copied skill and the generated manifest are as derived as the bundles.
2. **Removed from the index and ignored.** The development branch ignores the nine paths, so a local build leaves the tree clean and an ordinary add cannot bring them back. The list of outputs and the sequence that builds all of them have one owner in the build scripts, used by the checks, the promotion command and a single package script for contributors.
3. **Checks follow the kind of revision.** A source revision tracks none of the nine: checks build them first, run everything against that build, rebuild, and require identical bytes. A distribution revision tracks all nine: checks keep today's rule that committed bytes equal a rebuild. The kind is decided by the event's target (a push to, or pull request into, the distribution branch is a distribution revision; everything else is a source revision) and, with no event, by the tree. A tree that disagrees with its kind, or tracks only some of the nine, fails before any other step.
4. **A promotion commit with a fixed shape.** Parents: the distribution branch tip, then the accepted development revision. Tree: that development revision plus the nine outputs built from it. The command takes both revisions as inputs, builds in a clean tree after a frozen install, tracks the nine by force under the same ignore rules, and checks the shape before finishing: no difference from the development revision outside the nine, version stamps equal to the package version, and outputs equal to a second build. It creates the commit on a local promotion branch and stops. It never pushes, tags, publishes or moves the development branch.
5. **The commit reaches the distribution branch by pull request, as before.** The maintainer pushes the promotion branch and opens a pull request into the distribution branch. Its head is neither the development nor the distribution branch, so the full checks run on the merge result before the distribution branch moves, and the push that follows the merge is validated and published by the unchanged release workflow. The distribution tip is an ancestor of the promotion commit, so the merge result has the same tree.
6. **A pull request into the distribution branch always runs its checks.** The duplicate-head skip no longer applies when the base is the distribution branch. A pull request opened from the development branch by habit therefore fails visibly instead of showing skipped jobs as success.
7. **The development branch never receives distribution commits.** It is no longer moved forward to the release merge, and the distribution branch is never merged into it. A change made only on the distribution branch is brought to the development branch as its own pull request. This keeps every later promotion free of conflicts in the nine outputs: the merge base lacks them, only the distribution side has them, and the build replaces them.
8. **The development branch is not an installable ref.** README and the setup guide drop `#dev`. The Git-distribution gate tracks the nine by force as promotion does, keeps asserting that local data is ignored, and shows that a ref without built entries is refused while an existing installation is preserved.
9. **Pre-promotion host gates run on the promotion commit.** Acceptance on the development branch still comes first. The native-host Git, folder and ZIP gates and the release journeys then run from a checkout of the promotion commit, which is the exact tree the distribution branch will hold, before its pull request is merged.
10. **Security scans are unchanged.** The code-scanning job keeps analysing without a build, so generated bundles are analysed on the promotion pull request and on distribution pushes, as they were, and no longer on development pull requests.

**Alternatives rejected.**

- A workflow that builds and commits after a push to the distribution branch: the repository token's push starts no run, so validating and publishing the built commit would need a stored credential that can write to the distribution branch. The pushed revision itself would fail the eligibility read of compiled versions, and the revision that was tested would no longer be the one published.
- A distribution branch that holds only build results, with its own history: release tags, the contributor-credit ancestry check and the fixtures that read earlier committed code all depend on distribution history containing development history.
- Merging the development branch first and adding a build commit afterwards: between the two, the distribution branch has a higher version with missing or stale outputs, and hosts following it are offered that version.
- Leaving the outputs unignored and relying on the check alone: every local build would show nine untracked files, and an add-all would commit them.
- Building inside the code-scanning job on development pull requests: it adds dependency installation and a build to a job that can write security events, for bundles that are analysed at promotion anyway.

**Failure modes.**

- A pull request from the development branch is merged into the distribution branch despite failing checks. The push check fails and nothing is published, but the distribution branch then lacks outputs (first time) or holds stale ones, possibly under a higher version. Hosts refuse a package with missing entries and keep the previous installation; stale outputs would be accepted. Recovery is a correct promotion on top. A required check on the distribution branch would close this; that is a repository setting outside this change.
- The local bundler differs from the pinned one: the outputs differ and the promotion pull request fails before the distribution branch moves.
- An output returns to the development branch through a rebase or a merge of the distribution branch: the source-revision check fails and names it.
- The distribution branch has a change the development branch lacks: the command refuses and names the paths.
- A test or driver is run alone on the development branch without building: it fails on the missing file. The contributor guide names the build command; drivers that build disposable guests from source are unaffected.
- An installation made from `#dev` before this change keeps its installed files. When the development branch later raises its version, the host offers an update, refuses the package and keeps the previous files. Such an installation has to be replaced by one from the default branch or a tag; the guides and the release notes say so.
- The first real use of the command is the promotion of this release. It is rehearsed in a disposable clone here and again by the release preparer.

**Mixed versions and rollback.** No runtime source, store, protocol or package content changes, so installed extensions are unaffected in both directions. Before any promotion made with the command, rollback is a revert on the development branch that also regenerates the nine outputs in the same pull request; the restored committed-equals-rebuilt check refuses stale ones. After such a promotion the same revert applies, and the next old-style promotion meets one add/add conflict per output, resolved to the development branch's regenerated files and verified by the strict check. If the command fails at release time, the same commit can be made by hand from the documented steps (merge without committing, build, add the nine by force, commit) and is verified by the same pull-request checks; the distribution branch does not move until that pull request merges.

**Verification.** Automation tests drive the revision-kind rule, the misplaced-output refusals and the promotion command against synthetic repositories. Portable checks run in a fresh full-history clone of the source revision with a cleared environment. Promotion is rehearsed in a disposable clone that has no remote: two consecutive promotions, the second after a synthetic source change with a version increase and notes, each checked for parents, tree shape and a conflict-free merge, followed by the portable checks on the second promotion commit under a synthetic distribution-push event so that strict parity and the existing release validation run on that revision. A direct merge of the development branch and an output re-added to it are shown to fail. Nothing is pushed, tagged or published. The Git-distribution gate runs against a projection of the rehearsed promotion when an isolated host installer is available, and is otherwise reported as not run and left to the release preparer's existing pre-promotion gate.
