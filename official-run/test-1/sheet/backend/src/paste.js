/**
 * Paste parsing (REQ-3-1-2).
 * Clipboard text uses tab-separated columns and newline-separated rows. Empty
 * fields inside the rectangle are preserved (e.g. "a\t\tb" has three fields);
 * a single trailing newline does not produce an extra empty row.
 */

/**
 * Parse clipboard text into rows of tab-separated fields.
 * Returns { rows: string[][] } (always rows).
 */
export function parsePasteText(text) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  // A trailing newline produces one empty trailing line; drop it like a
  // spreadsheet does, while interior empty rows are preserved.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}
