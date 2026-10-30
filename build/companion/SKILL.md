# Agent progress

Keep your canonical planner and task tools. Mirror a complete plan once, using
stable IDs. Report only meaningful changes and delegation/finish boundaries;
batch changes, never timer heartbeats. Read current state after compaction or
revision conflict. Original plan documents stay authoritative and are never
rewritten by capture.

Tracker updates are not Agent Progress reports. For tracked plan work, explicitly
mirror meaningful unreported canonical state at PLAN_READY handoff, review approval,
owner approval and work start; do not report again if already current. These are
actual canonical states, not events the plugin detects. At PLAN_READY mirror the
actionable structure, not implementation completion or approval. Review approval
and owner approval are separate; reflect existing canonical gate/work items only,
never invent review tasks to report. Work start means actual work, not a dispatch
having run. Never manufacture a file or report automatically on each turn.

Native dispatch/tracker hints are conditional observations, not report receipts,
assignments or evidence of work start, review, approval or completion. Already-current
canonical state needs no mutation.

Use `agent_progress_report`. Every mutation requires a fresh `oid` and expected
`rev`; reuse an `oid` only for an identical retry. A new `start` requires `plan`,
`title`, the complete `items` structure and `rev:0`. Minimal valid start (replace
synthetic IDs/title/items with the real plan):

```json
{"op":"start","plan":"synthetic-plan","title":"Synthetic plan","oid":"start-1","rev":0,"items":[{"id":"task-1","title":"Synthetic task","kind":"task","status":"working"}]}
```

Read accepts only `op: "read"`, one concrete `plan` identifier and optional 0-based `page`;
no wildcard, `oid` or `rev`. Omit `page` for a compact summary without items;
explicit `page` returns paged detail. Read the current revision before updating an existing
plan. An `invalid` reply may include a safe `hint` explaining what to correct;
it is not evidence of a host outage. Empty/all-skipped plans cannot finish
successfully. Denied document access still commits valid checklist changes with
diagnostics; `source` is optional and never a reason to manufacture a file.

Inline guidance documents the other operations. Routine
requests use `op=change`, `plan`, fresh `oid`, expected `rev`, and changed items.
For large structures stage numbered chunks and explicitly commit all chunks;
staging is not completion. Pass plan/item IDs in child assignments and explicitly
link a verified child before accepting its assigned-item reports. Do not relax
restricted-child tool policies; an explicit parent relay labels both identities.
Unlinked work remains independent. Finish/cancel/fail explicitly; never derive
completion from turn outcomes, idle state or report age.

For the next `subagent` delegation, the coordinator may use `op=delegate` with
`plan`, fresh `oid`, expected `rev` and `assign` (at most 50 unique task IDs).
Empty `assign` cancels that plan's pending declaration. This does not dispatch a
child or assign tasks: pending authority is memory-only, expires in five minutes
and disappears on restart. Identical retries do not arm twice; after restart,
deliberately re-declare with a fresh `oid`. Any installed `subagent`
implementation qualifies only when its hook pair, native call census, closing
step and verified immediate child/complete ancestry all agree; ambiguity or
missing evidence retires without assignment. These gates prove call correlation
and child lineage, not that the tool actually created or continued that child:
installed tools are trusted to report the child they delegated to. Slim is
covered through these same gates, not separate certification. Use explicit
`link` and assigned parent relay when evidence is unavailable.
Binding is attribution only, never progress, completion,
reporting permission or accepted handoff. It never relaxes child restrictions.

For a deliberately blocked task, optionally report `blocker` with only
`category`, `reason` and `nextAction`. Categories are `decision`, `dependency`,
`review`, `external`, `other`; each prose field must be nonblank, at most 512
JavaScript string code units and contain no NUL. Supply purpose-written safe
summaries, never private prompts, transcripts or raw tool output; bounds and
literal rendering do not redact secrets. Missing parts stay unknown.
`blocker` is a complete replacement, not a merge: omitted members become unknown,
`{}` records unknown parts, and `null` clears details without resolving blocked
status. Omission preserves only verified-current details on a continuously
blocked retained task. Groups reject this field; non-null details require blocked
status. For a metadata-only change explicitly repeat `status:"blocked"`.
Start/revise/staged items also support it; staged details appear only at commit.
Leaving blocked or closing clears current details; re-entry/reopen without a new
object starts with unknown details. Older writers can invalidate optional details;
deliberately re-report them rather than inferring or reviving old text. Never send
unsupported fields automatically to an older tool. Reported waiting time, when
available, is derived from status history, not a caller-supplied duration or proof
that a model is active. No automatic notification, approval or action is implied.

If not already reported, mirror an actionable plan or meaningful change; repeated
guidance or a possible-plan file hint alone is not a reason to report again.
Document-backed plans may explicitly name their canonical source, subject to
report-time read permissions. Structured/conversation-only plans need no source;
never manufacture a Markdown file. No particular planner or agent name is required.
Needs-input keeps actual work pending/blocked. Authored or Ready is not reviewed
or accepted, and worker completion is not accepted handoff. Do not invent review
tasks, readiness or progress from file writes. Only a deliberate report receipt
records progress; an advisory hint does not.
