## ADDED Requirements

### Requirement: Read-only Markdown in the Plan document panel

The sidebar and Pages → Agent Progress SHALL present the same formatted preview when readable captured text is identified by a saved document reference with a `.md` suffix, matched case-insensitively. Documents with other suffixes or no path SHALL remain literal text. Checklist marks SHALL convey checked and unchecked states without being operable. Viewing the document MUST NOT write to the source file, stored capture, or task progress.

#### Scenario: The same Markdown plan on both surfaces

- **GIVEN** a capture named `sample-plan.md` with this content:

  ```markdown
  # Sample plan

  ## Next steps

  - [x] Write the draft
  - [ ] Review the draft

  **Note:** Review the sample only.
  ```

- **WHEN** the user opens Plan document in the sidebar and in Pages → Agent Progress
- **THEN** both views show equivalent headings, a task list with distinguishable checked and unchecked marks, and a bold `Note:`
- **AND** neither pointer nor keyboard input can toggle a mark, and viewing leaves the file, capture, and reported progress unchanged

#### Scenario: The same text in a non-Markdown capture

- **WHEN** the user opens the same content captured as `sample-plan.txt` or with an unknown suffix in each surface
- **THEN** each surface shows literal text, including `#`, `- [x]`, `- [ ]`, and `**`

### Requirement: Preview preserves captured-version semantics

Both previews SHALL consume only the saved text returned by the existing on-demand document read. They MUST NOT read the live file, initiate capture, or change the API, storage, permissions, or capture lifecycle. Existing loading, retry, no-text, capture warnings, and synchronization qualifications SHALL remain visible when applicable. The board's comparison of recorded captures SHALL remain literal and separate from the preview.

#### Scenario: Source file differs from the recorded copy

- **WHEN** the bound file changes after capture without a new report and the user opens Plan document in each surface
- **THEN** the views show only the recorded copy and retain the qualification that the current file has not been rechecked

#### Scenario: No ready capture text

- **WHEN** the capture read is still loading, fails, or has no available body
- **THEN** each surface shows its existing applicable loading, error/retry, or unavailable message instead of fabricating a preview

#### Scenario: Earlier text remains readable

- **WHEN** the latest file check fails with a last good capture retained, or a newer capture is recorded while the earlier one is loading
- **THEN** each surface shows the available saved text, with the existing applicable last-good or earlier-capture warning, not as the live file

#### Scenario: Compare two Markdown captures

- **WHEN** the user opens Compare recorded captures on the board and selects two versions containing Markdown
- **THEN** the diff still shows literal markup and existing comparison qualifications

### Requirement: Captured Markdown is untrusted content

The preview MUST NOT activate embedded HTML or load document-supplied assets. Image syntax SHALL show only alternative text. Only valid absolute HTTP(S) links SHALL be actionable, and only on explicit activation; all other link labels SHALL remain inert text. Rendering MUST NOT trigger any document-originated network request or navigation.

#### Scenario: Captured markup and images on either surface

- **WHEN** either surface previews a capture containing embedded HTML and Markdown image references
- **THEN** no embedded HTML becomes active, images appear only as alternative text, and no resource is read or requested because of the document

### Requirement: Preview links are bounded and their outcome is visible

Destinations longer than 2,048 characters or containing a username or password MUST NOT be actionable. The title of an actionable link SHALL show its full destination. If the host cannot open an activated link, the preview SHALL show a localized error.

#### Scenario: URL activation on either surface

- **WHEN** either surface previews valid absolute HTTP(S) links alongside invalid, relative, protocol-relative, fragment-only, non-web, overlong or credential-bearing links
- **THEN** opening the preview does not request any destination
- **AND** only an explicit activation of a valid absolute HTTP(S) link opens its destination outside the progress surface, without an opener or referrer
- **AND** all other link labels remain non-interactive

#### Scenario: The host cannot open a link

- **WHEN** the user activates a valid link and the host cannot open it
- **THEN** the preview shows a localized error instead of failing silently
