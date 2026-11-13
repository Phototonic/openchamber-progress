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

### Change proposals

Larger changes to behaviour, storage or compatibility are proposed under `openspec/changes/<name>/` (proposal, design, requirement scenarios and tasks) and validated with `openspec validate <name> --strict`. OpenSpec artifacts are written in English. A proposal describes one change and how it will be delivered; the guides in `docs/` remain the contract of record and are updated in the same change as the behaviour. Small fixes and routine changes need no proposal.

## Local development

Use **Node.js 24.x >= 24.19.0** and **Bun 1.3.14**; dependencies are pinned in `package.json` and `bun.lock`. Node 24.19.0 is the tested baseline and CI's release gate uses exactly 24.19.0 and a second job runs the newest 24.x; later 24.x releases are accepted but not separately certified. Linux integration was tested with OpenCode 2.1.4 and OpenChamber 2.5.1; native Windows validation used OpenCode 2.1.4 and OpenChamber 2.5.2. Current native runtime tests use the OpenCode baseline below. These are tested configurations, not proof of every newer runtime. Linux package checks also need system `zip` and `unzip`.

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

Some backend runtime tests require an independent OpenCode **2.x >= 2.2.2** binary and Linux isolation tools (`unshare -Urn` and `ip`). OpenCode 2.2.2 is the tested baseline; later 2.x releases are accepted but not separately certified. See the [compatibility guide](docs/compatibility.md#progress-resume-capsule-verification) and the relevant test's prerequisites before running them. Never use a live profile, copy authentication, restart a real instance, or call a paid model just to run a test. Report unavailable prerequisites and skipped checks honestly.

### Portable CI — fresh disposable checkout only

In a **fresh disposable clone** of the revision you want to test, with full Git
history and the toolchain above (the CI workflow uses `fetch-depth: 0`):

```sh
bun install --frozen-lockfile --ignore-scripts
node --experimental-strip-types scripts/ci.ts
```

The legacy-writer fixtures read earlier committed code with `git show`; a source
export without `.git` or a shallow clone missing that history is insufficient.
The helper **refuses a nonempty `build/artifacts` before reading runtime entries or starting checks**. It never deletes existing archives. Do not clear a maintainer's artifact folder to make it run; use a fresh disposable checkout instead. The helper creates `/tmp/opencode` for its fixtures.

It runs root/UI typechecks, portable backend tests, browser-model and automation tests, backend/guest builds with eight-entry parity checks, the SDK's `openchamber-guest-check` against the built package, then package assembly and verification. It explicitly excludes these external-runtime tests:

- `production-runtime.test.ts`
- `plugin-failure-runtime.test.ts`
- `progress-activation-runtime.test.ts`
- `subagent-activity-runtime.test.ts`
- `subagent-upgrade-runtime.test.ts` — isolated built-release upgrade/reload/rollback rehearsal; independent OpenCode binary required, no model or GUI

This is **not native GUI/OpenCode or host-installer certification**. The external host-installer gate is separate, as described below. Full `bun run check` retains the native backend prerequisites; it is not the portable CI command.

The [workflow](.github/workflows/ci.yml) runs on pushes to `main` and `dev`, and on pull requests targeting either branch. It retains the Linux portable checks on exactly Node 24.19.0, repeats them on the newest Node 24 release, and adds a targeted Windows native-filesystem suite. A newer push to a pull request cancels that pull request's earlier run. Versioned publication also waits for the Windows job. Neither job substitutes for actual OpenCode/OpenChamber integration acceptance.

To avoid running each check twice, all three workflows skip their check jobs on
pull requests whose head is this repository's `main` or `dev`: the push checks
already validate that head commit. Feature branches and forks (even forks named
`main` or `dev`) still receive PR checks against the proposed merge. Direct pushes
to both branches retain all checks; `main` push publication is unchanged. For
same-repository `main`/`dev` PRs this deliberately checks the head, not the PR's
synthetic merge commit; the resulting merge is checked on its destination push.
The duplicate PR workflow is still created, but its jobs do no work. GitHub
reports job-condition skips as success, unlike a cancelled check or a workflow
omitted by branch/path filters (which can leave required checks pending). Job and
check names are unchanged. Before adding required checks, account for these
successful skips: a skipped PR job is not evidence that its head's push passed.

Only `main` pushes can publish releases. A `dev` push runs portable checks but is never release-eligible; its publish job may appear as skipped. Accept the candidate on `dev` first, then promote the same commit to `main` after the required gates pass.

### Security scans and action updates

Gitleaks checks pushes and pull requests to `main` and `dev` for secrets; its weekly scan re-checks the default branch's full history. CodeQL analyzes JavaScript and TypeScript on those same events for security problems without a build step. Dependabot checks GitHub Actions versions weekly and opens update PRs; npm/Bun version updates are not configured.

The same duplicate-PR job conditions above apply to security scans; neither push
nor weekly coverage is removed. CodeQL includes test drivers as well as shipped
source, generated bundles and tooling. Data embedded in executable JavaScript
must be encoded as a complete literal (use `javascriptLiteral` for code that may
also appear in an HTML script element); do not wrap interpolated data in quotes.
Deliberate executable test snippets are code, not data to sanitize. Test-only
findings should be reviewed in that context, not dismissed by excluding shipped
paths or broadly disabling queries.

If Gitleaks flags a synthetic test fixture, confirm it cannot be a real credential, then add a narrowly scoped allowlist in `.gitleaks.toml` with a comment naming the file and explaining why the value is synthetic. Never disable the scan or broadly exempt tests. Treat a potentially real credential as a security issue: do not publish it, and arrange private reporting and rotation rather than allowlisting it.

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

The `build` alias runs `build:backend` only; it does not rebuild guests.
`package` copies the accepted guest bundles byte for byte and does not compile them.
Assembly writes the extension and companion folders/ZIPs under `build/artifacts/`; these are local outputs, not files to commit. Verification exercises those folders and ZIPs, checks entries/versions, and runs isolated service and companion lifecycle checks.

`bun run check` combines the root typecheck, backend tests, backend build, package assembly, and package verification. It **does not** include the UI typecheck or browser tests. Use it for relevant integration changes, not as a mandatory gate for a typo or documentation-only PR.

The actual OpenChamber folder/ZIP installer check runs only when `AGENT_PROGRESS_HOST_MODULE` points to an isolated host's `server/lib/guests/install.js`. That module is not supplied by this repository and may come from a separate host checkout/extracted test environment. Without it, package verification reports the host check as not run; do not claim host installation was tested. The Git-distribution gate also needs this module and a disposable source-tree projection: see [distribution validation](docs/setup.md#git-distribution-validation-and-main-promotion). Neither gate authorizes installation into a real host.

### Versioned main promotions and releases

Maintainers must complete the supported native-host Git/folder/ZIP and companion lifecycle gates **before** promoting a runtime version from `dev`. Portable CI does not replace those gates. The approved tree must contain the matching package/RELEASE/compiled versions and accepted built entries.

A **higher numeric `major.minor.patch` package version reaching `main`** makes the included workflow eligible to validate that exact revision and automatically publish a matching `v<version>` tag and release assets: extension/companion ZIPs and checksum inventories. The release name is **`Agent Progress v<version>: <headline>`**. The body contains only the curated notes and editorial contributor credits: no GitHub-generated What's Changed list or automatic Full Changelog footer.

#### Prepare curated release notes

In the version-bump PR, commit `release-notes/<version>.md` (numeric `major.minor.patch`, no `v` prefix or leading zeroes). The first line must be `# <headline>`: one short, plain-text headline only, without the product name or version, trailing whitespace or closing heading markers. The publisher adds the product/version prefix; the complete title must fit 256 UTF-8 bytes. After a blank line, write a nonempty Markdown body:

- Use `## New`, `## Improvements`, `## Fixes`, and `## Misc` as appropriate; omit empty sections.
- Start each bullet with the product area and explain in plain language what changed for the user. Put the few headline items in **bold**, with a sentence explaining their benefit.
- A bullet that comes from an outside contributor's pull request ends with `(thanks to [@login](https://github.com/login))`. Do not tag the repository owner's own pull requests or bots' pull requests. Do not use emojis. Keep the technical Keep-a-Changelog record in `CHANGELOG.md` separate; the publisher does not parse it.

List first-time outside contributors in a final `## New contributors` section, one bullet per person in this form:

```md
## New contributors

- [@contributor](https://github.com/contributor) made their first contribution in #123
```

Omit the entire section when there are none. Credits and first-time status remain **editorial rules checked by the release preparer and reviewer**. On version-bump pull requests and pushes, CI posts a **non-blocking Release credit reminder** in the workflow run's job summary and step output; missing or unexpected credits also get a warning annotation. It can be wrong or unavailable and never gates tests, eligibility or publication. The publisher does not query pull requests.

Before opening the release PR, run `node --experimental-strip-types scripts/release-credits.ts`. An optional `GITHUB_TOKEN` improves the public API rate limit; without one, the command uses unauthenticated reads when the limit allows. It reads the notes at the tested Git commit (locally, HEAD), not uncommitted notes. A failure prints `Release credit reminder could not be produced (data or history unavailable).` and exits successfully. CI uses a separate, `continue-on-error` step with read-only permissions and a token passed only to that step, never to the test suite.

The reminder uses the highest numeric version below the candidate among published, non-draft GitHub releases with a local tag. If reading releases fails, it explicitly reports a fallback to the highest lower local numeric tag; with neither, all reachable history counts. It reads PRs with `state=all` in created order, then selects merged PRs whose merge commits are in the candidate's ancestry but not the baseline's. The API stays pinned to `2022-11-28`, which retains `merge_commit_sha`. Lists are bounded to 20 pages each, ancestry to 100,000 commits, and API work to a 60-second budget. First-time means no PR by that login in baseline ancestry; reverted merges still count, and main-only promotion history need not be reachable on `dev`. Deleted/unresolved authors are listed by PR number for manual review, not treated as a failure. Bots and the repository owner are excluded.

The Markdown mention scan ignores code spans, fenced code, comments and link destinations; it compares whole logins case-insensitively and reports missing/extra New contributors entries. Tag/attribute regions form mention boundaries and are skipped through matching unquoted angle brackets on the same line, or through line end if incomplete. This is a conservative reminder, not a Markdown renderer or proof of attribution: review the rendered notes, first-time status and unresolved authors yourself. API indexing delays, account changes, cherry-picks or rewritten history can make advice incomplete. A local-tag fallback can include stranded tags, which is why the report names its baseline source.

LF and CRLF line endings are accepted. Control/format characters (including tabs and invisible direction controls) and Unicode line/paragraph separators are refused; use ordinary spaces and newlines. The body is exactly the Markdown after the headline, normalized to LF and trimmed at its outer edges. Nothing is appended, and the submitted body ends without trailing whitespace. The complete body must fit 125,000 Unicode characters; no space needs to be reserved for a generated suffix.

Every portable PR/push check validates every notes file in the tested Git revision; a missing directory or README-only directory is valid. When the package version increases compared with the PR base SHA or the push's `before` SHA, that revision must also contain its matching notes file. This catches missing notes on `dev` before promotion. An eligible `main` push rechecks the requirement, and publish reads the file again at the exact candidate SHA **before any API operation**. Same-version pushes do not require historical notes (including 1.0.0); do not backfill them just to pass CI. No notes are read from workflow inputs or the working tree.

The [Create a release REST API](https://docs.github.com/en/rest/releases/releases#create-a-release) receives the derived name and complete Markdown body as JSON with `generate_release_notes: false`. Its response exposes raw `body` separately from rendered fields. The publisher verifies the body immediately after draft creation and on every retry: on both strings, convert CRLF to LF and trim trailing whitespace, then require equality. No leading or internal whitespace is normalized by this comparison. GitHub's documentation does not promise all whitespace round-trip details; this accommodates line-ending and final-whitespace differences without accepting substantive edits. On retry, the exact derived name, bot author, target SHA and owned tag marker are still required, and asset checksums are verified as before. A matching interrupted draft resumes missing uploads and publication; a complete published release is verified read-only. An edited or missing body, mismatching identity or conflicting asset refuses publication; no body, release, tag or asset is overwritten, deleted or replaced.

The entire body is size-checked before any tag is created, but GitHub can still reject release creation for other reasons, or a draft can fail body verification. Inspect the tag and any draft read-only. If a persistent rejection needs corrected content, leave that version's tag unchanged: never delete, move or reuse it by hand. Retrying the same commit resubmits the same content. Correct the notes in a file for a higher package version, prepare matching source/compiled versions and accepted artifacts, and promote through the normal gates. The publisher treats it as a new release with a new tag; the stranded earlier tag or draft remains untouched. Editing notes without increasing the version does not trigger publication, and the new version must still pass all validation and collision checks.

The automation does not bump versions, commit to `main`, or publish to npm. Same-version pushes—including the earlier 0.2.5 launch setup—skip publication without creating a tag or release; an empty release history does not bootstrap one. Version 0.2.6 starts the versioned release sequence; publication requires the exact main revision to pass the workflow. This publication policy is separate from OpenChamber's official-main version notice and the explicitly confirmed companion update/reload flow.

## Before opening a PR

- Explain the user-visible outcome and keep unrelated changes out.
- Add focused regression coverage for meaningful behavior changes; list commands, results, and any skipped checks. For docs-only edits, check local links and documented commands instead of rebuilding runtime bundles.
- For visible UI changes, include sanitized screenshots and relevant interaction checks. Update documentation/contracts when their behavior changes.
- Preserve license notices in copied or bundled third-party code. Adding a dependency or redistributing a bundle needs a license/notice review; the root MIT license does not relicense dependencies. See [third-party notices](THIRD_PARTY_NOTICES.md), including the documented attribution and interpretation limits.
- Review the entire intended diff and attachments for private data. Do not commit databases, bindings, dependencies, generated archives, local instructions, or private evidence.

See [setup and safety boundaries](docs/setup.md), [reporting contracts](docs/contracts.md), and [UI behavior](docs/ui.md) for existing design constraints. Ask in the PR if a technical guide's historical note conflicts with current source; do not silently relax a safety contract to make a check pass.
