## ADDED Requirements

### Requirement: The development branch carries source only

The generated runtime outputs (the service, setup and companion entries under `build/`, the background script and the three guest bundles) SHALL NOT be tracked on the development branch or in a pull request into any branch other than the distribution branch. Git SHALL ignore them there, so a local build leaves the working tree clean. A check SHALL fail when such a revision tracks any of them.

#### Scenario: Fresh checkout of the development branch
- **WHEN** the development branch is cloned
- **THEN** none of the generated outputs is present or tracked
- **AND** building them leaves the working tree clean

#### Scenario: An output is committed again
- **WHEN** a pull request into the development branch tracks a generated output, whether carried over by a rebase or brought in by merging the distribution branch
- **THEN** its portable check fails and names the tracked output

#### Scenario: Two pull requests change shared interface source
- **WHEN** two open pull requests change source that the same guest bundle is built from
- **THEN** neither contains that bundle
- **AND** merging one does not make the other conflict on a generated file

### Requirement: Checks build outputs before reading them

On a revision that tracks no generated output, portable checks SHALL build every generated output from that revision before any test, package, readiness or verification step reads one. A second build of the same revision SHALL produce identical bytes, and the check SHALL fail when it does not. A check that needs an output MUST fail, not skip or pass, when that output is absent.

#### Scenario: Portable checks in a fresh checkout
- **WHEN** portable checks run in a fresh full-history checkout of a development revision with a cleared environment
- **THEN** the outputs are built first
- **AND** tests, package assembly and package verification run against that build

#### Scenario: Build is not reproducible
- **WHEN** the second build differs from the first in any output
- **THEN** the check fails and names the output

#### Scenario: Native Windows suite
- **WHEN** the Windows suite runs on a development revision
- **THEN** the service entry it starts was built from that revision in the same job

#### Scenario: Documentation-only pull request
- **WHEN** a pull request changes only documentation or proposal text under the existing rule
- **THEN** its check jobs are still skipped and nothing is built

### Requirement: Promotion commits outputs built from the promoted source

Promotion SHALL produce one commit whose parents are the distribution branch tip and the accepted development revision, and whose tree is that development revision plus the generated outputs built from it and nothing else. The promotion command SHALL act on the local repository only: it MUST NOT push, tag or publish. It SHALL refuse, leaving no promotion commit, when a precondition fails.

#### Scenario: First promotion after the change
- **WHEN** the development revision has removed the outputs that the distribution branch still tracks
- **THEN** the promotion commit tracks every output, built from the promoted source, with version stamps equal to the package version

#### Scenario: A later promotion
- **WHEN** a further development revision is promoted after an earlier promotion
- **THEN** the promotion completes with no merge conflict in any generated output
- **AND** the committed outputs are those of the newly promoted source

#### Scenario: The distribution branch holds a change the development branch lacks
- **WHEN** the promoted tree would differ from the development revision in anything other than the generated outputs
- **THEN** the command refuses and names the differing paths

#### Scenario: Unsafe starting state
- **WHEN** the working tree has uncommitted changes, the development revision tracks an output, or the build fails
- **THEN** the command refuses and both branches are unchanged

### Requirement: The distribution branch always matches a rebuild of its source

Every pull request into the distribution branch and every push to it SHALL be checked strictly: all generated outputs are tracked and each equals a fresh build of that revision. A pull request into the distribution branch SHALL always run these checks, including one opened directly from the development branch. Release eligibility, validation of the exact pushed revision and publication SHALL stay as they are.

#### Scenario: Promotion pull request
- **WHEN** the promotion commit is proposed to the distribution branch
- **THEN** the checks run on its merge result and pass only if every output equals a rebuild

#### Scenario: Development branch proposed directly
- **WHEN** a pull request is opened from the development branch into the distribution branch
- **THEN** its checks are not skipped as a duplicate
- **AND** they fail because outputs are missing or stale

#### Scenario: Stale or missing outputs reach the distribution branch
- **WHEN** a push to the distribution branch has an output that is missing or differs from a rebuild
- **THEN** the check fails and no release is published for that revision

#### Scenario: Version increase reaches the distribution branch
- **WHEN** a promotion with a higher package version and its release notes is pushed
- **THEN** the existing eligibility rules read the compiled versions from that exact revision
- **AND** publication proceeds as before

### Requirement: What users install does not change

Git installations from the default branch, from `#main` and from a release tag, and the release ZIP assets, SHALL contain the same entries as before and SHALL need no consumer build or dependency installation. The development branch SHALL NOT be offered as an installable ref.

#### Scenario: Install from the distribution branch after a promotion
- **WHEN** a host installs or updates from the default branch or a release tag
- **THEN** it receives the declared companion folder and the service, setup, background and guest entries
- **AND** it runs them without building

#### Scenario: A ref without built entries is selected
- **WHEN** a host is asked to install or update from the development branch
- **THEN** the host refuses the package
- **AND** an existing installation keeps its files and state
