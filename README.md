<p align="center">
  <a href="#install-it-locally">
    <img src="./assets/readme-hero.svg" alt="CasePaste for Salesforce — paste images, save them to Case Files, and place them inline" width="100%">
  </a>
</p>

<h1 align="center">CasePaste for Salesforce</h1>

<p align="center">
  <strong>Copy an image. Paste it into a Case post. Keep going.</strong>
</p>

<p align="center">
  <a href="#install-it-locally">Install</a> ·
  <a href="#use-it">Use it</a> ·
  <a href="#the-short-version-of-how-it-works">How it works</a> ·
  <a href="#settings-that-travel-with-chrome">Settings</a> ·
  <a href="#privacy-and-permissions">Privacy</a>
</p>

---

CasePaste turns the tiny Salesforce interruption that breaks your rhythm into the interaction you expected in the first place. Paste an image into a Case Feed post and it is automatically:

- **uploaded to the Case’s Files,**
- **placed inline at your cursor,** and
- **confirmed with a toast that sounds and looks the way you want.**

Salesforce’s _“Can’t publish a pasted image”_ banner never gets a chance to interrupt you.

> [!TIP]
> The big banner above is clickable. It jumps straight to installation—because apparently we’re a clickable-banner project now, and honestly that feels right.

## At a glance

| You do this | CasePaste quietly does this |
| --- | --- |
| 📋 Copy a screenshot or image | Recognizes image clipboard data only when you paste |
| 📍 Put the cursor in **Feed → Post** | Remembers the exact inline position |
| ⌘/Ctrl + V | Uploads a Salesforce File and links it to the Case |
| ✍️ Keep typing | Replaces the temporary marker without stealing your cursor |
| ✅ See the toast | Confirms the file and inline image both landed |

<table>
  <tr>
    <td width="33%">
      <a href="#install-it-locally">
        <img src="./assets/readme-install.svg" alt="Install CasePaste in Chrome">
      </a>
    </td>
    <td width="33%">
      <a href="#settings-that-travel-with-chrome">
        <img src="./assets/readme-customize.svg" alt="Explore customizable CasePaste settings">
      </a>
    </td>
    <td width="33%">
      <a href="#privacy-and-permissions">
        <img src="./assets/readme-privacy.svg" alt="Read CasePaste privacy details">
      </a>
    </td>
  </tr>
</table>

## What it feels like

There is no popup to open and no upload dialog to babysit. A small **Uploading image** marker holds your place for a moment, then becomes the uploaded image. Once both jobs are done, CasePaste shows a friendly confirmation toast.

That toast is yours to shape. Change its words, accent color, corner, and time on screen—or turn successful notifications off entirely. Error notices always stay on so a failed upload never disappears quietly.

### Highlights

- **Paste-native:** works with screenshots, copied image files, and inline data-URL images.
- **Case-aware:** finds the Case from Lightning navigation or the surrounding record context.
- **Cursor-safe:** keeps a live position marker while Salesforce receives the file.
- **Multiple-image friendly:** pastes several images in clipboard order.
- **Salesforce-native:** hands the paste to the editor’s own Images-button uploader instead of requiring a separate API login.
- **Low-permission:** no blanket clipboard access, cookie-reading permission, or telemetry.
- **Theme-conscious:** the settings page and toast honor light mode, dark mode, and reduced motion.

## Install it locally

CasePaste is ready to load as an unpacked extension in **Chrome 114 or newer**:

1. Download or clone this folder.
2. Open `chrome://extensions` in Google Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this folder.
5. Refresh any Salesforce tabs that were already open.

Click the CasePaste toolbar icon whenever you want to open its settings.

> [!IMPORTANT]
> Loading or reloading an extension does not update Salesforce tabs that are already open. Refresh those tabs once so CasePaste can join the page.

## Use it

Open a Case record in Salesforce Lightning, go to **Feed → Post**, click where the image should appear, and paste. That’s the whole daily workflow.

CasePaste supports:

- screenshots copied from macOS, Windows, or Chrome;
- copied image files;
- browser clipboard images;
- clipboard images supplied as data URLs; and
- multiple images in one paste.

Each image becomes its own Case File and stays in clipboard order. Files receive useful, unique names such as `CasePaste-2026-08-31T14-32-08Z.png`. The prefix and maximum accepted paste size are adjustable on the options page.

## The short version of how it works

CasePaste runs only on Salesforce pages. When an image paste reaches a Salesforce rich-text editor on a Case:

