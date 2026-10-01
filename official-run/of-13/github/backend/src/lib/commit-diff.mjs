// Line-level comparison between two commit snapshots.
//
// A commit stores the complete file list of its revision, so a diff is a pure
// function of two stored snapshots: nothing here reads or writes branches,
// commits or files. `diffSnapshots` keeps only the paths whose content really
// changed, which is what every commit, comparison and file diff view shows.

function fileMap(commit) {
  const map = new Map();
  const files = Array.isArray(commit?.files) ? commit.files : [];
  for (const file of files) {
    if (typeof file?.path === "string") {
      map.set(file.path, typeof file.content === "string" ? file.content : "");
    }
  }
  return map;
}

/** Splits stored content into lines, ignoring one trailing newline. */
export function splitContentLines(content) {
  if (typeof content !== "string" || content.length === 0) return [];
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n");
}

/**
 * Longest-common-subsequence line diff. Each entry is
 * `{ type: "context" | "add" | "remove", text }`, ordered like the compare
 * revision with the removed lines kept at their position.
 */
export function lineDiff(baseContent, compareContent) {
  const before = splitContentLines(baseContent);
  const after = splitContentLines(compareContent);

  // lcs[i][j] = length of the LCS of before[i..] and after[j..]
  const lcs = Array.from({ length: before.length + 1 }, () =>
    new Array(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ type: "context", text: before[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ type: "remove", text: before[i] });
      i += 1;
    } else {
      lines.push({ type: "add", text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ type: "remove", text: before[i] });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ type: "add", text: after[j] });
    j += 1;
  }

  const additions = lines.filter((line) => line.type === "add").length;
  const deletions = lines.filter((line) => line.type === "remove").length;
  return { lines, additions, deletions };
}

function diffEntry(path, baseContent, compareContent) {
  const base = baseContent ?? "";
  const compare = compareContent ?? "";
  const { lines, additions, deletions } = lineDiff(base, compare);
  return {
    path,
    status:
      baseContent === undefined ? "added" : compareContent === undefined ? "removed" : "modified",
    additions,
    deletions,
    lines,
  };
}

/**
 * Every path whose content differs between the two revisions, with the
 * line-by-line additions and deletions of each one. Unchanged paths are left
 * out of the list, exactly like a change summary of a commit.
 */
export function diffSnapshots(baseCommit, compareCommit) {
  const baseFiles = fileMap(baseCommit);
  const compareFiles = fileMap(compareCommit);
  const paths = [...new Set([...baseFiles.keys(), ...compareFiles.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );

  const files = [];
  let additions = 0;
  let deletions = 0;
  for (const path of paths) {
    const baseContent = baseFiles.get(path);
    const compareContent = compareFiles.get(path);
    if (baseContent === compareContent) continue;
    const entry = diffEntry(path, baseContent, compareContent);
    files.push(entry);
    additions += entry.additions;
    deletions += entry.deletions;
  }
  return { files, additions, deletions };
}

/** The changed paths between two revisions, without the line detail. */
export function changedPaths(baseCommit, compareCommit) {
  return diffSnapshots(baseCommit, compareCommit).files.map((file) => file.path);
}
