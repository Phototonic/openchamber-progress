# Spec Delta

## Purpose

Make reported prerequisite states recognizable on dependency-map arrows in the board and rail without implying measured progress or live execution, while preserving accessible static cues and bounded rendering cost.

## ADDED Requirements

### Requirement: Eligible pictures govern arrow state

New working and blocked arrow cues SHALL appear only for an active, unarchived plan with a current, consistent displayed picture. Otherwise the map SHALL keep its existing ordinary, done and skipped arrow treatments and existing unavailable-picture behavior.

#### Scenario: Current active picture
- **WHEN** an active, unarchived plan has a current matched map picture
- **THEN** visible task-to-task arrows are classified by the reported endpoint states in that picture
- **AND** another frame's picture, session activity and report age do not influence classification

#### Scenario: Read failure or superseded picture
- **WHEN** a read fails, a stale reading invalidates the current picture, or a newer revision is still being matched
- **THEN** any retained picture has no new working beads or blocked stop bars and no arrow animation
- **AND** the existing warning or Updating explanation and ordinary reported card statuses remain

#### Scenario: No usable picture
- **WHEN** the map is loading without a picture, unavailable or not found
- **THEN** no arrow state or animation is drawn

#### Scenario: Closed or archived plan
- **WHEN** a plan is completed, cancelled, failed or archived, even with tasks still reported working or blocked
- **THEN** its map uses the pre-existing static arrow styles only

### Requirement: Working dependencies have a distinct beaded treatment

On an eligible picture, an arrow from a working prerequisite to a pending or blocked dependent SHALL use blue round beads over a faint blue line with a blue arrowhead, except for selection and forced-colour overrides. Other outgoing working arrows SHALL retain their ordinary style.

#### Scenario: Waiting dependent
- **WHEN** a working prerequisite points to a pending task
- **THEN** that arrow has the working treatment, including when another prerequisite makes the dependent read Waiting on skipped task
- **AND** the dependent's status and readiness do not change

#### Scenario: Explicitly blocked dependent
- **WHEN** a working prerequisite points to an explicitly blocked task
- **THEN** the arrow has the working treatment without suggesting that the dependent's blocker has cleared

#### Scenario: Working or terminal dependent
- **WHEN** a working prerequisite points to a working, done or skipped task
- **THEN** that arrow has no beads and retains its ordinary static style

### Requirement: Explicitly blocked prerequisites have a static stop treatment

On an eligible picture, an arrow from an explicitly blocked prerequisite to a pending, working or blocked dependent SHALL have a solid warning-colour line and a stop bar immediately before its arrowhead. This treatment SHALL never pulse or flow, and SHALL NOT imply that the dependent itself is blocked.

#### Scenario: Unfinished dependent
- **WHEN** a blocked prerequisite points to a pending, working or blocked task
- **THEN** the arrow has the static blocked treatment and the dependent retains its reported status

#### Scenario: Terminal dependent
- **WHEN** a blocked prerequisite points to a done or skipped task
- **THEN** the arrow retains its ordinary static style without a stop bar

### Requirement: Unchanged relationships keep existing styles

Arrows from done prerequisites SHALL remain quiet, arrows from skipped prerequisites SHALL remain dashed, and arrows from pending prerequisites SHALL remain ordinary and static. Hidden endpoints SHALL hide all presentations of the arrow. No treatment SHALL add a relationship or change graph counts or geometry.

#### Scenario: Other prerequisite states
- **WHEN** an arrow starts at a done, skipped or pending prerequisite, regardless of the dependent's reported state
- **THEN** its existing quiet, dashed or ordinary treatment respectively remains, subject to existing selection overrides

#### Scenario: Filtered endpoint
- **WHEN** either endpoint is hidden by a task or group filter
- **THEN** the line, beads, stop bar and arrowhead are all hidden without changing the full-plan arrow count or layout

### Requirement: Flow signals reported work rather than progress

Eligible motion SHALL move beads steadily from prerequisite to dependent in a repeating linear 2.4-second cycle, sharing the existing reported-work animation phase. It SHALL NOT fill an arrow, encode a percentage, vary with elapsed time or imply that a session is executing now.

#### Scenario: Loop and repaint
- **WHEN** a working arrow animates through a full cycle or its frame repaints
- **THEN** its bead pattern repeats seamlessly without accumulating fill or changing speed
- **AND** it remains aligned with that document's shared reported-work phase rather than restarting at the repaint

### Requirement: Motion has an explicit freshness and visibility gate

Arrow motion SHALL additionally require a successful latest read, capture enabled, at least one reported working task, Map shown, a visible non-disposed frame, permitted motion preferences and the rendering-cost gate. Missing motion permission SHALL default to off. Suppressing motion alone SHALL retain eligible static cues.

#### Scenario: Capture disabled on a current picture
- **WHEN** capture is disabled while the eligible map picture remains current
- **THEN** beads remain stationary and blocked arrows remain static
- **AND** same-revision capture re-enable resumes motion only after the existing read and picture gates permit it

#### Scenario: Missing or stale permission
- **WHEN** the renderer has no affirmative motion permission, or the latest read is not successful
- **THEN** it starts no arrow animation
- **AND** new static cues remain only if the picture itself still satisfies the eligible-picture requirement

#### Scenario: Hidden, left or disposed frame
- **WHEN** a frame is marked hidden, Map is left, or the frame is disposed
- **THEN** no arrow animation remains active, including animations on descendants or pseudo-elements
- **AND** becoming visible or reopening Map can resume only after picture revalidation, on the shared document phase

### Requirement: Reduced motion and forced colours retain meaning

