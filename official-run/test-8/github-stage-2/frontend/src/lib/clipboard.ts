/**
 * Copies a clone value to the clipboard.
 *
 * The async Clipboard API is used when the browser exposes it (the visitor has
 * granted clipboard permission); a selection copy is the fallback so the
 * read-only value can still be taken on a browser without it. The caller shows
 * the “Copied” feedback only when this resolves `true`.
 */
export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or an unavailable API: fall through to the selection copy.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    document.body.removeChild(area);
    return Boolean(copied);
  } catch {
    return false;
  }
}
