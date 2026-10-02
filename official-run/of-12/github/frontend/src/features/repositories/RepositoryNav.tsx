export interface RepositoryNavProps {
  owner: string;
  name: string;
  /** The navigation entry the current page belongs to. */
  active: "code" | "issues" | "pulls" | "settings";
}

/**
 * The repository navigation of a page that carries no full repository header —
 * the settings pages. It spells the same entries as the repository header
 * (`Code`, `Issues`, `Pull requests`, `Settings`), so a page reached from
 * `Settings` keeps its way back to the pull requests of the repository.
 */
export function RepositoryNav({ owner, name, active }: RepositoryNavProps) {
  const base = `#/${owner}/${name}`;
  const entries: Array<{ id: RepositoryNavProps["active"]; label: string; href: string }> = [
    { id: "code", label: "Code", href: base },
    { id: "issues", label: "Issues", href: `${base}/issues` },
    { id: "pulls", label: "Pull requests", href: `${base}/pulls` },
    { id: "settings", label: "Settings", href: `${base}/settings` },
  ];
  return (
    <nav className="repository-nav" aria-label="Repository">
      {entries.map((entry) => (
        <a
          key={entry.id}
          className="repository-nav__link"
          href={entry.href}
          aria-current={entry.id === active ? "page" : undefined}
        >
          {entry.label}
        </a>
      ))}
    </nav>
  );
}
