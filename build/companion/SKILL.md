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
