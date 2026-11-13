# Proposal

## Why

Users should be able to carry reported plan progress into a new or compacted conversation without manually copying it. A composer mention offers an explicit plan choice; session-menu actions offer an editable draft. Both complement, rather than replace, the companion's automatic post-compaction recorded-pointer capsule.

## What Changes

- Add an **Agent progress** section to the host's `@` menu, backed by authenticated, bounded plan search and source-qualified resolution.
- Add **Insert handoff** and **Insert progress update** background session actions. The clicked session supplies the plan; the currently active chat receives the text for review. Neither action sends a message or opens a panel.
- Use one pure summary implementation for existing previews and both new surfaces. A composer presentation adds source-qualified identity, revision, report time, reported-not-verified wording and a 16,000-character ceiling with whole-task omissions.
- Prefer a valid saved rail choice when a session has several plans; otherwise reuse automatic featured-plan selection. Disclose other plans without combining their progress.
- Keep existing preview localization and format. Background insertions follow the effective device language. Mention utility text is English because the host's service requests contain no language context.
- Ship the new background guest as a built classic script, include it in package/parity checks, and document the additive capability without changing protocol/schema 2.

## Scope

**IN:** manual read-only summaries; service mention routes; one on-demand background entry; manifest contributions and host-floor declaration; focused tests, generated outputs and affected contract/build guides.

**OUT / Must NOT have:** reporting/status mutations, approval, assignment, workflow control, automatic sending, notifications, per-task review, polling, persistent summary/search caches, transcript/message permissions, document-body reads, file actions, navigation features, source-discovery/setup changes, companion changes, CI workflow cleanup, dependency upgrades, package-version bumps or release publication.

## Capabilities

### New Capabilities

- `plan-composer-handoff`: bounded reported-progress summaries through plan mentions and session-menu draft insertions.

### Modified Capabilities

- `interface-localization`: explicitly scope the language contract for the new composer presentation and the English-only service mention exception. Existing preview output and privacy behavior remain unchanged.

## Impact

Existing owners are `service/server.ts`, `shared/store.ts`, the bounded search machinery, `ui/shared/summary.ts`, the shared dependency/readiness projection, session-scoped reads, rail preference storage and Work Status automatic selection. Build/package scripts must include the new background HTML/script; no consumer compilation is introduced. Update `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `docs/compatibility.md` and contributor build instructions with implementation. The guides remain the contract of record.

Release 1.2.0 sets `engines.openchamber` to `>=2.7.1`; the build SDK remains pinned at 2.7.0. This replaces the earlier feature-minimum/unknown-key fallback policy. OpenChamber 2.7.1 adds mobile extension support, and available host evidence is limited to 2.7.1. Verify installation on 2.7.1 and normal version-message refusal below that floor using an actual older installer where available, not inference from SDK parsing alone.
