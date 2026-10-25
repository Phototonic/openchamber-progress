# Agent progress

Keep your canonical planner and task tools. Mirror a complete plan once, using
stable IDs. Report only meaningful changes and delegation/finish boundaries;
batch changes, never timer heartbeats. Read current state after compaction or
revision conflict. Original plan documents stay authoritative and are never
rewritten by capture.

Use `agent_progress_report`; inline guidance documents its operations. Routine
requests use `op=change`, `plan`, fresh `oid`, expected `rev`, and changed items.
For large structures stage numbered chunks and explicitly commit all chunks;
staging is not completion. Pass plan/item IDs in child assignments and explicitly
link a verified child before accepting its assigned-item reports. Do not relax
restricted-child tool policies; an explicit parent relay labels both identities.
Unlinked work remains independent. Finish/cancel/fail explicitly; never derive
completion from turn outcomes, idle state or report age.

If not already reported, mirror an actionable plan or meaningful change; repeated
guidance or a possible-plan file hint alone is not a reason to report again.
Document-backed plans may explicitly name their canonical source, subject to
report-time read permissions. Structured/conversation-only plans need no source;
never manufacture a Markdown file. No particular planner or agent name is required.
Needs-input keeps actual work pending/blocked. Authored or Ready is not reviewed
or accepted, and worker completion is not accepted handoff. Do not invent review
tasks, readiness or progress from file writes. Only a deliberate report receipt
records progress; an advisory hint does not.
