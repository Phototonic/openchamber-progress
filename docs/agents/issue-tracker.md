# Issue tracker: GitHub

Track work in [Phototonic/openchamber-progress Issues](https://github.com/Phototonic/openchamber-progress/issues). `origin` may be a contributor fork. Always pass `--repo Phototonic/openchamber-progress` to `gh issue` commands so the fork is not used as the tracker.

- Read a ticket: `gh issue view <number> --repo Phototonic/openchamber-progress --json number,title,body,labels,comments`.
- Search before publishing: `gh issue list --repo Phototonic/openchamber-progress --state all --search '<query>'`.
- When asked to publish a ticket, use `gh issue create --repo Phototonic/openchamber-progress --title '<title>' --body-file <path>`. Follow the repository's [reporting guidelines](../../CONTRIBUTING.md#report-a-problem-safely) and use only sanitized examples.
- Use `gh issue comment`, `gh issue edit`, or `gh issue close` with the same explicit repository only when authorized and permitted. Explain why before closing an issue.
- When needed, use GitHub sub-issues and native dependencies if available. Otherwise put `Part of #<parent>` or `Blocked by: #<issue>` in the issue body.

**PRs as a request surface: no.**
