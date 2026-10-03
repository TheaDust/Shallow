import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchCommitDetail } from "../lib/organization-api";
import { relativeTime } from "../lib/relative-time";
import type { RepositoryOwnerType } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

export interface RepositoryCommitPageProps {
  ownerType: RepositoryOwnerType;
  owner: string;
  repository: string;
  commitId: string;
}

const LINE_PREFIX: Record<string, string> = {
  addition: "+",
  deletion: "-",
  context: " ",
};

/**
 * One commit and the difference it represents against its parent revision: the
 * changed files with a line-by-line comparison and their numeric additions and
 * deletions. The comparison is read-only — it never creates a review, comment,
 * commit or branch change.
 */
export function RepositoryCommitPage({
  ownerType,
  owner,
  repository,
  commitId,
}: RepositoryCommitPageProps) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchCommitDetail(owner, repository, commitId), [owner, repository, commitId]);
  const loaded = detail.data;

  return (
    <RepositoryLayout
      owner={{ type: ownerType, name: owner, displayName: loaded?.owner.displayName ?? owner }}
      repositoryName={repository}
      activeSection="commits"
      canManage={loaded?.viewer.canManage ?? false}
      visibility={loaded?.repository.visibility ?? null}
      account={account}
      heading={loaded ? loaded.commit.message : "Commit"}
    >
      {detail.loading ? <p role="status">Loading commit…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <>
          <p className="revision-context">
            {loaded.branch ? (
              <>
                Branch: <span className="revision-context__value">{loaded.branch}</span>
              </>
            ) : null}
            <span className="commit-detail__author">{loaded.commit.author}</span>
            <time className="commit-detail__date" dateTime={loaded.commit.createdAt}>
              {relativeTime(loaded.commit.createdAt)}
            </time>
          </p>
          {loaded.commit.parentId ? (
            <p className="commit-detail__base">
              Base revision:{" "}
              <span className="commit-detail__base-revision">
                {loaded.commit.parentMessage ?? loaded.commit.parentId}
              </span>
            </p>
          ) : null}
          <section className="commit-diff" aria-labelledby="commit-files-heading">
            <h2 id="commit-files-heading">Changed files</h2>
            <p className="diff-summary">
              <span className="diff-summary__files">{loaded.totals.files} files changed</span>
              <span className="diff-summary__additions">{loaded.totals.additions} additions</span>
              <span className="diff-summary__deletions">{loaded.totals.deletions} deletions</span>
            </p>
            {loaded.files.map((file) => (
              <section key={file.path} className="diff-file" aria-labelledby={`diff-file-${file.path}`}>
                <h3 id={`diff-file-${file.path}`} className="diff-file__path">
                  {file.path}
                </h3>
                <p className="diff-file__stat">
                  <span className="diff-file__additions">{`+${file.additions}`}</span>
                  <span className="diff-file__deletions">{`-${file.deletions}`}</span>
                </p>
                <div className="diff-file__lines">
                  {file.lines.map((line, index) => (
                    <div key={index} className="diff-line" data-kind={line.type}>
                      <span className="diff-line__sign" aria-hidden="true">
                        {LINE_PREFIX[line.type] ?? " "}
                      </span>
                      <span className="diff-line__text">{line.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </section>
        </>
      ) : null}
    </RepositoryLayout>
  );
}
