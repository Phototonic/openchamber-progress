# Curated release notes

Add one `<version>.md` file with a first-line `# <headline>` and a nonempty
Markdown body when preparing a version bump. The publisher reads the file at the
release commit, names the release `Agent Progress v<version>: <headline>`, and
uses the body as the entire release text, with no generated change list or
trailing whitespace.

See [release preparation](../CONTRIBUTING.md#prepare-curated-release-notes) for
headline limits, New / Improvements / Fixes / Misc sections, user-facing writing
style, editorial contributor credits, validation and the no-overwrite retry policy.
A bullet from an outside contributor's PR ends with
`(thanks to [@login](https://github.com/login))`; do not tag the owner's or bots' PRs.
List first-time contributors in a final `## New contributors` section, one bullet
each: `- [@login](https://github.com/login) made their first contribution in #123`.
Omit that section when there are none. The preparer and reviewer check credits;
CI offers a non-blocking version-bump reminder in the job summary; see release preparation for the local command and limitations.
Historical notes need not be backfilled. A README-only directory is valid.
