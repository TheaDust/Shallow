import { makeHash } from "../lib/hash-route";
import { repositoryPath, settingsBranchesPath } from "../lib/repository-paths";

export type RepositorySettingsSection = "general" | "branches" | "access";

export interface RepositorySettingsNavProps {
  ownerLogin: string;
  repositoryName: string;
  /** Only a repository Admin is offered the settings sections. */
  isAdmin: boolean;
  active: RepositorySettingsSection;
}

/**
 * The repository Settings sections. “Branches” carries the default-branch flow
 * of REQ-4-3-3, so a non-administrator never receives it (and the server refuses
 * the update anyway).
 */
export function RepositorySettingsNav({
  ownerLogin,
  repositoryName,
  isAdmin,
  active,
}: RepositorySettingsNavProps) {
  const link = (section: RepositorySettingsSection, href: string, label: string) => (
    <a className="settings-nav__link" href={makeHash(href)} aria-current={active === section ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <nav className="settings-nav" aria-label="Repository settings">
      {link("general", `${repositoryPath(ownerLogin, repositoryName)}/settings`, "General")}
      {isAdmin ? link("branches", settingsBranchesPath(ownerLogin, repositoryName), "Branches") : null}
      {isAdmin ? link("access", `${repositoryPath(ownerLogin, repositoryName)}/settings/access`, "Manage access") : null}
    </nav>
  );
}
