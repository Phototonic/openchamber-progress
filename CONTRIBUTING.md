# Contributing

Thanks for helping improve Agent Progress! Use GitHub issues for bugs and proposals, and pull requests for changes. No private tracker, local planning files, or internal evidence archive is required to contribute.

## Report a problem safely

Include the extension, OpenChamber, and OpenCode versions; the affected view or setup step; expected versus observed behavior; and a small, sanitized reproduction. State the host OS and whether capture and the host service share one machine/account.

**Before posting, inspect every attachment and example.** Do not publish credentials, tokens, raw logs, private filesystem paths, customer/project content, internal tracker data, or personal configuration/prompts. Use synthetic names and paths. Crop/redact screenshots and share only the minimal sanitized diagnostic excerpt needed. For a suspected security issue, do not post exploit details or sensitive data publicly; ask the maintainer for a private reporting route first.

AI assistance is welcome. You remain responsible for the change and its verification. Keep internal AI review transcripts/summaries in the working conversation unless publication was explicitly requested; a PR needs a useful summary and test results, not private review history.

## Branches and scope

- Start a focused feature/fix branch from **`dev`** and normally target **`dev`** with your PR. Discuss large behavior, storage, permission, or compatibility changes before implementing them.
- **`main` is the versioned distribution branch.** Runtime promotions require maintainer approval, a higher matching extension/companion version, and the accepted built guest/backend projection plus distribution and lifecycle checks. Do not bump versions or regenerate unrelated outputs in a routine contribution.
- The explicitly owner-authorized **launch documentation, licensing, and CI setup on `main`** is a narrow exception, not permission for routine runtime changes or a general direct-push workflow.

## Local development

Use **Node.js 24.19.0** and **Bun 1.3.14**; dependencies are pinned in `package.json` and `bun.lock`. Linux integration uses OpenCode 2.1.4 and OpenChamber 2.5.1; native Windows validation uses OpenCode 2.1.4 and OpenChamber 2.5.2. These are tested configurations, not proof of every newer runtime. Linux package checks also need system `zip` and `unzip`.

For native Windows development, use the built-in Windows PowerShell 5.1 and local NTFS storage. No native helper or compiler is part of the runtime. After the frozen dependency install, run `node --experimental-strip-types --test tests/backend/windows-platform.test.ts`, the root/UI typechecks, and the relevant browser tests. The Windows suite creates and cleans isolated private fixtures under a fresh drive-root folder; it does not use a live profile or model. Foreign-owner and persisted callback-ACE fixtures explicitly skip if the account/OS cannot create them; pure descriptor policy still runs. The existing Linux isolation/auth/performance helpers are not Windows tests. ZIP production can remain on Linux; Windows consumers install the built outputs without compiling.

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run tsc --noEmit -p ui/tsconfig.json
```

Run the checks relevant to your change:

```sh
# Fixture parent for standalone backend test runs
mkdir -p /tmp/opencode

