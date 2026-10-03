/**
 * Reads a `File` as UTF-8 text. Uses `FileReader` so it also works in DOM
 * implementations (such as jsdom) that do not provide `Blob#text`.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the file"));
    reader.readAsText(file, "utf-8");
  });
}
