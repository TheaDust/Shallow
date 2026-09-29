export type RepoTab = "code" | "issues" | "pulls";

export function RepoNav({
  owner,
  name,
  active,
}: {
  owner: string;
  name: string;
  active: RepoTab;
}) {
  const tabs: Array<{ id: RepoTab; label: string; href: string }> = [
    { id: "code", label: "Code", href: `#/repos/${owner}/${name}/tree` },
    { id: "issues", label: "Issues", href: `#/repos/${owner}/${name}/issues` },
    { id: "pulls", label: "Pull requests", href: `#/repos/${owner}/${name}/pulls` },
  ];
  return (
    <nav className="repo-tabs" aria-label="Repository">
      {tabs.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          className={active === tab.id ? "repo-tabs__tab repo-tabs__tab--active" : "repo-tabs__tab"}
          aria-current={active === tab.id ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
