/** Writes a clone value to the browser clipboard (REQ-3-2-3). */
export async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path below when the permission is denied.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    document.body.removeChild(area);
    return Boolean(copied);
  } catch {
    return false;
  }
}
