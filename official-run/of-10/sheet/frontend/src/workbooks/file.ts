/**
 * Reads a browser File as UTF-8 text. FileReader is used instead of Blob.text so the same
 * code path works in every supported browser and in the DOM test environment.
 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}
