import {
  repositoryAccessSettingsHref,
  repositoryBranchesSettingsHref,
  repositoryGeneralSettingsHref,
} from "../lib/repository-routes";

export interface RepositorySettingsNavProps {
  owner: string;
  name: string;
  current: "general" | "access" | "branches" | null;
}

/**
 * Settings navigation shared by the repository Settings pages. Every entry is a
 * link, so Settings → General, Settings → Branches and Settings → Manage access
 * work when opened or refreshed directly.
 */
export function RepositorySettingsNav({ owner, name, current }: RepositorySettingsNavProps) {
  const entries = [
    { id: "general" as const, label: "General", href: repositoryGeneralSettingsHref(owner, name) },
    { id: "branches" as const, label: "Branches", href: repositoryBranchesSettingsHref(owner, name) },
    { id: "access" as const, label: "Manage access", href: repositoryAccessSettingsHref(owner, name) },
  ];

  return (
    <nav aria-label="Repository settings">
      <ul className="settings-nav">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={entry.href} aria-current={entry.id === current ? "page" : undefined}>
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
