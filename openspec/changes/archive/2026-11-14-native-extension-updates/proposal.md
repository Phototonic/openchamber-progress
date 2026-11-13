# Proposal

## Why

OpenChamber owns installation provenance, Git update discovery, approval and replacement. Agent Progress separately advertises the official repository's main-branch version, even for installations that do not follow it. That duplicate notice cannot identify the user's installed source and requires an otherwise unnecessary external metadata request.

## What Changes

- Remove the official-main notice from the rail, board and Work Status, including its requests, scheduling and dismissal reads/writes. Do not substitute another update indicator.
- Retire the GitHub metadata fetcher. Keep authenticated `GET /v1/extension-update` for at least one release as a network-free, old-client-compatible unavailable reply, rather than breaking mixed service/guest installations.
- Direct installation/update instructions to the host's Settings → Extensions flow. Verify default-branch, branch-selected, tag-selected, folder and ZIP behavior on OpenChamber web 2.7.1 with disposable local fixtures.
- Document the measured approval, state retention, service/frame replacement and managed-companion activation behavior. Keep loaded-byte observations distinct from update availability.
- Remove the current network-check disclosure and reconcile affected guides, regression tests and generated runtime entries.

## Scope

**IN:** retirement of extension-owned version checking and UI; one-release compatibility route; native-host update acceptance; install/update/reload wording in both supported UI languages; distribution checks and affected documentation.

**OUT / Must NOT have:** an extension-owned updater or Settings navigation action; replacement update badge or Work Status line; new outbound request, permission, polling loop, dependency or host-floor change; plugin delivery/binding redesign; data/schema migration; global-plugin restoration; account/authentication setup for real services; package-version bumps or publication; a new website/deep-link install button; chat-tool presentation changes; unrelated cleanup.

## Capabilities

### New Capabilities

- `native-extension-updates`: host-owned update guidance, network-free compatibility retirement and version-qualified distribution evidence.

### Modified Capabilities

None in the current canonical OpenSpec tree. This is a subsequent change to the guides' existing official-main behavior. The earlier managed-companion change deliberately left that behavior alone within its own scope; this proposal explicitly retires it without changing managed delivery's safety requirements.

## Impact

Affected owners include `service/extension-updates.ts`, the fixed service route, the shared update DTO, guest adapter/source/controller and all three visible entries; shared Setup/reporting-health wording; `scripts/verify-live-package.ts`, `scripts/verify-git-package.ts`, focused tests and disposable host/browser fixtures. Update README, `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `docs/setup.md`, `docs/compatibility.md` and the stale update comparison in CONTRIBUTING. Regenerate affected entries using existing build scripts. Protocol/schema 2, progress facts, private bindings, history and legacy recovery authority stay unchanged.
