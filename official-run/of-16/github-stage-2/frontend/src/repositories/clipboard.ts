/**
 * Copies one read-only clone value. The async Clipboard API is used when the
 * browser provides it; a hidden textarea keeps the copy working in browsers or
 * test environments where the API is missing or refuses the request. The caller
 * only shows the "Copied" feedback when the copy actually succeeded.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    area.remove();
    return Boolean(copied);
  } catch {
    return false;
  }
}
