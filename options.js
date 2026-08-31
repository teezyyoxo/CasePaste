(function startOptionsPage() {
  "use strict";

  const Core = globalThis.CasePasteCore;
  const form = document.querySelector("#settings-form");
  const resetButton = document.querySelector("#reset-button");
  const saveStatus = document.querySelector("#save-status");
  const preview = document.querySelector("#toast-preview");
  const toastControls = document.querySelector("#toast-controls");
  const durationValue = document.querySelector("#duration-value");
  const accentValue = document.querySelector("#accent-value");
  const filenameExample = document.querySelector("#filename-example");
  let savedSnapshot = "";

  void load();

  form.addEventListener("input", () => {
    refreshPreview();
    updateDirtyState();
  });
  form.addEventListener("change", () => {
    refreshPreview();
    updateDirtyState();
  });
  form.addEventListener("submit", save);
  resetButton.addEventListener("click", resetDefaults);

  async function load() {
    const stored = await chrome.storage.sync.get(Core.STORAGE_KEY);
    const options = Core.sanitizeSettings(stored[Core.STORAGE_KEY]);
    writeForm(options);
    savedSnapshot = JSON.stringify(options);
    refreshPreview();
    setStatus("Everything is ready for your next paste.", "saved");
  }

  function readForm() {
    return Core.sanitizeSettings({
      enabled: form.elements.enabled.checked,
      showSuccessToast: form.elements.showSuccessToast.checked,
      toastTitle: form.elements.toastTitle.value,
      toastMessage: form.elements.toastMessage.value,
      toastDuration: form.elements.toastDuration.value,
      toastPosition: form.elements.toastPosition.value,
      accentColor: form.elements.accentColor.value,
      filenamePrefix: form.elements.filenamePrefix.value,
      maxFileSizeMb: form.elements.maxFileSizeMb.value
    });
  }

  function writeForm(options) {
    form.elements.enabled.checked = options.enabled;
    form.elements.showSuccessToast.checked = options.showSuccessToast;
    form.elements.toastTitle.value = options.toastTitle;
    form.elements.toastMessage.value = options.toastMessage;
    form.elements.toastDuration.value = options.toastDuration;
    form.elements.toastPosition.value = options.toastPosition;
    form.elements.accentColor.value = options.accentColor;
    form.elements.filenamePrefix.value = options.filenamePrefix;
    form.elements.maxFileSizeMb.value = options.maxFileSizeMb;
  }

  function refreshPreview() {
    const options = readForm();
    const variables = {
      filename: `${options.filenamePrefix} image`,
      caseId: "5008a00001ABCDe",
      count: 1
    };
    const seconds = (options.toastDuration / 1000).toFixed(1).replace(/\.0$/, "");

    document.documentElement.style.setProperty("--accent", options.accentColor);
    document.querySelector("#preview-title").textContent = Core.renderTemplate(options.toastTitle, variables);
    document.querySelector("#preview-message").textContent = Core.renderTemplate(options.toastMessage, variables);
    preview.dataset.position = options.toastPosition;
    preview.setAttribute("aria-hidden", String(!options.showSuccessToast));
    toastControls.setAttribute("aria-disabled", String(!options.showSuccessToast));
    durationValue.textContent = `${seconds} ${seconds === "1" ? "second" : "seconds"}`;
    accentValue.textContent = options.accentColor;
    filenameExample.textContent = Core.makeFilename(
      options.filenamePrefix,
      "image/png",
      new Date("2026-08-31T14:32:08.000Z"),
      1
    );
  }

  function updateDirtyState() {
    const isDirty = JSON.stringify(readForm()) !== savedSnapshot;
    setStatus(
      isDirty ? "You have unsaved changes." : "Everything is ready for your next paste.",
      isDirty ? "dirty" : "saved"
    );
  }

  async function save(event) {
    event.preventDefault();
    const options = readForm();
    writeForm(options);
    await chrome.storage.sync.set({ [Core.STORAGE_KEY]: options });
    savedSnapshot = JSON.stringify(options);
    refreshPreview();
    setStatus("Saved. Your next paste will use these settings.", "saved");
  }

  function resetDefaults() {
    const options = Core.sanitizeSettings(Core.DEFAULTS);
    writeForm(options);
    refreshPreview();
    updateDirtyState();
    form.elements.enabled.focus();
  }

  function setStatus(message, state) {
    saveStatus.textContent = message;
    saveStatus.dataset.state = state;
  }
})();
