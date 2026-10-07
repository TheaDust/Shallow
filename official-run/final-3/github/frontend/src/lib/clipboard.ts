/**
 * Copy a read-only value (for example a repository clone address) to the
 * clipboard.
 *
 * The asynchronous Clipboard API is preferred, but it rejects with
 * `NotAllowedError` whenever the surrounding document is not a focused secure
 * context with an effective `clipboard-write` grant. The selection-based
 * `document.execCommand("copy")` fallback only needs the user gesture of the
 * click that triggered the copy, so a visitor who can see the value can still
 * copy it. The function resolves when the value reached the clipboard and throws
 * only when neither path is available; it never mutates application state.
 */
export async function writeClipboardText(value: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return;
    } catch {
      // Permission denied or document not focused: fall through to the fallback.
    }
  }
  if (!copyThroughSelection(value)) {
    throw new Error("Clipboard unavailable");
  }
}

function copyThroughSelection(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  // Keep the element off screen but still selectable, so the copied value never
  // flashes inside the popover.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  let copied = false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, value.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(area);
  }
  return copied;
}
