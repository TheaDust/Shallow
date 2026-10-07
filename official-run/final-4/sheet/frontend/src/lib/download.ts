/**
 * Triggers a browser download of `text` under the suggested `fileName`.
 * Uses an object URL plus a temporary anchor with the `download` attribute so
 * the current page state is never navigated away from.
 */
export function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type: mimeType });
  const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : "";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (url && typeof URL.revokeObjectURL === "function") {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
