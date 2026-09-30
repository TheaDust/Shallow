/**
 * Line-level diff used by the commit and comparison views (REQ-4-2-2).
 *
 * The diff is computed from the two stored file contents, so a comparison can
 * never disagree with the content a branch or file read returns.
 */

/** Splits file text into lines; the single trailing newline is not a line of its own. */
export function splitLines(text) {
  const value = String(text ?? "");
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence diff of two texts as a flat list of rows in file
 * order: `context` rows exist in both revisions, `add` rows only in the newer
 * one and `remove` rows only in the older one. Line numbers refer to the
 * respective revision (`null` when that revision has no such line).
 */
export function diffLines(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const rows = [];
  const widths = after.length + 1;
  // LCS length table, computed bottom-up.
  const table = new Uint32Array((before.length + 1) * widths);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * widths + j] =
        before[i] === after[j]
          ? table[(i + 1) * widths + (j + 1)] + 1
          : Math.max(table[(i + 1) * widths + j], table[i * widths + (j + 1)]);
    }
  }

  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: "context", text: before[i], oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (table[(i + 1) * widths + j] >= table[i * widths + (j + 1)]) {
      rows.push({ kind: "remove", text: before[i], oldLine, newLine: null });
      i += 1;
      oldLine += 1;
    } else {
      rows.push({ kind: "add", text: after[j], oldLine: null, newLine });
      j += 1;
      newLine += 1;
    }
  }
  while (i < before.length) {
    rows.push({ kind: "remove", text: before[i], oldLine, newLine: null });
    i += 1;
    oldLine += 1;
  }
  while (j < after.length) {
    rows.push({ kind: "add", text: after[j], oldLine: null, newLine });
    j += 1;
    newLine += 1;
  }
  return rows;
}

export function diffStats(rows) {
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    if (row.kind === "add") additions += 1;
    else if (row.kind === "remove") deletions += 1;
  }
  return { additions, deletions };
}
