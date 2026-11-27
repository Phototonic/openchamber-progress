# Design

## Context

`ui/panel/main.ts` and `ui/page/main.ts` use `documentBlock` in `ui/shared/components.ts` with the same on-demand `document` and `requestDocument` hooks. `documentBlock` presents the capture state, loading/error/retry, and capture notes around a ready `DocumentBody`. The board adds `captureComparisonBlock` separately; `ui/shared/capture-comparison-view.ts` shows a literal diff.

## Decisions

### Replace only the shared ready-text presentation

Choose Markdown for a final `.md` suffix (case-insensitive) on the path in the returned document reference (`DocumentBody.ref.path`), not from what the text looks like or by looking up a file. Use that reference for classification so an earlier response with its own path does not inherit the format of a newer selection or binding. Missing path and other suffixes retain the existing literal text view. Use the already assembled `DocumentBody.text` and shared styles for both surfaces. Preserve a keyboard-readable, selectable body at narrow widths and in both themes. Checked and unchecked markers must be visually and accessibly distinct but have no toggle action and represent only the document, not reported task state.

Keep the existing on-demand request, identity, pagination, and refresh behavior. Preserve all capture notes and their conditions: missing or unbound content, loading/error/retry, last successful capture following a failed check, earlier capture returned during a race, and checklist synchronization/current-file-not-rechecked wording. Do not parse partial or absent body text. Leave comparison independent and literal. Separate renderers in the rail and board would duplicate the content policy and are unnecessary.

### Render only known output; do not fetch document resources

Parse Markdown with raw HTML disabled. Build only known presentation nodes and attributes; do not inject captured strings as HTML or copy document-provided attributes, IDs, or styles into the DOM. Raw HTML is inert, not a source of controls, scripts, navigation, or networking. Markdown images, including reference-style images, render only as their alt text, never as resource elements. Remote, relative, local, and embedded image sources are not resolved or fetched.

Only destinations validated as absolute HTTP or HTTPS URLs with an explicit scheme and a host can become links. Validate the parsed Markdown destination without resolving it against a base URL; render the label alone for invalid URLs, relative paths, fragment-only links, protocol-relative URLs, and non-web schemes. Accepted links open outside the progress surface on explicit pointer or keyboard activation only, with no opener or referrer and no prefetch, preview fetch, or automatic navigation. The sandbox cannot open tabs: the preview has no navigable `href` and uses the SDK's `openUrl` operation. OpenChamber 2.7.1 opens these through `window.open` with `noopener,noreferrer`, through the desktop shell, or by directly loading the address in its isolated browser pane, not through a navigation from the guest document. Any network access from opening that destination is the user's explicit navigation, not a preview asset load. Do not attach host commands or task actions to links.

## Compatibility and rollback

This is a guest-only projection of existing response fields. There is no capability handshake, service upgrade prerequisite beyond the existing document view, persisted setting, or migration. Older guests continue to show the same captures as literal text. Reverting the ready-body presentation and its styles restores the literal view without recapturing, modifying stored bytes, or touching any schema or permissions.
