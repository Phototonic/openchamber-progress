# Curated release notes

Add one `<version>.md` file with a first-line `# <headline>` and a nonempty
Markdown body when preparing a version bump. The publisher reads the file at the
release commit, names the release `Agent Progress v<version>: <headline>`, and
prepends the body to GitHub's generated notes.

See [release preparation](../CONTRIBUTING.md#prepare-curated-release-notes) for
headline limits, New / Improvements / Fixes / Misc sections, user-facing writing
style, contributor credits, validation and the no-overwrite retry policy.
Historical notes need not be backfilled. A README-only directory is valid.
