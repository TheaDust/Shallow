/**
 * Reads a picked file as UTF-8 text. FileReader is used because it is available
 * in every browser target and in jsdom; `Blob.text()` is the fallback.
 */
export function readFileText(file: Blob): Promise<string> {
  if (typeof FileReader === "function") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file"));
      reader.readAsText(file, "utf-8");
    });
  }
  return file.text();
}
