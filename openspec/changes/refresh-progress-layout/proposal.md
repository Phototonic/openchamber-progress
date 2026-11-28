# Put browsing, plan actions and reading in their own places

## Why

The board puts search, filtering and cleanup together above the plan list. The rail and board hide common copy actions alongside settings in More. Reading the saved document uses only part of a tall frame, and changing views can lose the reader's place.

## What Changes: layout option B

| Surface | Layout |
|---|---|
| Fullscreen board: top bar | Title, wide search field for plans and tasks, and Hide quiet beside the field. Retain a compact Filters trigger: it also holds Current/Archived, location and search criteria. At the right, show the all-plans Needs you count and Settings gear. The count opens the only board inbox on All plans, with This plan available inside; remove the duplicate section beneath the plan. |
| Board: sidebar | Plain plan rows grouped by project, with progress bars. Put the active count and Select in the list header, and one Tidy control beside the Finished area. Do not crowd search or other controls above the list. |
| Board: selected plan | Title and one metadata line, then Copy update (the only primary button), Handoff note and plan More. Below progress, use one segmented control: **Map / List / Document / History**. When Map is selected, keep its zoom controls at the right of that row on the wide board. |
| Session rail | Plan switcher line with Settings gear and plan More. Give **Copy update** and **Handoff note** one full-width button each, then use the same four views in one full-width segmented control below progress. |
| Menus on both surfaces | **Plan More:** Sessions and, for an eligible plan, Finish as cancelled; no other entries. **Settings:** Language, Setup and Troubleshooting only. History is a view of the selected plan, not a menu item or a library feed. The rail shows recorded updates; the digest and review actions remain board-only. |

On both surfaces, Document fills the available reading height. Its one-line header contains Back and the filename; the capture age is a short note such as “Saved 22 h ago”. Wide tables scroll sideways in their own box. Keep the current plan's Map, List and Document positions separately in frame memory when switching views; discard them on a plan change or newer capture. Reserve space for the progress legend so task detail arriving late does not move History's Refresh button.

Use one type scale and header pattern, consistent control heights and spacing, and quieter surfaces instead of a border around each group. Use only OpenChamber host colour tokens for the theme; retain system colours in forced-colour mode. Add no cards, banners or multi-line notices. Keep messages to one short line of copy and allow reflow rather than clipping essential text at zoom.

## Visual acceptance before the pull request

Preserve phone layout and touch targets, keyboard and focus order, screen-reader names and states, 200% and 400% zoom, forced colours, and English, Russian and Simplified Chinese (`en`, `ru`, `zh-CN`) text lengths. Use the existing rendered drivers and isolated kit to capture matched **before and after Chromium screenshots** of board and rail, wide and narrow, dark and light, including a narrow zh-CN pair. The owner must approve the candidate screenshots **before the PR opens**; passing automated checks does not substitute for that approval.

## Capabilities

**New:** None.

**Modified:** `progress-surface-hierarchy` (headers, views and reading); `needs-you-inbox` and `device-remembered-view-state` (board entry, scope and initial expansion); `closed-plan-tidy` and `plan-selection-actions` (cleanup entry points); `interface-localization` (language entry); `dependency-map-view-controls` and `phone-progress-surfaces` (shared view row and responsive order).

## Scope

**IN:** The fullscreen board and session rail, their shared guest presentation and existing rendered checks; corrections to the UI guide and user-facing navigation instructions.

### Must NOT have

No change to action effects, authorization, confirmation, bulk target scope, search matching, report or capture semantics. No cross-plan history, rail review tools, new storage record, backend/protocol/schema or permission change. No redesign of Work Status, setup flows or map cards; no new palette, cards, banners, multi-line notices, dependency or settings framework. No release, version bump or generated development-branch outputs.
