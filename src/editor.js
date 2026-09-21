(function exposeCasePasteEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.CasePasteEditor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCasePasteEditor() {
  "use strict";

  // An invisible signature lets cleanup find the placeholder after Salesforce
  // unwraps or rebuilds its temporary element during native image insertion.
  const UPLOAD_ANCHOR_SENTINEL = "\u2063";

  function makeUploadPlaceholder(label) {
    return `${UPLOAD_ANCHOR_SENTINEL}${label}${UPLOAD_ANCHOR_SENTINEL}`;
  }

  function hideNativeUploadSurfaces(document, editor) {
    const selector = ".slds-modal, .slds-backdrop, .modal-container, .modal-backdrop, .uiModal, [role='dialog']";
    const existing = new Set(document.querySelectorAll(selector));
    const hidden = new Set();
    const markNewSurfaces = () => {
      for (const surface of document.querySelectorAll(selector)) {
        if (!existing.has(surface) && !surface.contains(editor) && !hidden.has(surface) &&
            !Array.from(existing).some((original) => surface.contains(original))) {
          surface.setAttribute("data-casepaste-upload-surface", "");
          hidden.add(surface);
        }
      }
    };
    // Mutation observers run before paint, so the native picker never flashes.
    const observer = new document.defaultView.MutationObserver(markNewSurfaces);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "role"] });
    return () => {
      observer.disconnect();
      for (const surface of hidden) {
        surface.removeAttribute("data-casepaste-upload-surface");
      }
    };
  }

  function findUploadPlaceholderRange(editor, handle) {
    const document = editor.ownerDocument;
    const walker = document.createTreeWalker(editor, document.defaultView.NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const offset = node.data.indexOf(handle.placeholderText);
      if (offset !== -1) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + handle.placeholderText.length);
        return range;
      }
    }
    return null;
  }

  function createUploadBadge(document, label, options = {}) {
    const host = document.createElement("span");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { pointer-events: none !important; }
      .badge { box-sizing: border-box; display: inline-flex; align-items: center;
        gap: 6px; padding: 3px 9px; border: 1px solid color-mix(in srgb, var(--spinner-color, #5946cc) 44%, transparent); border-radius: 999px;
        background: var(--spinner-background, #ede9ff); color: var(--spinner-color, #5946cc); white-space: nowrap;
        font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .badge::before { content: ""; width: 9px; height: 9px; flex: 0 0 9px;
        border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
        animation: spin var(--spinner-duration, .8s) linear infinite; }
      .badge--dotted::before { border-style: dotted; border-right-color: currentColor; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .badge::before { animation: none; } }
    `;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.setAttribute("role", "status");
    badge.textContent = label;
    if (options.spinnerStyle === "dotted") badge.classList.add("badge--dotted");
    for (const [key, property] of [["spinnerColor", "--spinner-color"], ["spinnerBackground", "--spinner-background"]]) {
      if (/^#[0-9a-f]{6}$/i.test(options[key])) host.style.setProperty(property, options[key]);
    }
    host.style.setProperty("--spinner-duration", ({ slow: "1.4s", normal: ".8s", fast: ".5s" })[options.spinnerSpeed] || ".8s");
    shadow.append(style, badge);
    return { host, badge };
  }

  function showUploadIndicator(editor, handle, options) {
    const document = editor.ownerDocument;
    const view = document.defaultView;
    // Keep the badge outside Quill's content model so normalization cannot strip it.
    const { host, badge } = createUploadBadge(document, handle.label, options);
    host.dataset.casepasteUploadIndicator = "";
    Object.assign(host.style, { position: "fixed", zIndex: "2147483646", pointerEvents: "none", display: "none" });
    document.documentElement.appendChild(host);
    let frame;
    let stopped = false;
    const stop = () => {
      stopped = true;
      view.cancelAnimationFrame(frame);
      host.remove();
    };
    const update = () => {
      if (stopped) return;
      if (!editor.isConnected) {
        stop();
        return;
      }
      const target = editor.contains(handle.element) ? handle.element : findUploadPlaceholderRange(editor, handle);
      const rect = target && target.getBoundingClientRect();
      const bounds = editor.getBoundingClientRect();
      const visible = rect && rect.width && rect.height && rect.bottom > bounds.top &&
        rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
      host.style.display = visible ? "block" : "none";
      if (visible) {
        host.style.left = `${rect.left}px`;
        host.style.top = `${rect.top}px`;
        badge.style.minWidth = `${rect.width}px`;
      }
      frame = view.requestAnimationFrame(update);
    };
    frame = view.requestAnimationFrame(update);
    return stop;
  }

  function removeNormalizedUploadPlaceholder(editor, anchorHandle, insertedImage) {
    return removeSignedPlaceholder(editor, anchorHandle && anchorHandle.placeholderText) ||
      removePlainPlaceholderAfterImage(editor, insertedImage, anchorHandle && anchorHandle.label);
  }

  function removeSignedPlaceholder(editor, placeholderText) {
    if (!editor || !placeholderText) {
      return false;
    }

    const walker = editor.ownerDocument.createTreeWalker(
      editor,
      editor.ownerDocument.defaultView.NodeFilter.SHOW_TEXT
    );
    let textNode = walker.nextNode();
    while (textNode) {
      const markerIndex = textNode.data.indexOf(placeholderText);
      if (markerIndex !== -1) {
        textNode.deleteData(markerIndex, placeholderText.length);
        return true;
      }
      textNode = walker.nextNode();
    }
    return false;
  }

  function removePlainPlaceholderAfterImage(editor, image, label) {
    if (!editor || !image || !label || !image.isConnected || !editor.contains(image)) {
      return false;
    }

    const view = editor.ownerDocument.defaultView;
    const walker = editor.ownerDocument.createTreeWalker(editor, view.NodeFilter.SHOW_ALL);
    walker.currentNode = image;
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === view.Node.TEXT_NODE && node.data.trim()) {
        const labelIndex = node.data.indexOf(label);
        if (labelIndex === node.data.search(/\S/)) {
          node.deleteData(labelIndex, label.length);
          return true;
        }
        return false;
      }
      node = walker.nextNode();
    }
    return false;
  }

  return Object.freeze({
    makeUploadPlaceholder,
    hideNativeUploadSurfaces,
    showUploadIndicator,
    createUploadBadge,
    removeNormalizedUploadPlaceholder
  });
});
