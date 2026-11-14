## MODIFIED Requirements

### Requirement: Deliberate delegation before assigned work

Companion guidance SHALL direct coordinators to declare known plan/task assignments before supported child dispatches and provide reporting context. Declaration MUST require the current expected revision. Binding MAY tolerate intervening unrelated task reports only with complete bounded evidence that declared tasks, assignments, structure, lifecycle and authority remain valid. Declaration, dispatch and native activity MUST NOT set task status or grant child authority before verified binding. Explicit linking and honestly attributed relay SHALL remain available without relaxing host restrictions.

#### Scenario: Declared task dispatch
- **WHEN** a coordinator declares existing task IDs at the expected revision and supported dispatch yields verified matching child identity
- **THEN** the binding mechanism records the assignment and provenance
- **AND** task status, counts and reported progress remain unchanged until a deliberate report

#### Scenario: Sibling reports before the next child binds
- **WHEN** task A's verified child reports while task B has a pending declaration, and complete intervening evidence shows only unrelated progress
- **THEN** B's supported dispatch can bind under the current transaction revision without losing the declaration
- **AND** the original declaration/replay identity and all source/ancestry/assignment checks remain unchanged

#### Scenario: Binding conflicts or cannot be verified
- **WHEN** a declared task was touched, even if restored later, structure/lifecycle/assignment changed, or bounded proof is incomplete
- **THEN** binding refuses visibly instead of blindly rebasing or transferring intent to another dispatch
- **AND** the waiting note retires and coordinator recovery guidance identifies the refusal

#### Scenario: Authority invalidated
- **WHEN** source, ancestry, cleanup or capture evidence no longer permits binding
- **THEN** the intent does not grant authority or cross plan/task/source boundaries
- **AND** no task report or automatic repair is fabricated
