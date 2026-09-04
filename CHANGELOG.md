# Changelog

All notable changes to CasePaste for Salesforce are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-09-01

### Fixed

- Removed the **Uploading image** marker that "stuck" around after the pasted image was inserted inline.

## [0.1.0] - 2026-08-31

### INITIAL RELEASE

- First Manifest V3 release under the name **CasePaste for Salesforce**.
- Early paste interception for clipboard image files and inline data-URL images in Salesforce rich-text editors.
- Case record detection from Lightning URLs and record-bearing DOM attributes.
- Multipart Salesforce `ContentVersion` uploads with the current Case as `FirstPublishLocationId`, placing each image in Case Files.
- Chunked image transfer to the extension service worker, which selects the authenticated `*.my.salesforce.com` API endpoint without requesting direct cookie access.
- Automatic REST API version discovery from the signed-in Salesforce org.
- Cursor-preserving upload markers and inline image placement after upload.
- Support for pasting multiple images while preserving clipboard order.
- Preemptive suppression plus a DOM-level fallback guard for Salesforce’s pasted-image warning banner.
- Invisible native Images-button handoff that automatically drives Salesforce’s Select Image, Upload Image, file selection, and Insert steps while avoiding REST-session rejection in Lightning tabs.
- File-picker interception on Chrome’s inherited `HTMLElement.click()` method, matching Salesforce’s actual Upload Image implementation without showing the operating-system picker.
- Automatic conversion and compression of unsupported or oversized clipboard images to fit Salesforce’s documented 1 MB native inline-image limit.
- Custom success toast with editable heading, message tokens, accent, screen corner, and duration.
- Always-visible, plain-language error toasts for missing Cases, size limits, permissions, upload failures, and lost editor positions.
- A responsive options page with an interactive preview, automatic Chrome sync storage, system/browser light and dark themes, and reduced-motion support.
- Configurable file-name prefix and 1–200 MB paste limit.
- Toolbar shortcut that opens the options page.
- Tightly cropped, centered extension artwork at Chrome’s 16, 32, 48, and 128 pixel sizes, with minimal canvas padding on `chrome://extensions`.
- Privacy, installation, usage, troubleshooting, and contributor guidance in the README.
- A richer GitHub README with a clickable hero, visual navigation banners, callouts, and scannable feature tables.
- Public-repository metadata with a ready-to-use GitHub About description and topic keywords.
- A comprehensive `.gitignore` covering local editor state, secrets, caches, test output, browser profiles, packaged extensions, and signing keys.
- Automated unit and project-integrity checks.

[0.1.1]: https://github.com/teezyyoxo/SFinlinecopypasta/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/teezyyoxo/SFinlinecopypasta/releases/tag/v0.1.0
