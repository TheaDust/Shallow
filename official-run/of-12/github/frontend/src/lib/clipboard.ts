/**
 * Clipboard write used by the repository clone menu (REQ-3-2-3).
 *
 * The asynchronous Clipboard API only exists in a secure context and may still
 * reject a write (for example while the document is not focused), so the
 * selection-based copy command runs as a fallback. Both paths start from the
 * user's click, which is the gesture a browser requires before it lets a page
 * write to the clipboard.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based copy.
    }
  }
  return copyThroughSelection(text);
}

/** Legacy copy: selects a temporary field and runs the copy command. */
function copyThroughSelection(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.top = "-1000px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
