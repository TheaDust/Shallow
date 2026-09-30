/**
 * Starts a browser download of a text file (used for CSV export). The blob URL is revoked
 * asynchronously: revoking it synchronously can cancel the download before the browser reads it.
 */
export function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
