# Design

## Evidence and feasibility

- `plugin/index.ts` registers namespace `agent_progress`, tool `report`, and its status RPC checks the native inventory for `agent_progress_report`. The checked-in managed-host fixture invokes that exact name through the native scripted provider. No plugin-ID or MCP prefix is indicated.
- `shared/progress.ts` defines `Receipt` as `{plan, rev, structuralRev, changed?, staged?}`. Mutation receipts do not contain the operation, plan title, resulting lifecycle, old/new task statuses, effect count or capture diagnostics. Error results are `{error, rev?, hint?}`. Reads, delegation and child handoff have different shapes; handoff input has no plan.
- `shared/store.ts` assigns `changed` from submitted task IDs, not a before/after comparison. Repeating an already-reported status can advance revision and return those IDs without changing that status. An identical operation replay returns its original receipt without another mutation. Valid checklist reports can commit while document capture is denied; `tests/backend/progress-invocation.test.ts` proves that the subsequent read, not the mutation receipt, exposes `documentState: denied`.
- [SDK 2.7.0 manifest contract](https://unpkg.com/@openchamber/sdk@2.7.0/README.md) and [parser](https://unpkg.com/@openchamber/sdk@2.7.0/dist/parse.js) support `match`, `name`, `icon`, title/subtitle templates and `output: "text"`, without an additional capability.
- [OpenChamber 2.7.1 template implementation](https://github.com/openchamber/openchamber/blob/v2.7.1/packages/ui/src/lib/guests/tool-presentation.ts) performs plain substitution, not branching. It **does parse JSON text output** when a header references output. Missing fields become empty strings and substituted values are capped. The problem is insufficient receipt meaning, not an inability to parse the tool's JSON text.
- [Host tool presentation](https://github.com/openchamber/openchamber/blob/v2.7.1/packages/ui/src/components/chat/message/parts/toolPresentation.tsx) uses `list-check-2` for checklist tools. [ToolPart](https://github.com/openchamber/openchamber/blob/v2.7.1/packages/ui/src/components/chat/message/parts/ToolPart.tsx) uses the full tool name for matching, leaves the built-in description when no subtitle is supplied, and renders forced text output literally. Its host error state is separate from JSON returned by a completed tool execution.

These are source and existing-fixture observations, not acceptance of the new manifest in a running host. The earlier reported accepted-but-ineffective defect is a motivation, not a reproduced defect or a diagnosis made by this change.

## Decisions

### Title/icon-only fallback

Declare a single contribution with:

| Field | Value |
|---|---|
| `match` | `agent_progress_report` |
| `name` | `Agent progress report` |
| `icon` | `list-check-2` |
| `output` | `text` |

Omit `title` and `subtitle`. The host uses `name` as the title. It is a noun identifying the tool, not a statement that a report succeeded. The icon identifies a checklist/report tool; it is not a success badge. Confirm the native transcript name and visible icon in the real-host check.

This is a fixed host-rendered manifest label, like the existing manifest action names, not a guest-interface message governed by the device language selector. Follow that existing boundary in `docs/ui.md` and the composer-handoff design: no locale bridge, preference read or locale-specific manifest generation. English/Russian guest controls and generated summaries remain unchanged.

Rejected alternatives:

- An input-based operation/plan or finish-status subtitle describes intent, including rejected intent. Calling that intent a successful report is unsafe.
- `{output.rev}` is also present on conflicts and is not an effect indicator. `changed` is not a count or list of actual status transitions. A plan title is not consistently returned.
- A concatenation of optional error/success fields cannot qualify all receipts, replay, staging, capture failures and child claims. A raw-output header would be truncated and would merely move the receipt into a subtitle.
- Adding a derived display summary or metadata receipt would change the frozen producer contract and introduce another interpretation of the result. Do not do it here.

Consequently, the rich compact-summary outcome is **no-go**. In particular, the UI cannot distinguish a same-status accepted call from an effective status change using its existing receipt alone. This limitation must be reported, not covered up by a success label. Rejected-call errors remain inspectable in the text body; do not claim that JSON `{error: ...}` necessarily becomes the host's native red error state.

### One presentation owner, no new authority

Use only the host's declarative registry. Exact matching avoids capturing other tools. Existing extension approval still applies; this contribution adds no permission and does not bypass an inactive guest or a hidden/restricted tool. Do not read the store, fetch a plan title, inspect conversation history, install a listener or cache display metadata to decorate a chat row. Tool output remains the source of result information.

### Compatibility and delivery

Retain `engines.openchamber: ">=2.7.1"` and SDK 2.7.0. Historical SDK 2.5.1 already recognizes `tools`; it is not evidence that all older hosts ignore this field. Unsupported hosts remain subject to the existing installation floor. A parser that does not recognize this optional contribution may discard it and retain generic rows, but that is not permission to lower the floor or promise installation below it. Separate old-parser tolerance from actual older-installer refusal evidence.

No migration, storage change or consumer rollout is required. `scripts/package.ts` copies the existing manifest block into the distribution. Manifest-only changes require no backend/guest rebuild; preserve tracked runtime outputs. Add concise UI documentation and accurately qualified compatibility evidence rather than changing setup instructions.

## Failure modes and verification

Exercise actual start, change, revise, finish and rejected calls in the real host, including an identical replay and a same-status change. Keep expanded receipt/error bodies in paired screenshots; retain before/after store assertions as evidence of effect or no effect, not as a new production display source. Include a successful report with denied document capture to demonstrate why a successful receipt is not an all-effects-success claim. A schema-level rejection tests the distinct native error path.

Inspect both collapsed and expanded rows, including a narrow chat. If the chosen icon is missing or literal output/errors become inaccessible, do not declare acceptance or broaden into a host patch. If row-level outcome distinction remains impossible, retain the documented no-go fallback rather than manufacture one.

## Rollback

Remove this single tools entry and its documentation to restore generic chat presentation. Existing messages, receipts, plans, grants and stored history remain untouched. Do not disable capture, reset data, reinstall a global plugin or restart a real host as rollback.
