# Triage labels

Each canonical role uses the same label string in GitHub.

- `needs-triage`: waiting for maintainer review.
- `needs-info`: waiting for more information from the reporter.
- `ready-for-agent`: specified well enough for an agent to implement.
- `ready-for-human`: ready for a human to implement.
- `wontfix`: will not be pursued.

`needs-info` and `wontfix` already exist upstream. `needs-triage`, `ready-for-agent`, and `ready-for-human` need to be created by someone with label-management permission. Check label availability before applying it. If a label is unavailable, report the limitation instead of substituting a different label or writing to the fork.
