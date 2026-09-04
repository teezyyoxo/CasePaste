(function startCasePaste() {
  "use strict";

  const Core = globalThis.CasePasteCore;
  const Editor = globalThis.CasePasteEditor;
  if (!Core || !Editor || globalThis.__casePasteLoaded) {
    return;
  }

  globalThis.__casePasteLoaded = true;

  const NATIVE_WARNING = "can't publish a pasted image";
  const NATIVE_WARNING_HELP = "add images using the images button";
  const NATIVE_ARM_EVENT = "casepaste:arm-native-image-upload";
  const NATIVE_ARM_ATTRIBUTE = "data-casepaste-native-arm";
  const NATIVE_ACTIVE_ATTRIBUTE = "data-casepaste-native-active";
  const NATIVE_HANDOFF_ATTRIBUTE = "data-casepaste-native-handoff";
  const NATIVE_PAYLOAD_PREFIX = "casepaste-native-payload-";
  const NATIVE_IMAGE_LIMIT = 1024 * 1024;
  const NATIVE_IMAGE_TARGET = 950 * 1024;
  const NATIVE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
  const EDITOR_SELECTOR = [
    ".ql-editor[contenteditable='true']",
    ".slds-rich-text-area__content[contenteditable='true']",
    "lightning-input-rich-text [contenteditable='true']",
    "[data-placeholder][contenteditable='true'][role='textbox']"
  ].join(",");
  const RECORD_ATTRIBUTE_NAMES = ["data-recordid", "data-record-id", "record-id"];

  let settings = { ...Core.DEFAULTS };
  let toastLayer = null;
  let toastShadow = null;

  loadSettings();
  watchSettings();
  installPasteInterceptor();
  installNativeWarningGuard();

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(Core.STORAGE_KEY);
      settings = Core.sanitizeSettings(stored[Core.STORAGE_KEY]);
    } catch (_error) {
      settings = { ...Core.DEFAULTS };
    }
  }

  function watchSettings() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes[Core.STORAGE_KEY]) {
        settings = Core.sanitizeSettings(changes[Core.STORAGE_KEY].newValue);
      }
    });
  }

  function installPasteInterceptor() {
    document.addEventListener("paste", (event) => {
      if (!settings.enabled || event.defaultPrevented) {
        return;
      }

      const editor = findRichTextEditor(event);
      if (!editor) {
        return;
      }

      const images = collectClipboardImages(event.clipboardData);
      if (!images.length) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void handleImagePaste(editor, images);
    }, true);
  }

  function findRichTextEditor(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];

    for (const node of path) {
      if (!(node instanceof Element)) {
        continue;
      }

      if (node.matches(EDITOR_SELECTOR)) {
        return node;
      }

      const editor = node.closest(EDITOR_SELECTOR);
      if (editor) {
        return editor;
      }

      if (node.isContentEditable && isSalesforceRichTextContainer(node)) {
        return node;
      }
    }

    return null;
  }

  function isSalesforceRichTextContainer(element) {
    if (!element || !element.isContentEditable) {
      return false;
    }

    const container = element.closest(
      "lightning-input-rich-text, .slds-rich-text-editor, .forceChatterPublisher, [class*='publisher']"
    );
    return Boolean(container);
  }

  function collectClipboardImages(clipboardData) {
    if (!clipboardData) {
      return [];
    }

    const fromItems = [];
    for (const item of Array.from(clipboardData.items || [])) {
      if (item.kind === "file" && item.type.toLowerCase().startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          fromItems.push(file);
        }
      }
    }

    if (fromItems.length) {
      return fromItems;
    }

    const fromFiles = Array.from(clipboardData.files || []).filter((file) => {
      return file.type.toLowerCase().startsWith("image/");
    });
    if (fromFiles.length) {
      return fromFiles;
    }

    const html = clipboardData.getData("text/html");
    if (!html || !html.toLowerCase().includes("data:image/")) {
      return [];
    }

    const dataUrls = [];
    const imageSourcePattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(data:image\/[^"']+)\1/gi;
    let match = imageSourcePattern.exec(html);
    while (match) {
      dataUrls.push(match[2].replace(/&amp;/gi, "&"));
      match = imageSourcePattern.exec(html);
    }

    return dataUrls.map((dataUrl, index) => dataUrlToFile(dataUrl, index + 1)).filter(Boolean);
  }

  function dataUrlToFile(dataUrl, index) {
    try {
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex < 0) {
        return null;
      }

      const metadata = dataUrl.slice(5, commaIndex);
      const mimeType = metadata.split(";")[0].toLowerCase();
      if (!mimeType.startsWith("image/")) {
        return null;
      }

      const encoded = dataUrl.slice(commaIndex + 1);
      const binary = metadata.toLowerCase().includes(";base64")
        ? atob(encoded.replace(/\s/g, ""))
        : decodeURIComponent(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let offset = 0; offset < binary.length; offset += 1) {
        bytes[offset] = binary.charCodeAt(offset);
      }

      return new File(
        [bytes],
        `pasted-image-${index}.${Core.extensionForMimeType(mimeType)}`,
        { type: mimeType }
      );
    } catch (_error) {
      return null;
    }
  }

  async function handleImagePaste(editor, files) {
    const caseId = findCurrentCaseId(editor);
    if (!caseId) {
      showToast({
        kind: "error",
        title: "Case not found",
        message: "Open the Case record itself, then paste into its Feed post box."
      });
      return;
    }

    const maximumBytes = settings.maxFileSizeMb * 1024 * 1024;
    const validFiles = files.filter((file) => {
      if (file.size <= maximumBytes) {
        return true;
      }

      showToast({
        kind: "error",
        title: "Image is too large",
        message: `${Core.formatFileSize(file.size)} is over your ${settings.maxFileSizeMb} MB CasePaste limit.`
      });
      return false;
    });

    if (!validFiles.length) {
      return;
    }

    const anchors = insertUploadAnchors(editor, validFiles.length);
    if (!anchors.length) {
      showToast({
        kind: "error",
        title: "Cursor lost",
        message: "Click in the post box and paste the image one more time."
      });
      return;
    }

    const startedAt = new Date();
    const successful = [];
    for (let index = 0; index < validFiles.length; index += 1) {
      const originalFile = validFiles[index];
      try {
        const nativeFile = await prepareForNativeUploader(originalFile);
        const filename = Core.makeFilename(settings.filenamePrefix, nativeFile.type, startedAt, index + 1);
        const namedNativeFile = new File([nativeFile], filename, { type: nativeFile.type });
        const nativeResult = await insertWithSalesforceUploader(
          editor,
          anchors[index],
          namedNativeFile
        );
        removeUploadAnchor(editor, anchors[index], nativeResult.image);
        successful.push({ filename, upload: nativeResult });
      } catch (error) {
        if (error && error.code === "NATIVE_UNAVAILABLE") {
          const filename = Core.makeFilename(
            settings.filenamePrefix,
            originalFile.type,
            startedAt,
            index + 1
          );
          try {
            const upload = await uploadToCase(originalFile, filename, caseId);
            placeInlineImage(editor, anchors[index], upload.id, filename);
            successful.push({ filename, upload });
            continue;
          } catch (fallbackError) {
            fallbackError.nativeMessage = error.message;
            error = fallbackError;
          }
        }

        removeUploadAnchor(editor, anchors[index]);
        showToast({
          kind: "error",
          title: "Paste did not land",
          message: friendlyUploadError(error)
        });
      }
    }

    if (successful.length && settings.showSuccessToast) {
      const count = successful.length;
      const filename = count === 1 ? successful[0].filename : `${count} images`;
      const variables = { caseId, count, filename };
      showToast({
        kind: "success",
        title: Core.renderTemplate(settings.toastTitle, variables),
        message: Core.renderTemplate(settings.toastMessage, variables)
      });
    }
  }

  function findCurrentCaseId(editor) {
    const fromUrl = Core.parseCaseId(window.location.href);
    if (fromUrl) {
      return fromUrl;
    }

    let current = editor;
    while (current instanceof Element) {
      for (const attributeName of RECORD_ATTRIBUTE_NAMES) {
        const fromAttribute = Core.parseCaseId(current.getAttribute(attributeName));
        if (fromAttribute) {
          return fromAttribute;
        }
      }
      current = current.parentElement;
    }

    const candidates = document.querySelectorAll("[data-recordid], [data-record-id], [record-id]");
    for (const candidate of candidates) {
      for (const attributeName of RECORD_ATTRIBUTE_NAMES) {
        const fromAttribute = Core.parseCaseId(candidate.getAttribute(attributeName));
        if (fromAttribute) {
          return fromAttribute;
        }
      }
    }

    return null;
  }

  function getPasteRange(editor) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const activeRange = selection.getRangeAt(0);
      if (editor.contains(activeRange.commonAncestorContainer)) {
        return activeRange.cloneRange();
      }
    }

    const fallback = document.createRange();
    fallback.selectNodeContents(editor);
    fallback.collapse(false);
    return fallback;
  }

  function insertUploadAnchors(editor, count) {
    const range = getPasteRange(editor);
    if (!range) {
      return [];
    }

    const anchors = [];
    range.deleteContents();

    for (let index = 0; index < count; index += 1) {
      const anchor = document.createElement("span");
      anchor.className = "casepaste-upload-anchor";
      anchor.dataset.casepasteAnchor = makeUniqueId();
      anchor.setAttribute("contenteditable", "false");
      anchor.setAttribute("role", "status");
      anchor.setAttribute("aria-label", `Uploading pasted image ${index + 1} of ${count}`);
      const label = count === 1 ? "Uploading image" : `Uploading image ${index + 1}`;
      const placeholderText = Editor.makeUploadPlaceholder(label);
      anchor.textContent = placeholderText;
      range.insertNode(anchor);
      const trackingRange = document.createRange();
      trackingRange.selectNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
      anchors.push({ element: anchor, label, placeholderText, trackingRange });
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    signalEditorChanged(editor, "insertFromPaste");
    return anchors;
  }

  function makeUniqueId() {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return `${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
  }

  async function prepareForNativeUploader(file) {
    const mimeType = (file.type || "").toLowerCase();
    if (NATIVE_IMAGE_TYPES.has(mimeType) && file.size <= NATIVE_IMAGE_LIMIT) {
      return file;
    }

    if (typeof createImageBitmap !== "function") {
      throw nativeUnavailable("This browser could not prepare the pasted image for Salesforce's uploader.");
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height) {
        throw new Error("The pasted image has no readable dimensions.");
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("Chrome could not create an image conversion canvas.");
      }

      let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      let quality = 0.9;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const converted = await canvasToBlob(canvas, "image/jpeg", quality);
        if (converted && converted.size <= NATIVE_IMAGE_TARGET) {
          return converted;
        }

        if (quality > 0.58) {
          quality -= 0.1;
        } else {
          scale *= 0.8;
          quality = 0.82;
        }
      }
    } catch (error) {
      throw nativeUnavailable(error && error.message
        ? error.message
        : "Salesforce's image uploader could not read this image format.");
    } finally {
      if (bitmap && typeof bitmap.close === "function") {
        bitmap.close();
      }
    }

    throw nativeUnavailable("The image could not be reduced to Salesforce's 1 MB inline-image limit.");
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  }

  async function insertWithSalesforceUploader(editor, anchorHandle, file) {
    const imageButton = findSalesforceImageButton(editor);
    if (!imageButton) {
      throw nativeUnavailable("CasePaste could not find Salesforce's Images button in this editor.");
    }

    const token = makeUniqueId();
    const payload = document.createElement("div");
    payload.id = `${NATIVE_PAYLOAD_PREFIX}${token}`;
    payload.hidden = true;
    payload.setAttribute("data-filename", file.name);
    payload.setAttribute("data-mime-type", file.type);
    payload.textContent = encodeBase64Chunk(new Uint8Array(await file.arrayBuffer()));
    document.documentElement.appendChild(payload);

    const existingImages = new Set(editor.querySelectorAll("img"));
    const restoreSelection = moveSelectionToAnchor(editor, anchorHandle);
    let nativeDialog = null;

    try {
      document.documentElement.setAttribute(NATIVE_ACTIVE_ATTRIBUTE, token);
      imageButton.click();

      nativeDialog = await waitForNativeImageDialog(7000);
      if (!nativeDialog) {
        throw nativeUnavailable("Salesforce did not open its Select Image dialog.");
      }

      const uploadButton = findDialogButton(nativeDialog, "upload image");
      if (!uploadButton) {
        throw nativeUnavailable("CasePaste could not find Upload Image in Salesforce's image dialog.");
      }

      const handoffPromise = waitForRootAttribute(NATIVE_HANDOFF_ATTRIBUTE, token, 5000);
      document.documentElement.setAttribute(NATIVE_ARM_ATTRIBUTE, token);
      document.dispatchEvent(new Event(NATIVE_ARM_EVENT));
      uploadButton.click();

      const handedOff = await handoffPromise;
      if (!handedOff) {
        throw nativeUnavailable("CasePaste could not hand the pasted file to Salesforce's Upload Image control.");
      }
      document.documentElement.removeAttribute(NATIVE_HANDOFF_ATTRIBUTE);

      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await finishNativeImageDialog(nativeDialog, file.name, 45000);

      const image = await waitForUploadedImage(editor, existingImages, 45000);
      const contentVersionMatch = image.src.match(/\b068[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?\b/);
      return {
        id: contentVersionMatch ? contentVersionMatch[0] : null,
        image,
        native: true,
        success: true
      };
    } catch (error) {
      let removedPendingImage = false;
      for (const image of editor.querySelectorAll("img")) {
        if (!existingImages.has(image)) {
          image.remove();
          removedPendingImage = true;
        }
      }
      if (removedPendingImage) {
        signalEditorChanged(editor, "deleteContentBackward");
      }
      throw error;
    } finally {
      payload.remove();
      document.documentElement.removeAttribute(NATIVE_ARM_ATTRIBUTE);
      document.documentElement.removeAttribute(NATIVE_HANDOFF_ATTRIBUTE);
      if (nativeDialog && nativeDialog.isConnected) {
        dismissNativeImageDialog(nativeDialog);
        await waitForElementRemoval(nativeDialog, 1000);
      }
      document.documentElement.removeAttribute(NATIVE_ACTIVE_ATTRIBUTE);
      restoreSelection();
    }
  }

  function findNativeImageDialog() {
    const selectors = ["[role='dialog']", ".slds-modal", ".uiModal"];
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const text = normalizeControlText(candidate.textContent);
        if (text.includes("select image") && text.includes("upload image")) {
          return candidate;
        }
      }
    }
    return null;
  }

  function waitForNativeImageDialog(timeoutMs) {
    return new Promise((resolve) => {
      const immediate = findNativeImageDialog();
      if (immediate) {
        resolve(immediate);
        return;
      }

      let finished = false;
      const observer = new MutationObserver(() => {
        const dialog = findNativeImageDialog();
        if (dialog) {
          finish(dialog);
        }
      });
      const finish = (dialog) => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(dialog);
      };
      const timer = window.setTimeout(() => finish(null), timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function normalizeControlText(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function controlLabel(element) {
    return normalizeControlText([
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.value
    ].filter(Boolean).join(" "));
  }

  function findDialogButton(dialog, label) {
    const target = normalizeControlText(label);
    return Array.from(dialog.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']"))
      .find((button) => controlLabel(button).includes(target)) || null;
  }

  function isEnabledControl(control) {
    return Boolean(control) && !control.disabled && control.getAttribute("aria-disabled") !== "true" &&
      !control.classList.contains("disabled");
  }

  function findUploadedFileControl(dialog, filename) {
    const target = normalizeControlText(filename);
    const elements = dialog.querySelectorAll(
      "a, button, [role='option'], [role='button'], [role='row'], [title], [aria-label], span"
    );
    for (const element of elements) {
      const text = normalizeControlText(element.textContent);
      const title = normalizeControlText(element.getAttribute("title"));
      const ariaLabel = normalizeControlText(element.getAttribute("aria-label"));
      if (text === target || title === target || ariaLabel === target) {
        return element.closest("a, button, [role='option'], [role='button'], [role='row']") || element;
      }
    }
    return null;
  }

  function finishNativeImageDialog(dialog, filename, timeoutMs) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let selectedUploadedFile = false;
      let clickedInsert = false;
      const startedAt = Date.now();

      const finish = (error) => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearInterval(interval);
        window.clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const check = () => {
        if (!dialog.isConnected) {
          finish();
          return;
        }

        if (!selectedUploadedFile) {
          const uploadedFile = findUploadedFileControl(dialog, filename);
          if (uploadedFile) {
            selectedUploadedFile = true;
            uploadedFile.click();
          }
        }

        const insertButton = findDialogButton(dialog, "insert");
        const uploadHasHadTimeToSelect = Date.now() - startedAt >= 750;
        if (!clickedInsert && isEnabledControl(insertButton) &&
            (selectedUploadedFile || uploadHasHadTimeToSelect)) {
          clickedInsert = true;
          insertButton.click();
          finish();
        }
      };

      const observer = new MutationObserver(check);
      const interval = window.setInterval(check, 250);
      const timer = window.setTimeout(() => {
        const error = new Error("Salesforce did not finish selecting the uploaded image.");
        error.code = "NATIVE_UPLOAD_FAILED";
        finish(error);
      }, timeoutMs);
      observer.observe(dialog, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      check();
    });
  }

  function dismissNativeImageDialog(dialog) {
    const cancelButton = findDialogButton(dialog, "cancel");
    const closeButton = findDialogButton(dialog, "close") ||
      dialog.querySelector("button.slds-modal__close, .slds-modal__close button");
    const control = cancelButton || closeButton;
    if (control) {
      control.click();
    }
  }

  function waitForElementRemoval(element, timeoutMs) {
    return new Promise((resolve) => {
      if (!element.isConnected) {
        resolve();
        return;
      }

      let finished = false;
      const observer = new MutationObserver(() => {
        if (!element.isConnected) {
          finish();
        }
      });
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function findSalesforceImageButton(editor) {
    const selector = [
      "button.ql-image",
      "button[aria-label*='image' i]",
      "button[title*='image' i]",
      "[role='button'][aria-label*='image' i]",
      "[role='button'][title*='image' i]"
    ].join(",");
    const scopes = [];
    const seenScopes = new Set();
    let current = editor;

    for (let depth = 0; current && depth < 10; depth += 1) {
      const scope = current instanceof ShadowRoot ? current : current.parentElement;
      if (scope && !seenScopes.has(scope)) {
        scopes.push(scope);
        seenScopes.add(scope);
      }

      const root = current.getRootNode && current.getRootNode();
      if (root instanceof ShadowRoot) {
        if (!seenScopes.has(root)) {
          scopes.push(root);
          seenScopes.add(root);
        }
        current = root.host;
      } else {
        current = current.parentElement;
      }
    }

    if (!seenScopes.has(document)) {
      scopes.push(document);
    }

    const buttons = [];
    const seenButtons = new Set();
    for (const scope of scopes) {
      if (!scope.querySelectorAll) {
        continue;
      }
      for (const button of scope.querySelectorAll(selector)) {
        if (!seenButtons.has(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
          seenButtons.add(button);
          buttons.push(button);
        }
      }
      if (buttons.length) {
        break;
      }
    }

    const editorRect = editor.getBoundingClientRect();
    return buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((left, right) => buttonDistance(left, editorRect) - buttonDistance(right, editorRect))[0] || null;
  }

  function buttonDistance(button, editorRect) {
    const rect = button.getBoundingClientRect();
    return Math.abs(rect.left - editorRect.left) + Math.abs(rect.top - editorRect.bottom);
  }

  function moveSelectionToAnchor(editor, anchorHandle) {
    const selection = window.getSelection();
    const previous = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const anchor = resolveAnchor(editor, anchorHandle);
    let insertionRange = null;

    if (anchor && anchor.isConnected) {
      insertionRange = document.createRange();
      insertionRange.setStartBefore(anchor);
      insertionRange.collapse(true);
    } else if (isUsableTrackingRange(editor, anchorHandle)) {
      insertionRange = anchorHandle.trackingRange.cloneRange();
      insertionRange.collapse(true);
    }

    if (selection && insertionRange) {
      selection.removeAllRanges();
      selection.addRange(insertionRange);
    }

    let restored = false;
    return () => {
      if (restored || !selection || !previous) {
        return;
      }
      restored = true;
      try {
        if (editor.contains(previous.commonAncestorContainer)) {
          selection.removeAllRanges();
          selection.addRange(previous);
        }
      } catch (_error) {
        // Salesforce can replace the editor DOM while an image upload is finishing.
      }
    };
  }

  function waitForRootAttribute(attributeName, expectedValue, timeoutMs) {
    return new Promise((resolve) => {
      const root = document.documentElement;
      if (root.getAttribute(attributeName) === expectedValue) {
        resolve(true);
        return;
      }

      let finished = false;
      const observer = new MutationObserver(() => {
        if (root.getAttribute(attributeName) === expectedValue) {
          finish(true);
        }
      });
      const finish = (result) => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(result);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      observer.observe(root, { attributes: true, attributeFilter: [attributeName] });
    });
  }

  function waitForUploadedImage(editor, existingImages, timeoutMs) {
    return new Promise((resolve, reject) => {
      const findImage = () => Array.from(editor.querySelectorAll("img")).find((image) => {
        if (existingImages.has(image)) {
          return false;
        }
        const source = image.getAttribute("src") || "";
        return source && !source.startsWith("blob:") && !source.startsWith("data:");
      });

      const immediate = findImage();
      if (immediate) {
        resolve(immediate);
        return;
      }

      let finished = false;
      const observer = new MutationObserver(() => {
        const image = findImage();
        if (image) {
          finish(image);
        }
      });
      const finish = (image, error) => {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve(image);
        }
      };
      const timer = window.setTimeout(() => {
        const error = new Error("Salesforce's Images-button upload did not finish. Try a smaller PNG or JPG.");
        error.code = "NATIVE_UPLOAD_FAILED";
        finish(null, error);
      }, timeoutMs);
      observer.observe(editor, {
        attributes: true,
        attributeFilter: ["src"],
        childList: true,
        subtree: true
      });
    });
  }

  function nativeUnavailable(message) {
    const error = new Error(message);
    error.code = "NATIVE_UNAVAILABLE";
    return error;
  }

  async function uploadToCase(file, filename, caseId) {
    const port = chrome.runtime.connect({ name: "casepaste-upload" });
    let settled = false;

    const resultPromise = new Promise((resolve, reject) => {
      port.onMessage.addListener((message) => {
        if (!message || settled) {
          return;
        }
        if (message.type === "complete") {
          settled = true;
          port.disconnect();
          resolve(message.result);
        } else if (message.type === "error") {
          settled = true;
          const error = new Error(message.error && message.error.message);
          error.status = message.error && message.error.status;
          error.code = message.error && message.error.code;
          port.disconnect();
          reject(error);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          reject(new Error("The CasePaste upload connection closed before Salesforce replied."));
        }
      });
    });

    port.postMessage({
      type: "start",
      caseId,
      filename,
      mimeType: file.type || "image/png",
      size: file.size
    });

    try {
      const chunkSize = 512 * 1024;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        if (settled) {
          return resultPromise;
        }
        port.postMessage({ type: "chunk", data: encodeBase64Chunk(bytes) });
      }
      port.postMessage({ type: "end" });
    } catch (error) {
      if (settled) {
        return resultPromise;
      }
      settled = true;
      port.disconnect();
      throw error;
    }

    return resultPromise;
  }

  function encodeBase64Chunk(bytes) {
    const blockSize = 32 * 1024;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
    }
    return btoa(binary);
  }

  function placeInlineImage(editor, anchorHandle, contentVersionId, filename) {
    const image = document.createElement("img");
    image.src = `${window.location.origin}/sfc/servlet.shepherd/version/download/${contentVersionId}`;
    image.alt = filename;
    image.title = filename;
    image.dataset.casepasteContentVersion = contentVersionId;

    const anchor = resolveAnchor(editor, anchorHandle);
    if (anchor && anchor.isConnected) {
      anchor.replaceWith(image);
    } else if (isUsableTrackingRange(editor, anchorHandle)) {
      anchorHandle.trackingRange.deleteContents();
      anchorHandle.trackingRange.insertNode(image);
    } else {
      const error = new Error("The post box changed before the upload finished. The file is in Case Files, but it could not be placed inline.");
      error.code = "INLINE_ANCHOR_LOST";
      throw error;
    }

    signalEditorChanged(editor, "insertFromPaste");
  }

  function resolveAnchor(editor, anchorHandle) {
    const anchor = anchorHandle && anchorHandle.element ? anchorHandle.element : anchorHandle;
    if (anchor && anchor.isConnected) {
      return anchor;
    }
    if (!anchor || !anchor.dataset.casepasteAnchor) {
      return null;
    }
    return editor.querySelector(`[data-casepaste-anchor="${CSS.escape(anchor.dataset.casepasteAnchor)}"]`);
  }

  function isUsableTrackingRange(editor, anchorHandle) {
    if (!anchorHandle || !anchorHandle.trackingRange) {
      return false;
    }

    try {
      return editor.contains(anchorHandle.trackingRange.commonAncestorContainer);
    } catch (_error) {
      return false;
    }
  }

  function removeUploadAnchor(editor, anchorHandle, insertedImage) {
    const anchor = resolveAnchor(editor, anchorHandle);
    if (anchor) {
      anchor.remove();
      signalEditorChanged(editor, "deleteContentBackward");
      return;
    }

    const rangeText = isUsableTrackingRange(editor, anchorHandle)
      ? anchorHandle.trackingRange.toString().trim()
      : "";
    if (rangeText && (rangeText === anchorHandle.placeholderText || rangeText === anchorHandle.label)) {
      anchorHandle.trackingRange.deleteContents();
      signalEditorChanged(editor, "deleteContentBackward");
      return;
    }

    if (Editor.removeNormalizedUploadPlaceholder(editor, anchorHandle, insertedImage)) {
      signalEditorChanged(editor, "deleteContentBackward");
    }
  }

  function signalEditorChanged(editor, inputType) {
    let event;
    try {
      event = new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType,
        data: null
      });
    } catch (_error) {
      event = new Event("input", { bubbles: true, composed: true });
    }
    editor.dispatchEvent(event);
  }

  function friendlyUploadError(error) {
    if (error && error.code === "INLINE_ANCHOR_LOST") {
      return error.message;
    }
    if (error && (error.status === 401 || error.status === 403)) {
      if (error.nativeMessage) {
        return `${error.nativeMessage} Salesforce also blocked the backup upload.`.slice(0, 220);
      }
      return "Salesforce blocked the upload. Refresh the tab and confirm you can add Files to this Case.";
    }
    if (error && typeof error.message === "string" && error.message) {
      return error.message.slice(0, 220);
    }
    return "Salesforce did not accept the image. Your post text was left alone.";
  }

  function installNativeWarningGuard() {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          hideNativePasteWarning(node);
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  function hideNativePasteWarning(node) {
    if (!(node instanceof Element)) {
      return;
    }

    const text = (node.textContent || "").toLowerCase().replace(/\s+/g, " ");
    if (!text.includes(NATIVE_WARNING) || !text.includes(NATIVE_WARNING_HELP)) {
      return;
    }

    const warning = node.closest(".forceToastMessage, .slds-notify, [role='alert']") ||
      node.querySelector(".forceToastMessage, .slds-notify, [role='alert']") ||
      node;
    warning.style.setProperty("display", "none", "important");
    warning.setAttribute("aria-hidden", "true");
    queueMicrotask(() => warning.remove());
  }

  function showToast({ kind, title, message }) {
    const layer = ensureToastLayer();
    if (!layer) {
      return;
    }

    toastLayer.dataset.position = settings.toastPosition;
    toastLayer.style.setProperty("--casepaste-accent", kind === "error" ? "#e5484d" : settings.accentColor);

    const toast = createToastElement(kind, title, message);
    const closeButton = toast.querySelector(".toast__close");

    let removed = false;
    const dismiss = () => {
      if (removed) {
        return;
      }
      removed = true;
      toast.classList.add("toast--leaving");
      window.setTimeout(() => toast.remove(), 180);
    };
    closeButton.addEventListener("click", dismiss);
    layer.appendChild(toast);
    window.setTimeout(dismiss, settings.toastDuration);
  }

  function createToastElement(kind, title, message) {
    const toast = document.createElement("section");
    toast.className = `toast toast--${kind}`;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");

    const mark = document.createElement("div");
    mark.className = "toast__mark";
    mark.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const paths = kind === "error"
      ? ["M12 8v5m0 3.5v.01M10.2 4.8 3.3 17a2 2 0 0 0 1.75 3h13.9a2 2 0 0 0 1.75-3L13.8 4.8a2.07 2.07 0 0 0-3.6 0Z"]
      : ["m7 12.5 3.2 3.2L17.5 8.5", "M12 2.8a9.2 9.2 0 1 1 0 18.4 9.2 9.2 0 0 1 0-18.4Z"];
    for (const pathData of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
    }
    mark.appendChild(svg);

    const copy = document.createElement("div");
    copy.className = "toast__copy";
    const heading = document.createElement("strong");
    heading.className = "toast__title";
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.className = "toast__message";
    detail.textContent = message;
    copy.append(heading, detail);

    const closeButton = document.createElement("button");
    closeButton.className = "toast__close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Dismiss notification");
    closeButton.textContent = "×";

    const timer = document.createElement("div");
    timer.className = "toast__timer";
    timer.setAttribute("aria-hidden", "true");
    timer.style.setProperty("--casepaste-duration", `${settings.toastDuration}ms`);

    toast.append(mark, copy, closeButton, timer);
    return toast;
  }

  function ensureToastLayer() {
    if (toastLayer && toastLayer.isConnected && toastShadow) {
      return toastShadow.querySelector(".stack");
    }

    const parent = document.documentElement || document.body;
    if (!parent) {
      return null;
    }

    toastLayer = document.createElement("div");
    toastLayer.id = "casepaste-toast-layer";
    toastLayer.dataset.position = settings.toastPosition;
    toastLayer.style.setProperty("--casepaste-accent", settings.accentColor);
    toastShadow = toastLayer.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light dark; position: fixed; z-index: 2147483647; pointer-events: none; }
      :host([data-position="top-right"]) { top: 18px; right: 18px; }
      :host([data-position="top-left"]) { top: 18px; left: 18px; }
      :host([data-position="bottom-right"]) { bottom: 18px; right: 18px; }
      :host([data-position="bottom-left"]) { bottom: 18px; left: 18px; }
      .stack { display: flex; flex-direction: column; gap: 10px; width: min(390px, calc(100vw - 36px)); }
      .toast { animation: enter 180ms ease-out; background: rgba(255,255,255,.96); border: 1px solid rgba(15,23,42,.13); border-radius: 16px; box-shadow: 0 18px 50px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08); color: #182035; display: grid; grid-template-columns: 38px minmax(0,1fr) 28px; gap: 10px; overflow: hidden; padding: 13px 13px 15px; pointer-events: auto; position: relative; }
      .toast--leaving { animation: leave 180ms ease-in forwards; }
      .toast__mark { align-items: center; background: color-mix(in srgb, var(--casepaste-accent) 13%, transparent); border-radius: 11px; color: var(--casepaste-accent); display: flex; height: 36px; justify-content: center; width: 36px; }
      .toast__mark svg { fill: none; height: 21px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 21px; }
      .toast__copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding-top: 1px; }
      .toast__title { font: 700 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-wrap: anywhere; }
      .toast__message { color: #5f687c; font: 400 13px/1.42 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-wrap: anywhere; }
      .toast__close { appearance: none; background: transparent; border: 0; border-radius: 8px; color: #737b8d; cursor: pointer; font: 400 22px/24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; height: 28px; padding: 0; width: 28px; }
      .toast__close:hover { background: rgba(15,23,42,.07); color: #182035; }
      .toast__close:focus-visible { outline: 2px solid var(--casepaste-accent); outline-offset: 1px; }
      .toast__timer { animation: timer var(--casepaste-duration) linear forwards; background: var(--casepaste-accent); bottom: 0; height: 3px; left: 0; opacity: .8; position: absolute; transform-origin: left; width: 100%; }
      @keyframes enter { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
      @keyframes leave { to { opacity: 0; transform: translateY(-4px) scale(.98); } }
      @keyframes timer { to { transform: scaleX(0); } }
      @media (prefers-color-scheme: dark) {
        .toast { background: rgba(27,30,39,.97); border-color: rgba(255,255,255,.12); box-shadow: 0 20px 55px rgba(0,0,0,.42); color: #f5f7fb; }
        .toast__message { color: #b8becc; }
        .toast__close { color: #aeb5c4; }
        .toast__close:hover { background: rgba(255,255,255,.08); color: #fff; }
      }
      @media (prefers-reduced-motion: reduce) { .toast, .toast--leaving, .toast__timer { animation: none; } }
    `;
    const stack = document.createElement("div");
    stack.className = "stack";
    toastShadow.append(style, stack);
    parent.appendChild(toastLayer);
    return stack;
  }
})();
