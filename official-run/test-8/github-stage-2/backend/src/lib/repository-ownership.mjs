/**
 * Repository ownership.
 *
 * A repository belongs either to an organization (`ownerType: "organization"`,
 * `ownerId` = organization id) or to an individual account (`ownerType:
 * "account"`, `ownerId` = account id). Both live in the shared module so the
 * organization, membership and repository modules can resolve an owner without
 * importing each other.
 *
 * Documents written before personal namespaces existed only carry
 * `organizationId`; `normalizeRepositoryOwners` rewrites them once and every
 * resolver still falls back to that legacy field, so a stored document never
 * has to be migrated by hand.
 */

export function repositoryOwnerType(repository) {
  if (repository.ownerType === "account") return "account";
  if (repository.ownerType === "organization") return "organization";
  return repository.organizationId ? "organization" : null;
}

export function repositoryOwnerId(repository) {
  return repository.ownerId ?? repository.organizationId ?? null;
}

export function repositoryOwnedBy(repository, ownerId) {
  return Boolean(ownerId) && repositoryOwnerId(repository) === ownerId;
}

/**
 * The owner as it is used outside the store: `login` is the URL identifier
 * (organization slug or account username) and `displayName` is the human name
 * rendered on links and headings.
 */
export function repositoryOwnerRef(state, repository) {
  const type = repositoryOwnerType(repository);
  const id = repositoryOwnerId(repository);
  if (!type || !id) return null;
  if (type === "account") {
    const account = state.accounts.find((candidate) => candidate.id === id);
    if (!account) return null;
    return { type, id, login: account.username, displayName: account.username };
  }
  const organization = state.organizations.find((candidate) => candidate.id === id);
  if (!organization) return null;
  return { type, id, login: organization.slug, displayName: organization.displayName };
}

/** Persists the owner fields on documents that still only store `organizationId`. */
export function normalizeRepositoryOwners(state) {
  for (const repository of state.repositories ?? []) {
    const type = repositoryOwnerType(repository);
    const id = repositoryOwnerId(repository);
    if (!type || !id) continue;
    repository.ownerType = type;
    repository.ownerId = id;
  }
}
