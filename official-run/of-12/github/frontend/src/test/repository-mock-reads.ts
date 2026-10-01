import type { MockRepositoryFile } from "./repository-server-mock";

/**
 * Read models the repository fixture shares with the server (REQ-4-2): the
 * line-by-line comparison of two file sets, its additions/deletions counts and
 * the language a file path belongs to. Keeping them next to the fixture instead
 * of inside the request dispatcher keeps the mock itself readable.
 */

export interface MockDiffLine {
  type: "context" | "added" | "removed";
  text: string;
}

export interface MockFileDiff {
  path: string;
  change: string;
  additions: number;
  deletions: number;
  lines: MockDiffLine[];
}

/** The lines of a file value; a trailing newline adds no empty line. */
export function splitLines(value: string): string[] {
  if (!value) return [];
  const lines = value.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A line-by-line comparison, mirroring the server's read model. */
export function lineDiff(baseContent: string, compareContent: string) {
  const baseLines = splitLines(baseContent);
  const compareLines = splitLines(compareContent);
  const lines: Array<{ type: "context" | "added" | "removed"; text: string }> = [];
  let start = 0;
  while (start < baseLines.length && start < compareLines.length && baseLines[start] === compareLines[start]) {
    lines.push({ type: "context", text: baseLines[start] });
    start += 1;
  }
  let endBase = baseLines.length;
  let endCompare = compareLines.length;
  while (endBase > start && endCompare > start && baseLines[endBase - 1] === compareLines[endCompare - 1]) {
    endBase -= 1;
    endCompare -= 1;
  }
  const middleBase = baseLines.slice(start, endBase);
  const middleCompare = compareLines.slice(start, endCompare);
  const table: number[][] = [];
  for (let row = 0; row <= middleBase.length; row += 1) table.push(new Array(middleCompare.length + 1).fill(0));
  for (let row = 1; row <= middleBase.length; row += 1) {
    for (let column = 1; column <= middleCompare.length; column += 1) {
      table[row][column] = middleBase[row - 1] === middleCompare[column - 1]
        ? table[row - 1][column - 1] + 1
        : Math.max(table[row - 1][column], table[row][column - 1]);
    }
  }
  const middle: Array<{ type: "context" | "added" | "removed"; text: string }> = [];
  let row = middleBase.length;
  let column = middleCompare.length;
  while (row > 0 && column > 0) {
    if (middleBase[row - 1] === middleCompare[column - 1]) {
      middle.push({ type: "context", text: middleBase[row - 1] });
      row -= 1;
      column -= 1;
    } else if (table[row - 1][column] >= table[row][column - 1]) {
      middle.push({ type: "removed", text: middleBase[row - 1] });
      row -= 1;
    } else {
      middle.push({ type: "added", text: middleCompare[column - 1] });
      column -= 1;
    }
  }
  while (row > 0) {
    middle.push({ type: "removed", text: middleBase[row - 1] });
    row -= 1;
  }
  while (column > 0) {
    middle.push({ type: "added", text: middleCompare[column - 1] });
    column -= 1;
  }
  lines.push(...middle.reverse());
  for (let index = endBase; index < baseLines.length; index += 1) {
    lines.push({ type: "context", text: baseLines[index] });
  }
  return {
    lines,
    additions: lines.filter((line) => line.type === "added").length,
    deletions: lines.filter((line) => line.type === "removed").length,
  };
}

export function revisionChanges(baseTree: MockRepositoryFile[], compareTree: MockRepositoryFile[]) {
  const paths = [...new Set([...baseTree.map((file) => file.path), ...compareTree.map((file) => file.path)])].sort();
  const files: MockFileDiff[] = [];
  for (const path of paths) {
    const before = baseTree.find((file) => file.path === path);
    const after = compareTree.find((file) => file.path === path);
    if ((before?.content ?? null) === (after?.content ?? null)) continue;
    const diff = lineDiff(before?.content ?? "", after?.content ?? "");
    files.push({
      path,
      change: before ? (after ? "modified" : "removed") : "added",
      additions: diff.additions,
      deletions: diff.deletions,
      lines: diff.lines,
    });
  }
  return files;
}

export function diffSummary(files: Array<{ additions: number; deletions: number }>) {
  return {
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

/**
 * The lines of one changed file with the number each side shows (REQ-6-3): an
 * added line is anchored by its number on the new side, a removed line by its
 * number on the old side, and a context line belongs to both sides. The mirror
 * of the server's line numbering, so the fixture offers the same anchor.
 */
export function numberFileLines(file: {
  path: string;
  change: string;
  additions: number;
  deletions: number;
  lines: Array<{ type: string; text: string }>;
}) {
  let oldNumber = 0;
  let newNumber = 0;
  const lines = file.lines.map((line, index) => {
    const removed = line.type === "removed" || line.type === "context";
    const added = line.type === "added" || line.type === "context";
    if (removed) oldNumber += 1;
    if (added) newNumber += 1;
    return {
      index: index + 1,
      type: line.type,
      text: line.text,
      oldNumber: removed ? oldNumber : null,
      newNumber: added ? newNumber : null,
      lineNumber: line.type === "removed" ? oldNumber : newNumber,
      side: line.type === "added" ? "added" : line.type === "removed" ? "removed" : "context",
    };
  });
  return { ...file, lines };
}

const LANGUAGES: Record<string, string> = {
  md: "Markdown",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  txt: "Text",
};

export function fileLanguage(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return LANGUAGES[extension] ?? "Other";
}

export function fileName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

