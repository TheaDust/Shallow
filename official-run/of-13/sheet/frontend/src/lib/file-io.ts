/** Browser file input/output helpers, independent of the workbook domain. */

/** Reads a picked file as UTF-8 text (FileReader works in every supported browser). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the selected file"));
    reader.readAsText(file, "utf-8");
  });
}

/** Triggers a client-side text download without touching any application state. */
export function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = "text/csv;charset=utf-8",
): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next task so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
