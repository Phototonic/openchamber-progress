# Show the session’s linked work beside its plan

## Why

Today a reader can find OpenChamber’s linked issue and change titles under **More → Sessions**, but cannot open them there or see them when reading a plan. Putting the main session’s links next to the selected plan makes it easy to compare a report with the work it refers to. A link is context from OpenChamber, not verification that anything shipped.

## What changes

- Show small, read-only chips in the existing selected-plan header on the fullscreen board and session rail. Use the main session of the displayed plan, not the chat that happens to be open. Keep the existing per-participant details in Sessions.
- Label the chips as host-supplied; show nothing when there is no usable context. Only intentional activation of an admitted web address asks OpenChamber to open it.
- Modify `session-progress-context`: allow this narrow navigation exception to its text-only metadata rule. The shared header, four views and menus from `refresh-progress-layout` keep their order.

## Scope and non-goals

The change is confined to the guest’s existing session adapter, the two reading surfaces, their tests and UI documentation. No Work Status chips, new card, banner, notice, edit/link action, report field, service route, permission, dependency, storage or provider lookup. No change to plan selection, assignments, progress counts, exports or host-version floor.
