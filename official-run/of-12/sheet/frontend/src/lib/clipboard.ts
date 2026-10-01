/**
 * Reads the external clipboard through the async Clipboard API. Returns `null` when the browser
 * cannot provide it (no permission, insecure context, API missing), so the caller can report the
 * failure instead of pasting empty content.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.readText !== "function") return null;
    const text = await clipboard.readText();
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * Writes the text of a copied/cut range to the system clipboard, so an external paste elsewhere
 * receives the same table. Returns `false` when the browser refuses the write (the in-application
 * clipboard keeps working through the range transfer endpoint).
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
