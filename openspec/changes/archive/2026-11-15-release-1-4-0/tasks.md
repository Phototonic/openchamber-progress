# Tasks

This archive records shipped implementation, not blanket certification of every original acceptance scenario. The detailed contracts remain in the capability specs and shared guides. Native promotion and deferred device checks remain distinct from portable release preparation.

## Shipped implementation

- [x] Pin build SDK 2.7.1 without raising the OpenChamber 2.7.1 floor or changing plugin SDK 2.1.4; reconcile manifest and fixture contracts (#104).
- [x] Add bounded source-wide Needs you reads, explicit coverage and continuation, separate Also blocked classification, blocker timing and canonical task reveal without writes or a new polling loop (#102).
- [x] Add the rail/board inbox and source/context retirement through existing controller owners, with source-built browser fixtures and documented evidence limits (#102).
- [x] Implement phone layout/device hooks, safe-area and keyboard accommodation, coarse-pointer controls and a tap/pan/pinch dependency map; add browser touch/layout regressions (#104).
- [x] Ship rail and board mobile opt-ins by owner decision (#112), replacing the pre-release physical-phone gate, not claiming physical acceptance; check physical phones on the live release, with a hotfix if needed.
- [x] Preserve pending delegation across provably unrelated sibling reports, retaining declaration identity and refusing relevant, incomplete or legacy conflicts; explain identifiable refusals (#103).
- [x] Expose independently refreshed waiting/refusal state without assignment or progress inference; show “Next sub-agent will take this” only for eligible pending intent (#107).
- [x] Allow explicit final task changes with coordinator finish in one revision/transaction, preserving validation, authority and replay rules (#105).
- [x] Install and validate the ordinary receipt index transactionally; retain replay meaning and released-writer compatibility, with query-plan and representative cost checks (#106).
- [x] Integrate cheap Windows health, on-demand admission, bounded request-driven legacy migration, private durable progress, explicit pause/resume, capture semantics, compatibility refusal and precise Setup diagnostics (#101, fixes #99).
- [x] Add Windows step/HTTP and browser regressions; keep native Windows CI distinct from portable accounting and browser emulation (#101).
- [x] Pass native Windows step-migration gates: GitHub Actions **Windows setup, storage and capture** on final #101 head `b31b3a3` passed released 1.1.1 to managed migration in undelayed and 2.5-second-helper modes, with at most 6 security spawns per request, slowest successful requests of 2.6 seconds and 15.4 seconds respectively, and zero-spawn health. This records that tested head, not a new final-candidate Windows run.
- [x] Complete executed J2 real-host journeys on dev `e6a2dc3`: 38/38 journey checkpoints, 6/6 safeguards and built-native regression 1/1, with OpenChamber 2.7.1 and OpenCode 2.2.7. Covered real dispatch/direct attribution, pending/reserved/conflicted delegation, atomic finish/replay, source-wide inbox and task reveal, English/Russian/Chinese presentation, session-action reset, composer actions, session-switch held-reply retirement and browser reconnect. The isolated host evidence summary records clean process teardown and no live profile, credentials or paid model; no raw logs are copied here. Distinct host/source switches and physical phones remain untested.
- [x] Add Simplified Chinese interface and summaries, without translating recorded user text (#108).
- [x] Refresh shared contract/backend/UI/setup/compatibility guides and companion guidance with the merged features; retain original native evidence scopes (#100–#108).

## Release preparation

- [x] Prepare matching 1.4.0 package/source/compiled versions, curated notes, contributor credits and technical changelog; regenerate affected entries through repository scripts.
- [x] Run root/UI typechecks and strict all-spec OpenSpec validation; replace generated Purpose placeholders and preserve existing contracts while shortening overlong requirement text.

Final-candidate portable CI (including SDK/package validation and nine-entry parity), the local main-push eligibility/asset/name/body rehearsal, public-diff review and contributor reminder are release-prep PR verification gates. Their results belong to the tested commit and PR verification record, not an inferred feature-acceptance claim in this archive. Publication and main promotion remain maintainer decisions.

## Deferred acceptance and out-of-scope follow-up

- [ ] Physical-phone app/browser acceptance: explicitly deferred by the owner to the live release. Both mobile contributions ship under that decision; narrow/touch emulation is not a physical-device pass. Check the actual host routes, rotation/keyboard behavior and retained same-session action limitation there.
- [ ] Host switching and source switching with a held reply: not run against a real second host or genuinely distinct source in J2. The executed session-switch journey does not establish either case.
- [ ] Final joined native-host Git/folder/ZIP installation, below-floor refusal, companion lifecycle/upgrade/rollback and final-candidate Windows checks: retain their actual evidence scopes and satisfy CONTRIBUTING before main promotion. The completed #101 Windows gate and J2 journeys above are prior-head evidence; a portable pass alone does not certify final native distribution gates.
- [ ] Fresh Windows configuration on the step engine: out of scope for 1.4.0. The existing synchronous fresh review/confirm flow can exceed the host timeout with slow PowerShell, as documented in Setup. This is not a completed migration-step capability.

Conditional host-drawn Work Status research was not needed for the shipped shared-layout implementation; no replacement status implementation is included. Native evidence is limited to the tested heads and executed journeys above; no physical-device or live-profile test is claimed by this archive.
