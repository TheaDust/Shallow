export function RepoPageHeader({
  owner,
  name,
  branch,
  context,
}: {
  owner: string;
  name: string;
  branch?: string;
  context?: string;
}) {
  return (
    <header className="code-page__header">
      <h1>
        <a href={`#/repos/${owner}/${name}`} className="code-page__repo">
          {owner}/{name}
        </a>
      </h1>
      {branch ? <span className="code-page__branch">Branch: {branch}</span> : null}
      {context ? <span className="code-page__branch">{context}</span> : null}
    </header>
  );
}
