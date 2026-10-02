import { RepositorySettings } from "../repositories/RepositorySettings";
import type { RepositoryOwnerKind } from "../repositories/types";

export interface RepositorySettingsPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  section?: string;
}

/**
 * Repository Settings page. It serves organization and personal repositories
 * alike: the repository itself decides whether the viewer may manage it, so a
 * direct link to the general settings is answered from the stored state.
 */
export function RepositorySettingsPage({ ownerKind, owner, name, section }: RepositorySettingsPageProps) {
  return <RepositorySettings ownerKind={ownerKind} owner={owner} name={name} section={section} />;
}
