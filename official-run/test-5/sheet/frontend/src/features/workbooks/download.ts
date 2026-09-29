/**
 * Starts a same-origin file download from a visible control. The file name is
 * suggested by the server through `Content-Disposition` (the empty `download`
 * attribute keeps that server-provided name).
 */
export function startDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}
