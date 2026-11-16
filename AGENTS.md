# Agent instructions

Guidance for AI coding agents working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md); it is the authority for setup, branches, checks and releases, and this file only highlights the rules agents most often get wrong.

## Project shape

- TypeScript is the source of truth. `dev` carries source only; Git installs use generated JavaScript tracked on `main` and release tags.
- Durable behaviour and architecture contracts live in `docs/` (`contracts.md`, `backend.md`, `ui.md`, `setup.md`, `compatibility.md`). When you change behaviour, update the relevant doc in the same change. Do not relax a documented safety contract to make a check pass; raise the conflict instead.

## Built outputs

- Nine generated outputs: `build/service/main.js`, `build/setup/main.js`, `build/companion/{index.js,package.json,SKILL.md}`, `background/main.js`, and `ui/{panel,status,page}/main.js`.
- Never commit these outputs to `dev` or a PR targeting anything but `main`. They are ignored; resolve old bundle modify/delete conflicts by keeping the deletion.
- Run `bun run build:all` before standalone tests or drivers that read outputs. Source-capable rendered drivers can use `--source` instead for guests; build first if they also use the service.
- CI builds source revisions before tests and checks a second build for reproducibility. Distribution revisions must track all nine and equal a rebuild.
- Maintainers use `bun run promote <main-revision> <dev-revision> <new-branch>` (see CONTRIBUTING) to produce a local two-parent promotion commit. It never pushes, tags or publishes. Never merge `main` into `dev`.
- Do not commit `build/artifacts/`, dependencies, databases or logs.

## Branches and versions

- Branch from `dev` and target `dev`. `main` is the versioned distribution branch.
- Do not bump versions in a routine change. Local outputs are disposable; never hand-edit them.

## Checks

Pick the smallest relevant set from [CONTRIBUTING.md](CONTRIBUTING.md#local-development), for example:

```sh
bun run typecheck
bun run tsc --noEmit -p ui/tsconfig.json
node --experimental-strip-types --test tests/backend/<name>.test.ts
node --experimental-strip-types --test tests/browser/*.test.ts
```

- Wrap long test runs in a timeout; some backend runtime tests need native prerequisites and can hang or skip without them.
- Never use a live OpenCode/OpenChamber profile, copy authentication, restart a real instance or call a paid model to run a test.
- Report skipped or unavailable checks honestly; do not claim host installation was tested unless it was.

## Public output

Everything committed or published (files, generated bundles, commit messages, branch names, PR text, screenshots, examples) is public and permanent.

- No secrets or authentication material. Gitleaks scans every push and PR; never disable it or broadly allowlist tests (see CONTRIBUTING for the narrow fixture exception).
- No personal or environment details: home-directory paths, usernames, hostnames, email addresses, IP addresses, machine names, or private repository and tracker references. Use synthetic names and paths.
- No raw logs; share only minimal, sanitized excerpts.
- Review the whole diff and PR metadata for private data before pushing.
- Keep AI review transcripts out of commits and PRs unless the maintainer asks for them.
