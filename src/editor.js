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
    removeNormalizedUploadPlaceholder
  });
});
