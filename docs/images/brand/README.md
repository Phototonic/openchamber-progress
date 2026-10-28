# Agent Progress logo assets

The logo pairs an OpenChamber-derived cube with a lower foreground progress bar. The green, blue, amber and neutral segments evoke reported task states; their equal widths are a static design, not live progress data.

## Choose an asset

| Format | Light background | Dark background |
| --- | --- | --- |
| Symbol | [SVG](agent-progress-mark-light.svg) · [PNG](agent-progress-mark-light.png) | [SVG](agent-progress-mark-dark.svg) · [PNG](agent-progress-mark-dark.png) |
| Horizontal logo | [SVG](agent-progress-horizontal-light.svg) · [PNG](agent-progress-horizontal-light.png) | [SVG](agent-progress-horizontal-dark.svg) · [PNG](agent-progress-horizontal-dark.png) |
| Stacked logo | [SVG](agent-progress-stacked-light.svg) · [PNG](agent-progress-stacked-light.png) | [SVG](agent-progress-stacked-dark.svg) · [PNG](agent-progress-stacked-dark.png) |
| README header | [SVG](agent-progress-header-light.svg) · [PNG](agent-progress-header-light.png) | [SVG](agent-progress-header-dark.svg) · [PNG](agent-progress-header-dark.png) |

SVG is the scalable source. All lettering is outlined, with no installed-font requirement or remote assets. Symbols and logos have transparent canvases with intentional opaque face and bar fills; headers have a theme background. PNG symbols are 512 × 512; horizontal and stacked PNGs are rendered at twice their SVG dimensions. Headers are 1600 × 480 in both formats.

The root README uses a `<picture>` element with a `prefers-color-scheme: dark` source and a light fallback. Keep both theme files together when reusing the header. Use the provided light variant on light backgrounds and the dark variant on dark backgrounds.

## Colours

| Role | Colour |
| --- | --- |
| Done | `#42AC72` |
| Working | `#4A97EE` |
| Blocked | `#F0BC62` |
| Remaining | `#B7BEC5` |

These are fixed branding colours inspired by the progress UI. The application continues to use its host theme tokens.

## Attribution

The cube and nested diamond motif adapt OpenChamber's logo. The progress overlay, flat colour treatment and Agent Progress wordmarks identify this community extension; they do not imply official endorsement. Typography is outlined Fira Sans Medium and Regular. See [source attribution and notices](NOTICE.md).
