export type RepositorySettingsTab = "general" | "access" | "branches";

export function RepositorySettingsNav({
  owner,
  name,
  tab,
}: {
  owner: string;
  name: string;
  tab: RepositorySettingsTab;
}) {
  const base = `#/repos/${owner}/${name}/settings`;
  return (
    <nav className="repository-settings__nav" aria-label="Repository settings">
      <a href={base} aria-current={tab === "general" ? "page" : undefined}>
        General
      </a>
      <a
        href={`${base}/access`}
        aria-current={tab === "access" ? "page" : undefined}
      >
        Manage access
      </a>
      <a
        href={`${base}/branches`}
        aria-current={tab === "branches" ? "page" : undefined}
      >
        Branches
      </a>
    </nav>
  );
}
