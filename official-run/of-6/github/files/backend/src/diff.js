'use strict';

/**
 * REQ-4-2-2: pure line-by-line diff helpers shared by the commit detail and
 * compare endpoints. The diff is computed between the base and compare file
 * snapshots line by line (longest common subsequence), producing a stable
 * sequence of context/add/delete lines plus the numeric additions/deletions
 * summary. Files whose content is identical on both sides are unchanged and
 * are excluded by the caller.
 */

/**
 * Splits a file's content into lines. A single trailing newline does not
 * produce an extra empty line (standard text-file convention); a null/empty
 * content (a file absent on one side) yields no lines.
 */
function splitLines(content) {
  if (content === null || content === undefined) {
    return [];
  }
  const lines = String(content).split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Line diff of two line arrays via longest common subsequence. Returns the
 * ordered diff lines ({ type: 'context'|'add'|'del', text }) and the exact
 * numbers of added and deleted lines. Deterministic: equal lines are always
 * matched as context before adjacent changes are emitted.
 */
function diffLines(aLines, bLines) {
  const a = aLines || [];
  const b = bLines || [];
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const lines = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i] });
      deletions += 1;
      i += 1;
    } else {
      lines.push({ type: 'add', text: b[j] });
      additions += 1;
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: 'del', text: a[i] });
    deletions += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j] });
    additions += 1;
    j += 1;
  }
  return { lines, additions, deletions };
}

/**
 * Content-level diff: baseContent may be null (the file is new on the
 * compare side) and compareContent may be null (the file was deleted).
 */
function diffContent(baseContent, compareContent) {
  return diffLines(splitLines(baseContent), splitLines(compareContent));
}

module.exports = { splitLines, diffLines, diffContent };
