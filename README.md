# OpenChamber Agent Progress

OpenChamber Agent Progress is an OpenChamber extension with an OpenCode companion for tracking agent work through explicit structured reports. It provides three progress-first views: a session side panel, a compact Work Status view, and a fullscreen board across recorded projects, worktrees, and sessions. The companion can also capture a bound planning document for read-only reference.

Reports and captured documents are stored in a local SQLite database. Capture and the host service are designed for the same machine and account; a web or relay client can view the connected host's data, but this does not make capture work across separate hosts or containers. The extension and companion are written in TypeScript.

## Status

This is an unreleased **private testing candidate**, not a public release. Source and package checks pass; extended real-host evaluation is still required.

Accepted source updates include correctly scoped recent-session memory with quiet revalidation and no repaint when data is unchanged; bounded refresh when switching to the latest session; and deterministic SQLite cleanup after companion setup fails. Setup now offers read-only, host-side, editable config/data/store suggestions. The suggested store is `<data folder>/openchamber-progress`; suggestions are not confirmation of the effective OpenCode roots. Inspect is read-only, and setup changes are made only after reviewing the resolved targets and explicitly confirming.

The Linux-only setup suggestions and capture support do not extend to other platforms. Bounded isolated tests did not reproduce the previously reported long-uptime real-host sluggishness. Validation on a real instance over hours remains a release blocker. Building this candidate does not change an existing installation; evaluate it through a manual install when ready.

## Install for evaluation

When the candidate is ready for evaluation:

1. Manually install its generated extension ZIP through OpenChamber Settings. This replaces any existing extension package; the separately installed companion is updated through its explicit setup flow.
2. In setup, review and edit the suggested config, data, and store paths as needed. Inspect the resolved targets, then review the host-service privilege and separate capture lifecycle before explicitly confirming setup.

The extension ZIP includes the companion payload and setup utility; this installation flow does not require a separate companion ZIP. Capture has a separate lifecycle from the extension: if you want it to stop, explicitly disable or remove the companion **before** uninstalling the extension. Uninstalling the extension alone does not stop capture. Removing the companion retains its database and history; cleanup is not automatic.

Known limits: unseen sessions and rebuilt frames still start cold, and real-host long-uptime performance is unresolved. There is no supported automatic extension-uninstall hook; remove capture explicitly first if it should stop, and history is retained.

See [Safe global companion setup](docs/setup.md) for the full lifecycle, [Frozen contracts](docs/contracts.md) for API and reporting behavior, and [Progress views](docs/ui.md) for view behavior. Setup suggestions and capture are currently Linux-only; web and relay clients use the connected host and do not broaden that platform support.

The extension manifest currently requires OpenChamber 2.5.1 or later.

## Development

### Prerequisites

- Node.js 24.19.0 or later for the documented setup/runtime checks.
- Bun for dependency installation, TypeScript checks, and build/package tooling.
- `zip` and `unzip` for package QA; these are not consumer runtime dependencies.

Dependencies are pinned in `package.json` and `bun.lock`.

### Checks

```sh
bun install
bun run check
bun run tsc --noEmit -p ui/tsconfig.json
node --test tests/browser/*.test.ts
```

`bun run check` runs the root TypeScript check, backend tests, and backend build/package verification. It does not include the separate UI typecheck or browser tests shown above.

### Build artifact

`bun run check` builds and verifies the package. The extension ZIP is written to `build/artifacts/agent-progress-extension-<package-version>.zip`, where the version comes from the root `package.json`. The package is a built artifact; consumers do not need to install dependencies or compile TypeScript.
