(function installCasePasteFilePickerBridge() {
  "use strict";

  if (window.__casePasteFilePickerBridge) {
    return;
  }
  window.__casePasteFilePickerBridge = true;

  const ARM_EVENT = "casepaste:arm-native-image-upload";
  const ARM_ATTRIBUTE = "data-casepaste-native-arm";
  const HANDOFF_ATTRIBUTE = "data-casepaste-native-handoff";
  const PAYLOAD_PREFIX = "casepaste-native-payload-";
  let disarmCurrent = null;

  document.addEventListener(ARM_EVENT, () => {
    const root = document.documentElement;
    const token = root && root.getAttribute(ARM_ATTRIBUTE);
    if (!token || !/^[a-z0-9-]+$/i.test(token)) {
      return;
    }
    root.removeAttribute(ARM_ATTRIBUTE);
    if (disarmCurrent) {
      disarmCurrent();
    }
    disarmCurrent = armFilePicker(token);
  });

  function armFilePicker(token) {
    const clickPrototype = HTMLElement.prototype;
    const pickerPrototype = HTMLInputElement.prototype;
    const clickDescriptor = Object.getOwnPropertyDescriptor(clickPrototype, "click");
    const pickerDescriptor = Object.getOwnPropertyDescriptor(pickerPrototype, "showPicker");
    let active = true;
    let timer = null;

    const interceptFileInputClick = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") {
        return;
      }

      supplyPastedImage(input, token);
      event.preventDefault();
      restore();
    };

    const restore = () => {
      if (!active) {
        return;
      }
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("click", interceptFileInputClick, true);
      if (clickDescriptor) {
        Object.defineProperty(clickPrototype, "click", clickDescriptor);
      }
      if (pickerDescriptor) {
        Object.defineProperty(pickerPrototype, "showPicker", pickerDescriptor);
      }
      if (disarmCurrent === restore) {
        disarmCurrent = null;
      }
    };

    const makeInterceptor = (original) => function interceptFilePicker(...args) {
      if (!(this instanceof HTMLInputElement) || this.type !== "file") {
        return original.apply(this, args);
      }

      const supplied = supplyPastedImage(this, token);
      restore();
      if (!supplied) {
        return undefined;
      }
      return undefined;
    };

    try {
      if (clickDescriptor && typeof clickDescriptor.value === "function") {
        Object.defineProperty(clickPrototype, "click", {
          ...clickDescriptor,
          value: makeInterceptor(clickDescriptor.value)
        });
      }
      if (pickerDescriptor && typeof pickerDescriptor.value === "function") {
        Object.defineProperty(pickerPrototype, "showPicker", {
          ...pickerDescriptor,
          value: makeInterceptor(pickerDescriptor.value)
        });
      }
      document.addEventListener("click", interceptFileInputClick, true);
    } catch (_error) {
      restore();
      return () => {};
    }

    timer = window.setTimeout(restore, 5000);
    return restore;
  }

  function supplyPastedImage(input, token) {
    const payload = document.getElementById(`${PAYLOAD_PREFIX}${token}`);
    if (!payload) {
      return false;
    }

    try {
      const binary = atob(payload.textContent || "");
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const mimeType = payload.getAttribute("data-mime-type") || "image/png";
      const filename = payload.getAttribute("data-filename") || "CasePaste-image.png";
      const file = new File([bytes], filename, { type: mimeType });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      payload.remove();

      const root = document.documentElement;
      root.setAttribute(HANDOFF_ATTRIBUTE, token);
      queueMicrotask(() => {
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      });
      return true;
    } catch (_error) {
      payload.remove();
      return false;
    }
  }
})();
