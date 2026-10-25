# OpenChamber Agent Progress

OpenChamber Agent Progress is an OpenChamber extension with an OpenCode companion for tracking agent work through explicit structured reports. It provides three progress-first views: a session side panel, a compact Work Status view, and a fullscreen board across recorded projects, worktrees, and sessions. The companion can also capture a bound planning document for read-only reference.

Reports and captured documents are stored in a local SQLite database. Capture and the host service are designed for the same machine and account; a web or relay client can view the connected host's data, but this does not make capture work across separate hosts or containers. The extension and companion are written in TypeScript.

## Status

This is an unreleased **private testing candidate**, not a public release. Source and package checks pass; extended real-host evaluation is still required.

Accepted source updates include correctly scoped recent-session memory with quiet revalidation and no repaint when data is unchanged; bounded refresh when switching to the latest session; and deterministic SQLite cleanup after companion setup fails. Setup now offers read-only, host-side, editable config/data/store suggestions. The suggested store is `<data folder>/openchamber-progress`; suggestions are not confirmation of the effective OpenCode roots. Inspect is read-only, and setup changes are made only after reviewing the resolved targets and explicitly confirming.

The Linux-only setup suggestions and capture support do not extend to other platforms. Bounded isolated tests did not reproduce the previously reported long-uptime real-host sluggishness. Validation on a real instance over hours remains a release blocker. Building this candidate does not change an existing installation; evaluate it through a manual install when ready.

Longer isolated endurance checks kept requests, frames and companion connections bounded without navigation-latency drift in the tested windows. A small host-page heap increase during session switching remains unexplained; these checks do not establish that the hours-long issue is fixed.

## Install for evaluation

When the candidate is ready for evaluation:

1. Manually install its generated extension ZIP through OpenChamber Settings. This replaces any existing extension package; the separately installed companion is updated through its explicit setup flow.
2. In setup, review and edit the suggested config, data, and store paths as needed. Inspect the resolved targets, then review the host-service privilege and separate capture lifecycle before explicitly confirming setup.

The extension ZIP includes the companion payload and setup utility; this installation flow does not require a separate companion ZIP. Capture has a separate lifecycle from the extension: if you want it to stop, explicitly disable or remove the companion **before** uninstalling the extension. Uninstalling the extension alone does not stop capture. Removing the companion retains its database and history; cleanup is not automatic.

### Updating an existing installation

Installing a new extension package preserves the configured companion folders, store, and history, but may not update the separately installed companion. The rail/page and Setup show a notice when the bundled companion differs: a same-version rebuild is shown as a different build, while an installed version newer than the bundle gets a warning, never an automatic downgrade. **Review update** shows the installed and bundled versions and existing folders before acknowledgement and confirmation; it does not repeat first setup or silently apply future changes. See [companion update details](docs/setup.md#bundled-companion-detection-u1-backend-u2-ui-follow-up) and the [frozen comparison contract](docs/contracts.md#u1-frozen-additive-companion-comparison-u2-consumer-contract).

Updating companion files is separate from loading them. Follow the reload notice and restart OpenCode when safe; merely opening a new session is not a reliable activation step, and OpenCode is never restarted automatically. Setup's selected companion version is authoritative; root-folder utility metadata can retain its initial version and is not the selected version. This flow remains protocol/schema 2.

Visible progress views quietly check the official repository's **main package version**,
not GitHub Releases or the actual installed source. “Official main version X available”
is informational: OpenChamber Settings → Extensions remains the installer, and custom
branches/tags/forks or ZIPs may need an explicit separate choice. Nothing silently
switches sources or installs. Inaccessible private metadata is unknown; previously
validated information may remain explicitly stale. The companion's **Review update**
and confirmation flow remains separate from this official-main notice.

Working tasks have restrained blue status motion and whole-minute elapsed labels
for their continuous **reported-working** interval. These are not CPU/model time,
an ETA or proof of continued execution. Incomplete history is labelled “at least”;
unknown history supplies no invented start. Reduced-motion keeps truthful labels
without decorative movement; hidden frames pause visual work.

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

### Built Git distribution and ready-main gate

The intended standard Git source is `https://github.com/Phototonic/openchamber-progress.git`.
OpenChamber follows its default branch unless a `#branch-or-tag` is selected. The
repository is currently private; this is a preparation target, not a claim of public
reachability or permission to install it now. A Git consumer performs no build or
dependency installation. The candidate tree must include the existing guest bundles
and these ordinary built backend files at their manifest paths:

```
build/service/main.js
build/companion/index.js
build/companion/package.json
build/companion/SKILL.md
build/setup/main.js
```

Only these generated backend entries are eligible for tracking; artifacts, bindings,
databases, dependencies, evidence and local instructions remain ignored. Backend
build tooling does not rebuild guest bundles. Parent acceptance/staging is required
before claiming those entries are actually committed to a candidate Git tree.

Work stays on `dev`; production `main` changes only under a separate ready-version
approval. Before promotion: accept the complete stable guest/backend projection,
choose a higher matching package/RELEASE/companion version, verify exact built-tree
and package-entry digests, pass the supported host Git install/check/explicit-update
gate plus folder/ZIP/companion lifecycle gates, and promote that same accepted tree.
Dev-only commits, changed bytes at the same semver, tags and GitHub Releases do not
advance the default-main version. Pins remain selected; no silent ref switching.

Before advertising public installation, separately establish public readability and
that the canonical default branch is `main`, and resolve/accept the outstanding
hours-long real-host performance blocker. This work does not authorize a version
bump, main merge/push, visibility change, tag, GitHub Release or real installation.
The current private candidate remains0.2.4. See [distribution gates](docs/setup.md#git-distribution-validation-and-main-promotion).
