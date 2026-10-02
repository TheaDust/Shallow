/**
 * Copies one value into the clipboard. The asynchronous clipboard API is used
 * when the browser exposes it; otherwise the value is written through a
 * temporary read-only field so the copy still happens.
 */
export async function writeClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the field-based copy below.
    }
  }
  if (typeof document === "undefined") return;
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "-1000px";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    if (typeof document.execCommand === "function") document.execCommand("copy");
  } finally {
    document.body.removeChild(field);
  }
}