1. **Catch:** it intercepts the paste before Salesforce displays its warning.
2. **Remember:** it leaves a temporary marker at the cursor so you can keep typing.
3. **Upload:** it invisibly drives Salesforce’s Select Image flow, supplies the clipboard file without opening a picker, selects the new upload, and confirms insertion. Unsupported or oversized formats are converted to a Salesforce-compatible image under the native uploader’s 1 MB limit.
4. **Place:** it swaps the marker for the authenticated Salesforce image and tells the editor its content changed.
5. **Confirm:** it shows the customized success toast only after both upload and inline placement succeed.

For older editors without a usable Images button, the backup REST route discovers the org's API version at runtime instead of pinning your team to one Salesforce release.

<details>
  <summary><strong>Curious about the more technical version?</strong></summary>

  The content script handles the paste event, clipboard image extraction, Case detection, selection tracking, warning suppression, and editor updates. It never reads the Salesforce session value.

  A small main-page bridge temporarily intercepts the inherited browser file-picker method and supplies a real browser `File` built from the paste. The content script keeps Salesforce’s intermediate Select Image modal hidden while it triggers Upload Image, selects the uniquely named upload, and presses Insert. Salesforce’s component still performs its normal org upload, record sharing, permanent-URL replacement, and Quill insertion. The bridge immediately restores the browser method after that single handoff.

  If an older editor has no usable Images button, CasePaste retains its validated, chunked `ContentVersion` service-worker route as a fallback.

  The temporary editor element also carries a live DOM `Range`. If Salesforce normalizes the marker before the network request returns, CasePaste still has a cursor-relative fallback for inline placement.
</details>

## Settings that travel with Chrome

The options page stores preferences with Chrome sync when sync is available:

| Setting | What it changes |
| --- | --- |
| **Catch pasted images** | Enables or pauses CasePaste without uninstalling it |
| **File name starts with** | Replaces the default `CasePaste` prefix |
| **Maximum image size** | Accepts 1–200 MB; defaults to 25 MB |
| **Show success toast** | Keeps confirmations visible or works silently |
| **Heading and message** | Supports `{filename}`, `{caseId}`, and `{count}` tokens |
| **Corner, accent, duration** | Controls where the toast appears and how it feels |

The page follows the browser or operating system light/dark preference automatically and respects reduced-motion settings. A live preview shows the toast while you edit it.

## Privacy and permissions

CasePaste asks for access to Salesforce domains and Chrome storage—nothing more.

- **Direct destination:** pasted images go from the active Salesforce tab to your Salesforce org.
- **No third party:** no image, Case data, session value, or usage data is sent elsewhere.
- **No cookie reading:** the extension never asks Chrome to reveal session cookies.
- **No blanket clipboard access:** CasePaste sees image data only when you actively paste into a supported editor.
- **No telemetry:** there are no analytics, trackers, beacons, or remote scripts.

Your Salesforce permissions still apply. A user needs permission to add images and Files to the Case. The normal Images-button path does not require CasePaste to make a separate API login; the backup route for older editors also depends on an API-enabled session. If Salesforce refuses an upload, CasePaste removes the temporary marker and explains the problem without changing the rest of the post.

> [!NOTE]
> Org security policies still win. If your Salesforce administrators customize or block file uploads or downloads, CasePaste will not work around that policy.

## If a paste does not land

- Confirm that you are on the Case record itself, not a list view or detached utility panel.
- Refresh the Salesforce tab after installing or reloading the extension.
- Make sure the image is below the size limit shown in CasePaste settings.
- Confirm Salesforce's regular **Images** button can add an image to the same post box.
- For an older editor where that button is unavailable, ask a Salesforce administrator to confirm your profile can create Files and use the REST API.
- Check whether an org security policy customizes or blocks ContentVersion uploads or file downloads.

## For contributors

There are no runtime dependencies and no build step. The checked-in folder **is** the extension.

```bash
npm test
npm run check
```

- `npm test` runs the shared helpers, a simulated native Images-button handoff, and an authenticated chunked multipart upload.
- `npm run check` validates JavaScript syntax, manifest references, icon dimensions, version documentation, and extension-page script policy.

All notable work belongs in [`CHANGELOG.md`](CHANGELOG.md), starting with version **0.1.0**. Generated packages, signing keys, local browser profiles, secrets, caches, editor state, and test output are kept out of the public repository through [`.gitignore`](.gitignore).

---

<p align="center">
  <strong>CasePaste is an independent project.</strong><br>
  It is not affiliated with or endorsed by Salesforce. “Salesforce” is used only to identify compatibility.
</p>

<!--
GitHub About description:
Paste images directly into Salesforce Case Feed posts—automatically uploaded to Case Files and placed inline at your cursor.

Suggested GitHub topics:
chrome-extension, salesforce, salesforce-lightning, productivity, manifest-v3, case-management, clipboard
-->