# Full backend tests: requires the native prerequisites described below
node --experimental-strip-types --test tests/backend/*.test.ts

# Browser-oriented logic tests; these do not replace rendered-UI QA
node --experimental-strip-types --test tests/browser/*.test.ts

# Automation fixtures (no writable GitHub calls)
node --experimental-strip-types --test tests/automation/*.test.ts
```

Some backend runtime tests require an independent OpenCode 2.1.4 binary and Linux isolation tools (`unshare -Urn` and `ip`). See the [compatibility guide](docs/compatibility.md#agnostic-activation-private024-package-validation) and the relevant test's prerequisites before running them. Never use a live profile, copy authentication, restart a real instance, or call a paid model just to run a test. Report unavailable prerequisites and skipped checks honestly.

### Portable CI — fresh disposable checkout only

In a **fresh disposable checkout** of the revision you want to test, with the toolchain above:

```sh
bun install --frozen-lockfile --ignore-scripts
node --experimental-strip-types scripts/ci.ts
```

The helper **refuses a nonempty `build/artifacts` before reading runtime entries or starting checks**. It never deletes existing archives. Do not clear a maintainer's artifact folder to make it run; use a fresh disposable checkout instead. The helper creates `/tmp/opencode` for its fixtures.

It runs root/UI typechecks, portable backend tests, browser-model and automation tests, backend/guest builds with eight-entry parity checks, then package assembly and verification. It explicitly excludes these external-runtime tests:

- `production-runtime.test.ts`
- `plugin-failure-runtime.test.ts`
- `progress-activation-runtime.test.ts`

This is **not native GUI/OpenCode or host-installer certification**. The external host-installer gate is separate, as described below. Full `bun run check` retains the native backend prerequisites; it is not the portable CI command.

The [workflow](.github/workflows/ci.yml) runs on pushes to `main` and `dev`, and on pull requests targeting either branch. It retains the Linux portable checks and adds a targeted Windows native-filesystem suite. Versioned publication also waits for the Windows job. Neither job substitutes for actual OpenCode/OpenChamber integration acceptance.

Only `main` pushes can publish releases. A `dev` push runs portable checks but is never release-eligible; its publish job may appear as skipped. Accept the candidate on `dev` first, then promote the same commit to `main` after the required gates pass.

### Built files are intentional

TypeScript is the source of truth, but Git installs execute the checked-in JavaScript. Include the affected built outputs with runtime changes; consumers do not compile or install dependencies. Rebuild only the relevant outputs, coordinating changes to shared contracts and generated files rather than overwriting another contributor's work.

```sh
# Backend service, companion, and setup entries (does not build guests)
bun run build:backend

# Each guest bundle takes BOTH an entry and an output; run only affected views
bun run bundle:guest ui/panel/main.ts ui/panel/main.js
bun run bundle:guest ui/status/main.ts ui/status/main.js
bun run bundle:guest ui/page/main.ts ui/page/main.js
```

### Package and integration checks

With accepted guest/backend outputs and system `zip`/`unzip` available:

Use a disposable checkout for packaging too if your usual working tree contains archived artifacts.

```sh
bun run package
bun run verify:package
```

Assembly writes the extension and companion folders/ZIPs under `build/artifacts/`; these are local outputs, not files to commit. Verification exercises those folders and ZIPs, checks entries/versions, and runs isolated service and companion lifecycle checks.

`bun run check` combines the root typecheck, backend tests, backend build, package assembly, and package verification. It **does not** include the UI typecheck or browser tests. Use it for relevant integration changes, not as a mandatory gate for a typo or documentation-only PR.

The actual OpenChamber folder/ZIP installer check runs only when `AGENT_PROGRESS_HOST_MODULE` points to an isolated host's `server/lib/guests/install.js`. That module is not supplied by this repository and may come from a separate host checkout/extracted test environment. Without it, package verification reports the host check as not run; do not claim host installation was tested. The Git-distribution gate also needs this module and a disposable source-tree projection: see [distribution validation](docs/setup.md#git-distribution-validation-and-main-promotion). Neither gate authorizes installation into a real host.

### Versioned main promotions and releases

Maintainers must complete the supported native-host Git/folder/ZIP and companion lifecycle gates **before** promoting a runtime version from `dev`. Portable CI does not replace those gates. The approved tree must contain the matching package/RELEASE/compiled versions and accepted built entries.

A **higher numeric `major.minor.patch` package version reaching `main`** makes the included workflow eligible to validate that exact revision and automatically publish a matching `v<version>` tag and release assets: extension/companion ZIPs and checksum inventories. It uses only native GitHub-generated release notes: **What's Changed**, applicable **New Contributors** mentions, and **Full Changelog**. It does not promise a list of every direct commit or custom contributor enumeration.

The automation does not bump versions, commit to `main`, or publish to npm. Same-version pushes—including the earlier 0.2.5 launch setup—skip publication without creating a tag or release; an empty release history does not bootstrap one. Version 0.2.6 starts the versioned release sequence; publication requires the exact main revision to pass the workflow. This publication policy is separate from OpenChamber's official-main version notice and the explicitly confirmed companion update/reload flow.

## Before opening a PR

- Explain the user-visible outcome and keep unrelated changes out.
- Add focused regression coverage for meaningful behavior changes; list commands, results, and any skipped checks. For docs-only edits, check local links and documented commands instead of rebuilding runtime bundles.
- For visible UI changes, include sanitized screenshots and relevant interaction checks. Update documentation/contracts when their behavior changes.
- Preserve license notices in copied or bundled third-party code. Adding a dependency or redistributing a bundle needs a license/notice review; the root MIT license does not relicense dependencies. See [third-party notices](THIRD_PARTY_NOTICES.md), including the documented attribution and interpretation limits.
- Review the entire intended diff and attachments for private data. Do not commit databases, bindings, dependencies, generated archives, local instructions, or private evidence.

See [setup and safety boundaries](docs/setup.md), [reporting contracts](docs/contracts.md), and [UI behavior](docs/ui.md) for existing design constraints. Ask in the PR if a technical guide's historical note conflicts with current source; do not silently relax a safety contract to make a check pass.
