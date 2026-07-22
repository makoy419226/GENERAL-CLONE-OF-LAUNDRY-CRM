const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;

  const editableElement = element.closest<HTMLElement>(
    "input, textarea, [contenteditable], [role='textbox']",
  );
  if (!editableElement) return false;

  if (editableElement instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(editableElement.type);
  }

  return (
    editableElement instanceof HTMLTextAreaElement ||
    editableElement.isContentEditable ||
    editableElement.getAttribute("role") === "textbox"
  );
}

export function isEditableKeyboardShortcutTarget(event: KeyboardEvent): boolean {
  const eventTarget = event.target instanceof Element ? event.target : null;
  if (isEditableElement(eventTarget)) return true;

  const activeElement =
    eventTarget?.ownerDocument.activeElement ?? document.activeElement;

  return activeElement instanceof Element && isEditableElement(activeElement);
}
