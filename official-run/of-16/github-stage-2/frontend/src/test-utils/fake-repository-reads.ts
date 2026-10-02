import {
  branchOf,
  branchNamesOf,
  commitRecordsOf,
  contentLines,
  defaultBranchNameOf,
  directoryEntriesOf,
  headSnapshotOf,
  type FakeRepository,
} from "./fake-repository-content";

export interface FakeResponse {
  status: number;
  body: unknown;
}

export interface RepositoryOwnerRef {
  kind: "organization" | "account";
  name: string;
  slug: string;
}

/** What the read-only repository handlers need from the enclosing fake API. */
export interface RepositoryReadContext {
  /** Username of the signed-in account, or null for a visitor. */
  signedInUsername: string | null;
  ok(status: number, body: unknown): FakeResponse;
  ownerRef(ownerKind: "organization" | "account", ownerSlug: string): RepositoryOwnerRef;
  defaultBranchOf(repository: FakeRepository): string;
  findRepositoryRecord(
    ownerKind: "organization" | "account",
    ownerSlug: string,
    name: string,
  ): FakeRepository | null;
  canReadRepository(
    ownerKind: "organization" | "account",
    ownerSlug: string,
    repository: FakeRepository,
  ): boolean;
}

interface ResolvedTarget {
  failure?: FakeResponse;
  ownerKind?: "organization" | "account";
  ownerSlug?: string;
  repository?: FakeRepository;
}

/** Resolves the addressed repository and applies the shared read rule. */
function resolveTarget(context: RepositoryReadContext, query: URLSearchParams): ResolvedTarget {
  const ownerKind = query.get("ownerKind") === "organization" ? "organization" as const : "account" as const;
  const ownerSlug = query.get("owner") ?? "";
  const repository = context.findRepositoryRecord(ownerKind, ownerSlug, query.get("name") ?? "");
  if (!repository) return { failure: context.ok(404, { error: "Not found" }) };
  if (!context.canReadRepository(ownerKind, ownerSlug, repository)) {
    return {
      failure: context.signedInUsername
        ? context.ok(403, { error: "Access denied" })
        : context.ok(404, { error: "Not found" }),
    };
  }
  return { ownerKind, ownerSlug, repository };
}

/**
 * Read-only repository endpoints of the fake API: the file page, the directory
 * listing, the commit history, one commit comparison and the repository code
 * search. Every one of them mirrors the server's read rule and never modifies
 * the stored repository.
 */
export function handleRepositoryReads(
  context: RepositoryReadContext,
  method: string,
  path: string,
): FakeResponse | undefined {
  if (method !== "GET" || !path.startsWith("/api/repositories/")) return undefined;
  const [routePath, search] = path.split("?");
  const query = new URLSearchParams(search ?? "");
  const target = resolveTarget(context, query);
  if (target.failure) return target.failure;
  const { ownerKind, ownerSlug, repository } = target as Required<ResolvedTarget>;
  const owner = context.ownerRef(ownerKind, ownerSlug);
  const requested = query.get("branch") ?? "";
  const branch = requested.length > 0 && branchNamesOf(repository).includes(requested)
    ? requested
    : defaultBranchNameOf(repository);

  switch (routePath) {
    case "/api/repositories/files": {
      const filePath = query.get("path") ?? "";
      const content = headSnapshotOf(repository, branch).get(filePath);
      if (content === undefined) return context.ok(404, { error: "Not found" });
      return context.ok(200, {
        file: {
          name: filePath.split("/").pop() ?? filePath,
          path: filePath,
          branch,
          content,
          repository: repository.name,
          owner,
        },
      });
    }
    case "/api/repositories/tree": {
      const directoryPath = query.get("path") ?? "";
      const files = [...headSnapshotOf(repository, branch).keys()];
      if (directoryPath.length > 0 && files.includes(directoryPath)) {
        return context.ok(404, { error: "Not found" });
      }
      return context.ok(200, {
        directory: {
          repository: repository.name,
          owner,
          branch,
          path: directoryPath,
          entries: directoryEntriesOf(files, directoryPath),
        },
      });
    }
    case "/api/repositories/commits": {
      const filePath = query.get("path") ?? "";
      const records = commitRecordsOf(repository, branch)
        .filter((record) => filePath.length === 0 || record.changedFiles.includes(filePath))
        .slice()
        .reverse();
      return context.ok(200, {
        history: {
          repository: repository.name,
          owner,
          branch,
          path: filePath,
          commits: records.map(({ files, ...record }) => record),
        },
      });
    }
    case "/api/repositories/commit": {
      const record = commitRecordsOf(repository, branch).find((entry) => entry.id === query.get("id"));
      if (!record) return context.ok(404, { error: "Not found" });
      return context.ok(200, { commit: { ...record, repository: repository.name, owner, branch } });
    }
    case "/api/repositories/code-search": {
      const raw = query.get("q") ?? "";
      const needle = raw.trim().toLowerCase();
      const results = [...headSnapshotOf(repository, branch)].flatMap(([filePath, content]) => {
        if (needle.length === 0) return [];
        const lines = contentLines(content)
          .map((text, index) => ({ number: index + 1, text }))
          .filter((line) => line.text.toLowerCase().includes(needle))
          .slice(0, 5);
        return lines.length === 0
          ? []
          : [{ path: filePath, name: filePath.split("/").pop() ?? filePath, lines }];
      }).sort((left, right) => left.path.localeCompare(right.path));
      return context.ok(200, {
        search: {
          repository: repository.name,
          owner,
          branch,
          query: raw,
          total: results.length,
          results,
        },
      });
    }
    default:
      return undefined;
  }
}