Reduced motion SHALL remove all arrow animations while leaving eligible working beads stationary and the blocked stop bar visible. Forced colours SHALL preserve bead, bar and dash distinctions using system colours, including with reduced motion enabled. Pans, zooms and anchoring SHALL remain instant.

#### Scenario: Reduced motion changes while Map is open
- **WHEN** reduced motion is enabled during a working flow
- **THEN** the map has no running animations or animated transitions
- **AND** working, blocked and ordinary arrows remain distinguishable by stationary patterns

#### Scenario: Forced colours without motion
- **WHEN** forced colours and reduced motion are both enabled
- **THEN** working arrows show system-colour round beads, blocked arrows a thicker line and stop bar, and skipped arrows their dash pattern
- **AND** selected-chain arrows retain system highlight without losing their state shapes

### Requirement: Selection preserves both relationship and state

Selection-chain arrows SHALL keep chain colour, emphasis and visual priority while retaining beads or stop bars where applicable. Off-chain arrows SHALL recede as before and their beads SHALL be stationary. Selection SHALL NOT alter arrow classification or reported task status.

#### Scenario: Selected chain includes working and blocked prerequisites
- **WHEN** a task is selected with working and blocked arrows on its chain and working arrows off-chain
- **THEN** chain working beads can move if all other gates permit, its blocked bar stays visible and static, and off-chain beads stop and fade
- **AND** clearing selection restores eligible motion on the shared phase without changing viewport geometry

### Requirement: Arrow meaning has a textual equivalent

Arrows SHALL remain decorative and absent from accessible names and focus order. Map help SHALL explain working beads, blocked bars, skipped dashes and quiet done arrows, including that looping motion means reported work, not progress. A current waiting task's inspector SHALL summarize working and explicitly blocked direct prerequisites without new motion announcements.

#### Scenario: Waiting-task summary
- **WHEN** a selected pending task on an eligible picture has three unfinished direct recorded prerequisites, one working, one blocked and one pending
- **THEN** the inspector communicates “Waiting on 3 unfinished recorded prerequisites: 1 reported working, 1 explicitly blocked.”
- **AND** counts include prerequisites hidden by filters, count each direct task once, exclude transitive/group relationships, omit zero subcounts and preserve singular wording

#### Scenario: Skipped prerequisite
- **WHEN** the waiting task also has a skipped prerequisite
- **THEN** the inspector preserves the skipped-work warning alongside any working/blocked summary

#### Scenario: Unavailable guidance
- **WHEN** the picture loses current guidance or the plan closes
- **THEN** no new waiting-state summary is presented as current
- **AND** the existing historical/pending explanation and relationship list remain

#### Scenario: Accessible navigation and silence
- **WHEN** motion starts, stops or changes phase during a repaint
- **THEN** card accessible names, keyboard navigation, focus and the map live region do not change because of motion
- **AND** keyboard users can read the arrow key through the existing Map help disclosure and use the ordinary list alternative

### Requirement: Expensive maps have a deterministic static fallback

Motion SHALL stop, leaving stationary beads, above 300 full-plan arrows, above 24 eligible visible flows, or below 50% zoom. An implementation MAY use tighter limits while preserving normal small and reference mid-size motion; shipped limits SHALL be documented in `docs/ui.md`. Hidden endpoints and off-chain flows are excluded only from the eligible-flow count. When fallback applies, no animation SHALL be running within the map.

#### Scenario: Large plan and low zoom
- **WHEN** the 980-task, 2,000-arrow fixture is opened or fitted to the canvas, or an otherwise eligible map is zoomed below the chosen minimum
- **THEN** every working bead pattern stays visible but stationary, with zero running animations within the map
- **AND** filtering or selection cannot bypass the full-plan arrow ceiling

#### Scenario: Too many flows
- **WHEN** the eligible visible flow count exceeds the chosen limit
- **THEN** all working beads are stationary with zero running animations within the map, rather than animating an arbitrary subset

#### Scenario: Shipped boundaries
- **WHEN** a count or zoom crosses a shipped limit with all other gates satisfied
- **THEN** motion is permitted at the inclusive count ceiling or minimum zoom and stops on the excluded side
- **AND** tighter shipped limits never permit motion beyond 300 full-plan arrows, 24 eligible visible flows or below 50% zoom

#### Scenario: Returning within bounds
- **WHEN** filters, selection or zoom bring every bound back within its inclusive limit
- **THEN** eligible beads resume on the shared phase without a new read or periodic computation

#### Scenario: Normal small and mid-size plans
- **WHEN** ordinary 5–15-task plans at readable zoom, or the reference plan with 100 tasks, 180 arrows and 12 eligible flows at 75% zoom, meet all non-cost gates
- **THEN** qualifying arrows animate in both board and rail
- **AND** task count alone does not disable motion; dense small plans remain subject to the flow-count bound

### Requirement: Animation uses bounded rendering work

Arrow animation SHALL be CSS-only on SVG paths, limited to stroke-dashoffset, opacity or transform. It SHALL introduce no animation-driven script loop, layout or requests.

#### Scenario: Steady flow
- **WHEN** an eligible arrow animates between user actions and report updates
- **THEN** only the permitted SVG properties animate, with no periodic JavaScript animation work, layout or extra service traffic

### Requirement: Existing large-plan responsiveness is preserved

The dependency map SHALL continue to meet its existing large-plan load, interaction and revision-observation budgets with the static arrow cues present. Motion fallback SHALL NOT change graph geometry, request retirement or task navigation.

#### Scenario: Existing large-plan responsiveness
- **WHEN** large-plan load, interaction and revision replay checks run at normal CPU with the new cues present
- **THEN** existing 2,000 ms median load, 500 ms median action and 8,000 ms revision-observation budgets continue to pass
- **AND** status-only coordinates and screen positions remain stable and hidden reads do not continue or paint
