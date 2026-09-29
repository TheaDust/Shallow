/**
 * Clipboard write used by the clone popover (REQ-3-2-3). The asynchronous Clipboard
 * API is preferred; the legacy selection copy is the fallback for browsers that do
 * not expose it. A rejected write is reported to the caller so the page can show an
 * unavailable state instead of silent success.
 */
export async function writeToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy copy below.
    }
  }
  if (legacyCopy(text)) return;
  throw new Error("Clipboard is unavailable");
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
