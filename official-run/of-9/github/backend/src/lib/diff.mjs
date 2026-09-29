// Line-by-line diff between two text values. Produces an ordered list of
// lines annotated as context, addition or deletion, plus the number of added
// and deleted lines. Used by the commit/revision diff views; does not modify
// any stored state.

function splitLines(text) {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // Longest common subsequence over lines.
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: "context", line: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "del", line: a[i] });
      i += 1;
    } else {
      lines.push({ type: "add", line: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: "del", line: a[i] });
    i += 1;
  }
  while (j < m) {
    lines.push({ type: "add", line: b[j] });
    j += 1;
  }

  const additions = lines.filter((entry) => entry.type === "add").length;
  const deletions = lines.filter((entry) => entry.type === "del").length;
  return { lines, additions, deletions };
}
