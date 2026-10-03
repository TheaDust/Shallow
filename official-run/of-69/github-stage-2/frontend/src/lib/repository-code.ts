import type { RepositoryBranchOption, RepositoryCodeFile } from "./organization-api";
import {
  repositoryCodeUrl,
  type CodePageParams,
  type RepositoryOwnerRef,
} from "./routes";

/** The values the code page needs from a repository detail payload. */
export interface RepositoryCodeSource {
  branch?: string | null;
  branches?: RepositoryBranchOption[] | null;
  files?: RepositoryCodeFile[] | null;
  readme?: { path: string; content: string } | null;
  repository: { defaultBranch?: string | null };
}

export interface CodeEntry {
  type: "directory" | "file";
  /** The exact accessible name of the entry: the file or directory name. */
  name: string;
  path: string;
  href: string;
}

export interface CodeFileView {
  path: string;
  name: string;
  content: string;
  href: string;
}

export interface RepositoryCodeModel {
  /** The branch the listing and the file view read. */
  branch: string;
  /** The branches the selector offers. */
  branches: RepositoryBranchOption[];
  /** The directory currently listed ("" at the repository root). */
  path: string;
  entries: CodeEntry[];
  /** The file opened by `?file=`, or null when only a directory is listed. */
  file: CodeFileView | null;
}

function normalizePath(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}

function baseName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/**
 * The files of one branch. A payload that predates the file listing (only the
 * default-branch README was sent) still yields that one readable file, so the
 * README link of the overview keeps working.
 */
export function codeFiles(source: RepositoryCodeSource): RepositoryCodeFile[] {
  if (source.files) return source.files;
  return source.readme ? [{ path: source.readme.path, content: source.readme.content }] : [];
}

/**
 * Direct children of `path`: directories first, then files, each alphabetical.
 * A directory is only a path prefix of the stored files, never a record.
 */
export function directoryEntries(
  files: readonly RepositoryCodeFile[],
  path: string,
): { type: "directory" | "file"; name: string; path: string }[] {
  const prefix = path ? `${path}/` : "";
  const directories = new Set<string>();
  const entries: { type: "directory" | "file"; name: string; path: string }[] = [];
  for (const file of files) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) entries.push({ type: "file", name: rest, path: `${prefix}${rest}` });
    else directories.add(rest.slice(0, slash));
  }
  return [
    ...[...directories]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ type: "directory" as const, name, path: `${prefix}${name}` })),
    ...entries.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

/**
 * The code page state of one repository: the selected branch, the listed
 * directory and (when `?file=` names one) the opened read-only file. Every
 * entry links to the same page with the branch, path and file in the address,
 * so the view is shareable, directly openable and stable across a reload.
 */
export function buildCodeModel(
  owner: RepositoryOwnerRef,
  repository: string,
  source: RepositoryCodeSource,
  params: CodePageParams,
): RepositoryCodeModel {
  const defaultBranch = source.repository.defaultBranch ?? null;
  const branch = source.branch ?? defaultBranch ?? "main";
  const branches =
    source.branches && source.branches.length > 0 ? source.branches : [{ name: branch }];
  const files = codeFiles(source);
  const path = normalizePath(params.path);
  const includeBranch = defaultBranch && branch !== defaultBranch ? branch : undefined;
  const entries = directoryEntries(files, path).map((entry) => ({
    ...entry,
    href: repositoryCodeUrl(owner, repository, {
      branch: includeBranch,
      path: entry.type === "directory" ? entry.path : path || undefined,
      file: entry.type === "file" ? entry.path : undefined,
    }),
  }));
  const requested = typeof params.file === "string" ? normalizePath(params.file) : "";
  const found = requested ? files.find((file) => file.path === requested) : undefined;
  const file = found
    ? {
        path: found.path,
        name: baseName(found.path),
        content: found.content ?? "",
        href: repositoryCodeUrl(owner, repository, {
          branch: includeBranch,
          path: directoryOf(found.path) || undefined,
          file: found.path,
        }),
      }
    : null;
  return { branch, branches, path, entries, file };
}
