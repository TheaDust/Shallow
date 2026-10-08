// Line-level comparison of two stored file snapshots.
//
// A commit stores the complete file list of one revision, so the difference of a
// commit against its parent revision is derived here instead of being stored
// twice: the stored snapshots stay the single source of truth for both the tree
// and the diff view, and a commit can never disagree with its own history.

// Above this many cells the quadratic alignment is skipped and the two contents
// are reported as a full replacement, which keeps a huge file from blocking the
// request. Seeded and browser-created files stay far below the limit.
const MAX_ALIGNMENT_CELLS = 250_000;

/** Splits content into lines; a trailing newline does not create an empty line. */
export function splitContentLines(content) {
  const text = typeof content === "string" ? content : "";
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Longest-common-subsequence alignment of two line arrays. */
function alignLines(base, compare) {
  const baseCount = base.length;
  const compareCount = compare.length;
  const table = Array.from({ length: baseCount + 1 }, () => new Uint32Array(compareCount + 1));
  for (let i = baseCount - 1; i >= 0; i -= 1) {
    for (let j = compareCount - 1; j >= 0; j -= 1) {
      table[i][j] =
        base[i] === compare[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  while (i < baseCount && j < compareCount) {
    if (base[i] === compare[j]) {
      lines.push({ type: "context", text: base[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "removed", text: base[i] });
      deletions += 1;
      i += 1;
      continue;
    }
    lines.push({ type: "added", text: compare[j] });
    additions += 1;
    j += 1;
  }
  while (i < baseCount) {
    lines.push({ type: "removed", text: base[i] });
    deletions += 1;
    i += 1;
  }
  while (j < compareCount) {
    lines.push({ type: "added", text: compare[j] });
    additions += 1;
    j += 1;
  }
  return { lines, additions, deletions };
}

/** Line diff of one file's old and new content. */
export function diffContent(baseContent, compareContent) {
  const base = splitContentLines(baseContent ?? "");
  const compare = splitContentLines(compareContent ?? "");
  if (base.length * compare.length > MAX_ALIGNMENT_CELLS) {
    return {
      lines: [
        ...base.map((text) => ({ type: "removed", text })),
        ...compare.map((text) => ({ type: "added", text })),
      ],
      additions: compare.length,
      deletions: base.length,
    };
  }
  return alignLines(base, compare);
}

function snapshotByPath(files) {
  const byPath = new Map();
  for (const file of files ?? []) {
    if (file?.path) byPath.set(file.path, String(file.content ?? ""));
  }
  return byPath;
}

/**
 * Difference between two revisions of the same repository. Files that are
 * missing on one side are reported as added or removed, so a root commit shows
 * its whole content as additions.
 */
export function diffFileSnapshots(baseFiles, compareFiles) {
  const base = snapshotByPath(baseFiles);
  const compare = snapshotByPath(compareFiles);
  const paths = [...new Set([...base.keys(), ...compare.keys()])].sort();
  const files = [];
  let additions = 0;
  let deletions = 0;
  for (const path of paths) {
    const before = base.get(path);
    const after = compare.get(path);
    if (before === after) continue;
    const diff = diffContent(before ?? "", after ?? "");
    additions += diff.additions;
    deletions += diff.deletions;
    files.push({
      path,
      status: before === undefined ? "added" : after === undefined ? "removed" : "modified",
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
  }
  return { files, totals: { files: files.length, additions, deletions } };
}
