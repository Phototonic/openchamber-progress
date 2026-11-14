# Proposal

## Why

Verified assigned children can already report task changes, but delegation is easy to omit and ordinary child contexts do not receive an assignment-specific reporting brief. Final child handoffs currently record claims independently of tasks. Users also lack a direct native session-menu entry into that session's Progress view.

## What Changes

- Strengthen coordinator guidance to declare task assignments before supported dispatches, and give permitted children a bounded, current assigned-task brief after binding becomes available.
- Keep reporting deliberate. A new child's first turn may precede assignment binding; do not insert a preparation turn, infer an assignment, or backfill progress automatically.
- Allow an optional explicit task update in a child-authored final handoff. Commit its claim and authorized task changes atomically, preserving visible revision conflicts and direct-child attribution. A handoff without that update remains claim-only.
- Add **Open Agent Progress** as a native session action opening the existing panel for the clicked session. Reuse source validation, scoped reads, selection and live-session owners.
- Show optional validated host agent and linked-resource context as source-labelled information. Omit the Workflows shortcut: the pinned SDK exposes neither a supported Workflows destination nor its availability contract.

## Scope

**IN:** companion guidance and bounded assignment reads; additive report-tool input/receipt behavior; native session action and panel context; optional host context display; focused tests, isolated real-host acceptance, affected guides and regenerated outputs.

**OUT / Must NOT have:** inferred progress, task percentages or steps, automatic preparation/resume dispatches, guaranteed first-turn reporting or model compliance, new child-to-parent messaging, per-task user interactions, child structural/finish authority, silent conflict rebasing, a new board, transcript/message permission, new polling or notifications, workflow execution controls, private host APIs, guessed deep links, new source discovery, dependency upgrades, version bumps or release publication.

## Capabilities

### New Capabilities

- `subagent-task-reporting`: assignment-aware guidance and explicit atomic child handoff/task reporting.
- `session-progress-context`: native session entry into source-verified Progress context and optional host metadata.

### Modified Capabilities

None. Existing delivery, localization and composer requirements continue to apply. The reporting and UI guides contain the authority and handoff contracts that must be amended with implementation.

## Impact

One change contains two independently testable capabilities. This keeps the shared contract-guide edits, generated distribution and combined managed-host acceptance together without making either implementation depend on the other. Existing background composer actions retain their one background entry; the new open-mode action does not require another background frame or a cross-frame state channel.

Affected owners include `plugin/activation.ts`, `plugin/index.ts`, `plugin/SKILL.md`, `shared/progress.ts`, `shared/store.ts`, `shared/subagent-runs.ts`, the bounded assignment/read owner, `package.json`, and existing shared UI context/live metadata consumers. Update `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `docs/compatibility.md` and the relevant README guidance. The guides remain the contract of record. Retain OpenChamber >=2.7.1, SDK 2.7.0, plugin SDK 2.1.4 and the existing installation/permission model.
