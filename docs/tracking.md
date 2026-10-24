# Linear tracking

Linear is the project-work tracker, not a second technical plan. `.slim/plans/agent-progress.md` remains authoritative for design, gates, ownership, and execution approval. Use the existing issues and dependencies below; do not maintain a duplicate status board. A created issue or `PLAN_READY` status is not implementation approval. T3 remains no-go until its canonical gates and separate authorization are satisfied.

## Initiative and project

Workspace: [Phototonic](https://linear.app/voxetra) · Engineering team: `VOX` (`7c8740ff-3da7-4831-8679-bddd611f6791`).

| Tracker | Reference |
| --- | --- |
| Initiative I-6 — OpenChamber Progress | [Open initiative](https://linear.app/voxetra/initiative/openchamber-progress-84bfdc6b7b92) · `e9262419-74ce-49cd-b3f7-cfab8f2b3f93` |
| Project P-VOX-17 — OpenChamber Progress V1 | [Open project](https://linear.app/voxetra/project/openchamber-progress-v1-b51f13fcf127) · `e4dd0f6a-5e27-4ba3-a4b4-7388db1e2878` |

The initiative is workspace-level because team-owned initiative creation required a Business plan; the project is linked to it, with no billing changes. Their current Active / In Progress labels represent compatibility investigation only, not approval for the full build. No dates, estimates, or assignees were invented.

## Milestones and work map

| Milestone | ID | Existing issue scope |
| --- | --- | --- |
| M1 — Feasibility and compatibility | `312bce8a-ad24-47f0-af80-c05c71bbd72d` | [VOX-359](https://linear.app/voxetra/issue/VOX-359) plan/scope and G0 review; [VOX-360](https://linear.app/voxetra/issue/VOX-360) accepted backend registration/storage T1 subset; [VOX-357](https://linear.app/voxetra/issue/VOX-357) accepted desktop SDK/service probe T2; [VOX-358](https://linear.app/voxetra/issue/VOX-358) credential-safe live-test setup under M1 amendment; [VOX-361](https://linear.app/voxetra/issue/VOX-361) remaining live caller/native/slim/resume T1 compatibility. |
| M2 — Capture, storage and global setup | `0b2f9db8-ac34-4888-84c5-c51bf00d7aca` | [VOX-362](https://linear.app/voxetra/issue/VOX-362) production capture/document/store T3; [VOX-363](https://linear.app/voxetra/issue/VOX-363) safe global install/lifecycle T3. |
| M3 — Progress views | `4cea3410-aa9e-4ac5-a7d6-2e0bb159fd22` | [VOX-364](https://linear.app/voxetra/issue/VOX-364) Designer-owned three production views T4. |
| M4 — Packaging and validation | `8fbc2844-80a1-4107-ba31-008a663ef514` | [VOX-365](https://linear.app/voxetra/issue/VOX-365) packaging/docs T5; [VOX-366](https://linear.app/voxetra/issue/VOX-366) Designer QA6 and parent J1 final verification. |

Linear owns the live statuses and dependency graph. Read the actual issue state (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, or `Canceled`) rather than copying a status snapshot here. Keep issues synchronized with evidence when work actually starts, a handoff is accepted, a material blocker appears, or authorized scope changes. Do not mark a parent complete merely because a child issue succeeded; retain dependencies and distinguish completed probe evidence from remaining gates.

Put technical evidence in the repository, under `evidence/compatibility` where applicable. In Linear, use a sanitized summary and repository-relative references to the canonical plan or evidence; never include credentials, private filesystem paths, or raw logs. Passive hybrid capture remains a later roadmap direction, not V1 execution scope.
