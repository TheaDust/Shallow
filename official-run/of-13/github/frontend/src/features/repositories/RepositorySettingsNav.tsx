import {
  repositorySettingsAccessHref,
  repositorySettingsBranchesHref,
  repositorySettingsGeneralHref,
} from "../../lib/repository-code-api";

export type RepositorySettingsSection = "general" | "branches" | "access";

/** The settings navigation; `Settings` itself stays the header link. */
export function RepositorySettingsNav({
  owner,
  name,
  active,
}: {
  owner: string;
  name: string;
  active: RepositorySettingsSection;
}) {
  return (
    <nav className="repository-settings__nav" aria-label="Repository settings">
      <a
        href={repositorySettingsGeneralHref(owner, name)}
        aria-current={active === "general" ? "page" : undefined}
      >
        General
      </a>
      <a
        href={repositorySettingsBranchesHref(owner, name)}
        aria-current={active === "branches" ? "page" : undefined}
      >
        Branches
      </a>
      <a
        href={repositorySettingsAccessHref(owner, name)}
        aria-current={active === "access" ? "page" : undefined}
      >
        Manage access
      </a>
    </nav>
  );
}
