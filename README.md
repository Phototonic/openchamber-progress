# OpenChamber Agent Progress

**See the plan. Follow the work. Know what was actually reported.**

An [OpenChamber](https://github.com/openchamber/openchamber) extension with an OpenCode companion for explicit, structured agent progress. Keep your existing planning workflow and bring its checklist, current work, and contributions into one place.

> **Early access · Linux and native Windows capture · OpenChamber ≥ 2.5.1**
>
> OpenCode **2.1.4** is the tested capture version; broader compatibility is not established.
> Native Windows uses the operating system's built-in PowerShell for private-file checks; no extra executable, compiler, or package installation is required. See the [Windows support boundary](docs/setup.md#native-windows).

## Three ways to follow along

| View | What you get |
| --- | --- |
| **Session panel** | The selected session's plan, task hierarchy, current work, and main/child contributions. |
| **Work Status** | A compact progress summary alongside your work. |
| **Fullscreen board** | Recorded plans across projects, worktrees, and sessions, with filters and detail. |

- **Plans, not just activity:** done, remaining, blocked, and skipped work stay distinct from session activity.
- **Your document stays yours:** optionally bind a plan document for read-only capture; the companion never edits it.
- **Honest gaps:** report age, missing reports, incomplete coverage, and unavailable connections stay visible.

Progress comes from **deliberate reports**, not passive observation or inferred completion. The loaded, enabled companion offers best-effort reporting guidance when its tool is available—no special agent name, manual skill load, or prompt edit is required. Guidance cannot guarantee participation or track every model or subagent.

## Quick start

1. In **OpenChamber → Settings → Extensions**, install from this Git URL:

   ```text
   https://github.com/Phototonic/openchamber-progress.git
   ```

2. Open **Agent progress → Setup**. Review or edit the suggested OpenCode config/data folders and dedicated progress-store folder. Suggestions are not proof of the effective OpenCode paths.
3. **Inspect**, review the resolved targets and full-user host-service privilege, then explicitly confirm companion installation.
4. Follow the activation notice and reload/restart OpenCode **when safe**. Opening a new session alone is not a reliable reload. Begin work with an agent that can use `agent_progress_report`.

The public Git distribution uses **`main`** and includes built runtime files: **no dependency install or compilation is needed for users**. A locally built extension ZIP can also be installed through Settings; it includes the companion payload and setup utility. Current package version is **0.2.9**. Tagged ZIP downloads are available from [GitHub Releases](https://github.com/Phototonic/openchamber-progress/releases) after the main release workflow succeeds.

## Before you enable capture

> **Separate lifecycle:** disable or remove the companion **before uninstalling the extension** if capture must stop. Closing or uninstalling the extension alone does not stop capture. Removing the companion retains the database and history; there is no automatic purge.

- **One host and account.** Capture and the host service must share the same local filesystem and account. Web/relay viewers can see that host's data; they do not enable capture on a different host or isolated container.
- **Private work stays in a host-local SQLite store.** It can contain plan text and source/project paths. Treat the store, diagnostics, and screenshots as sensitive.
- **Not entirely offline.** Visible progress views check GitHub's public repository metadata for the official `main` version. This is informational, not an automatic install or source switch.
- **Elapsed is reported time.** Working labels measure a continuous *reported-working* interval—not CPU/model time, an ETA, or proof that execution continues. Incomplete history is labelled “at least.”

## Updating

1. Review available extension updates in **Settings → Extensions**, then choose whether to install. The official-main version notice does not change a selected branch, tag, fork, or ZIP source.
2. If the extension offers a different bundled companion, choose **Review update**. Inspect versions and existing folders, then explicitly confirm. A newer installed companion is a downgrade warning, not an automatic replacement.
3. Follow the reload notice and restart OpenCode **when safe**. Installed files and loaded code are separate states; OpenCode is never restarted automatically.

Companion updates preserve the configured store and history. See [setup and lifecycle details](docs/setup.md#bundled-companion-detection).

### Automated releases

Maintainer-approved **higher package versions reaching `main`** are configured to run checks and automatically publish matching `v<version>` tags and ZIP assets. Release notes use GitHub's native **What's Changed**, applicable **New Contributors**, and **Full Changelog** sections—not a custom all-commits list. Same-version docs/CI pushes, including the earlier 0.2.5 automation setup, do **not** create a tag or release. OpenChamber's update notice still checks the `main` manifest, not GitHub Releases.

## Go deeper

- [Setup, diagnostics, disable/removal, and distribution](docs/setup.md)
- [Progress views and their limits](docs/ui.md)
- [Reporting and API contracts](docs/contracts.md)
- [Tested compatibility and bounded evidence](docs/compatibility.md)
- [Contributing and development commands](CONTRIBUTING.md)

The technical guides retain historical validation notes; early access does not imply complete platform/model coverage or the absence of long-running issues.

## License

Project code is available under the [MIT License](LICENSE). Bundled dependencies and adaptations retain their own terms: see the [third-party notices](THIRD_PARTY_NOTICES.md) for grants, credits, full-license references, and documented provenance/interpretation limits.
