import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchRepositoryCommits } from "../lib/organization-api";
import { useHashLocation } from "../lib/hash-route";
import { relativeTime } from "../lib/relative-time";
import { repositoryCommitUrl, type RepositoryOwnerType } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

export interface RepositoryCommitsPageProps {
  ownerType: RepositoryOwnerType;
  owner: string;
  repository: string;
}

/**
 * The commit history of one branch, newest first: every record is an immutable
 * change with its message, author and time. The page is read-only and follows
 * the repository's read permission.
 */
export function RepositoryCommitsPage({ ownerType, owner, repository }: RepositoryCommitsPageProps) {
  const { account } = useSession();
  const location = useHashLocation();
  const branch = location.search.get("branch") ?? undefined;
  const path = location.search.get("path") ?? undefined;
  const detail = useAsyncData(
    () => fetchRepositoryCommits(owner, repository, { branch, path }),
    [owner, repository, branch, path],
  );
  const loaded = detail.data;

  return (
    <RepositoryLayout
      owner={{ type: ownerType, name: owner, displayName: loaded?.owner.displayName ?? owner }}
      repositoryName={repository}
      activeSection="commits"
      canManage={loaded?.viewer.canManage ?? false}
      visibility={loaded?.repository.visibility ?? null}
      account={account}
      heading="Commits"
    >
      {detail.loading ? <p role="status">Loading commits…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <>
          <p className="revision-context">
            Branch: <span className="revision-context__value">{loaded.branch}</span>
          </p>
          {loaded.commits.length > 0 ? (
            <ul className="commit-list">
              {loaded.commits.map((commit) => (
                <li key={commit.id} className="commit-list__item">
                  <a
                    className="commit-list__message"
                    href={repositoryCommitUrl(ownerType, owner, repository, commit.id)}
                  >
                    {commit.message}
                  </a>
                  <span className="commit-list__author">{commit.author}</span>
                  <time className="commit-list__date" dateTime={commit.createdAt}>
                    {relativeTime(commit.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p>No commits yet.</p>
          )}
        </>
      ) : null}
    </RepositoryLayout>
  );
}
