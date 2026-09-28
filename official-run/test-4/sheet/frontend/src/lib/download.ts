/**
 * Fetch text from a same-origin URL and start a browser download of it.
 * Returns a promise that resolves once the download has been triggered.
 */
export async function downloadText(
  url: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `Download failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      message = body.error;
    }
    throw new Error(message);
  }
  const text = await response.text();
  const blob = new Blob([text], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to begin the download before releasing the object URL.
  window.setTimeout(() => {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
  }, 10_000);
}
