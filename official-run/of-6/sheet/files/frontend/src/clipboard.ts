// Reads the OS clipboard text for the grid context menu "Paste" command
// (REQ-3-1-2). Requires the browser Clipboard API (secure context plus
// clipboard-read permission). Rejects when the API is unavailable or the
// permission is denied, so the caller can surface a visible error.
export function readExternalClipboardText(): Promise<string> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.readText !== 'function') {
    return Promise.reject(new Error('Clipboard API unavailable'));
  }
  return clipboard.readText();
}
