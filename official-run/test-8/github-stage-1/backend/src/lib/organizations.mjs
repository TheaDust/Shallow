import { randomUUID } from "node:crypto";

import {
  MESSAGES,
  isValidDisplayName,
  isValidOrganizationName,
  isValidOrganizationRole,
  isValidRepositoryRole,
  isValidTeamName,
  normalizeRole,
  normalizeText,
} from "./validation.mjs";

/**
 * Organizations, memberships, teams, repositories and their access grants.
 *
 * Everything lives in the same persisted state document as accounts and
 * sessions, so a single `store.update` keeps a multi-relationship change
 * atomic. Pure `...From(state)` helpers are used by read endpoints and by the
 * mutating functions while they hold the store lock.
 */

const ORGANIZATION_COLLECTIONS = [
  "organizations",
  "memberships",
  "teams",
  "teamMembers",
  "repositories",
  "repositoryGrants",
];

export function ensureOrganizationState(state) {
  for (const key of ORGANIZATION_COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

export function findOrganizationBySlug(state, slug) {
  return state.organizations.find((organization) => organization.slug === slug);
}

export function findTeam(state, organizationId, teamSlug) {
  return state.teams.find((team) => team.organizationId === organizationId && team.slug === teamSlug);
}

export function findRepository(state, organizationId, name) {
  return state.repositories.find((repository) => repository.organizationId === organizationId && repository.name === name);
}

export function membershipOf(state, organizationId, accountId) {
  if (!accountId) return undefined;
  return state.memberships.find((membership) => membership.organizationId === organizationId && membership.accountId === accountId);
}

export function isOwner(state, organizationId, accountId) {
  return membershipOf(state, organizationId, accountId)?.role === "owner";
}

export function isMember(state, organizationId, accountId) {
  return Boolean(membershipOf(state, organizationId, accountId));
}

export function findAccountByUsernameOrEmail(state, identifier) {
  const value = normalizeText(identifier);
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return state.accounts.find((account) => account.username === value)
    ?? state.accounts.find((account) => String(account.email).toLowerCase() === normalized);
}

/* ---------------------------------------------------------------- shapes -- */

export function publicOrganization(organization, role = null) {
  return {
    id: organization.id,
    slug: organization.slug,
    displayName: organization.displayName,
    role,
  };
}

export function publicTeam(state, team) {
  const parent = team.parentTeamId ? state.teams.find((candidate) => candidate.id === team.parentTeamId) : null;
  return { id: team.id, slug: team.slug, parent: parent ? parent.slug : null };
}

export function publicPerson(state, membership) {
  const account = state.accounts.find((candidate) => candidate.id === membership.accountId);
  return {
    username: account?.username ?? "",
    email: account?.email ?? "",
    role: membership.role === "owner" ? "Owner" : "Member",
  };
}

export function publicTeamMember(state, teamMember) {
  const account = state.accounts.find((candidate) => candidate.id === teamMember.accountId);
  return { id: account?.id ?? teamMember.accountId, username: account?.username ?? "", email: account?.email ?? "" };
}

export function publicRepository(state, repository, accountId = null) {
  const organization = state.organizations.find((candidate) => candidate.id === repository.organizationId);
  return {
    id: repository.id,
    name: repository.name,
    description: repository.description ?? "",
    visibility: repository.visibility,
    updatedAt: repository.updatedAt ?? null,
    organization: organization ? { slug: organization.slug, displayName: organization.displayName } : null,
    // Effective role of the viewing account on this repository (null when the
    // viewer only reads it through public visibility).
    role: accountId ? repositoryAccessRole(state, repository, accountId) : null,
  };
}

/** One “Manage access” row: the grant subject name and its stored role. */
export function publicRepositoryGrant(state, grant) {
  const subject = grant.subjectType === "team"
    ? state.teams.find((team) => team.id === grant.subjectId)
    : state.accounts.find((account) => account.id === grant.subjectId);
  return {
    id: grant.id,
    subjectType: grant.subjectType,
    subjectName: grant.subjectType === "team" ? subject?.slug ?? "" : subject?.username ?? "",
    role: grant.role,
  };
}

/* --------------------------------------------------------------- access -- */

/**
 * Effective repository access for one account. Organization membership alone
 * grants nothing: access comes from Owner status, a direct grant, or membership
 * of a team that holds a grant. Public repositories are readable by everyone.
 */
export function repositoryAccessRole(state, repository, accountId) {
  if (isOwner(state, repository.organizationId, accountId)) return "admin";
  const direct = state.repositoryGrants.find(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "account" && grant.subjectId === accountId,
  );
  if (direct) return direct.role;
  const teamIds = new Set(state.teamMembers.filter((member) => member.accountId === accountId).map((member) => member.teamId));
  const teamGrant = state.repositoryGrants.find(
    (grant) => grant.repositoryId === repository.id && grant.subjectType === "team" && teamIds.has(grant.subjectId),
  );
  if (teamGrant) return teamGrant.role;
  return null;
}

export function canReadRepository(state, repository, accountId) {
  if (repository.visibility === "public") return true;
  return repositoryAccessRole(state, repository, accountId) !== null;
}

export function organizationHasPublicRepository(state, organization) {
  return state.repositories.some((repository) => repository.organizationId === organization.id && repository.visibility === "public");
}

/** True when the account may open a repository’s Settings / Manage access. */
export function isRepositoryAdmin(state, repository, accountId) {
  return repositoryAccessRole(state, repository, accountId) === "admin";
}

/* ------------------------------------------------------------ grants --- */

export function repositoryAccessList(state, repository) {
  return state.repositoryGrants
    .filter((grant) => grant.repositoryId === repository.id)
    .map((grant) => publicRepositoryGrant(state, grant))
    .sort((left, right) => left.subjectName.localeCompare(right.subjectName));
}

/** Teams of the organization and its members, offered by the access picker. */
export function repositoryAccessCandidates(state, organization) {
  return {
    teams: state.teams
      .filter((team) => team.organizationId === organization.id)
      .map((team) => team.slug)
      .sort(),
    accounts: state.memberships
      .filter((membership) => membership.organizationId === organization.id)
      .map((membership) => state.accounts.find((account) => account.id === membership.accountId)?.username ?? "")
      .filter(Boolean)
      .sort(),
  };
}

/* -------------------------------------------------------------- queries -- */

export function organizationsForAccount(state, accountId) {
  return state.memberships
    .filter((membership) => membership.accountId === accountId)
    .map((membership) => membership.organizationId)
    .map((organizationId) => state.organizations.find((organization) => organization.id === organizationId))
    .filter(Boolean)
    .map((organization) => publicOrganization(organization, membershipOf(state, organization.id, accountId).role))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function publicOrganizations(state) {
  const ids = new Set(state.repositories.filter((repository) => repository.visibility === "public").map((repository) => repository.organizationId));
  return state.organizations
    .filter((organization) => ids.has(organization.id))
    .map((organization) => publicOrganization(organization))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function listRepositories(state, organization, accountId, { name = "", type = "all" } = {}) {
  const query = normalizeText(name).toLowerCase();
  return state.repositories
    .filter((repository) => repository.organizationId === organization.id)
    .filter((repository) => canReadRepository(state, repository, accountId))
    .filter((repository) => (query ? repository.name.toLowerCase().includes(query) : true))
    .filter((repository) => (type === "public" ? repository.visibility === "public" : type === "private" ? repository.visibility === "private" : true))
    .map((repository) => publicRepository(state, repository))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every repository the signed-in account may read across the whole state.
 *
 * Access is not limited to organizations the account belongs to: a repository
 * Admin reaches a public repository through a direct grant even without a
 * membership, so the signed-in workspace must list it. Visibility filtering
 * reuses `canReadRepository`, so a private repository without a grant never
 * appears here.
 */
export function repositoriesForAccount(state, accountId) {
  return state.repositories
    .filter((repository) => canReadRepository(state, repository, accountId))
    .map((repository) => publicRepository(state, repository, accountId))
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return (left.organization?.slug ?? "").localeCompare(right.organization?.slug ?? "");
    });
}

export function organizationPeople(state, organization) {
  return state.memberships
    .filter((membership) => membership.organizationId === organization.id)
    .map((membership) => publicPerson(state, membership))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function organizationTeams(state, organization) {
  return state.teams
    .filter((team) => team.organizationId === organization.id)
    .map((team) => publicTeam(state, team))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function teamMembers(state, team) {
  return state.teamMembers
    .filter((member) => member.teamId === team.id)
    .map((member) => publicTeamMember(state, member))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function parentTeamOptions(state, organization, team) {
  return state.teams
    .filter((candidate) => candidate.organizationId === organization.id && candidate.id !== team.id)
    .map((candidate) => candidate.slug)
    .sort();
}

export function teamDetail(state, organization, team, accountId) {
  return {
    organization: publicOrganization(organization, membershipOf(state, organization.id, accountId)?.role ?? null),
    team: publicTeam(state, team),
    members: teamMembers(state, team),
    parentOptions: parentTeamOptions(state, organization, team),
  };
}

/* ------------------------------------------------------------ mutations -- */

export async function createOrganization(store, accountId, input = {}) {
  const slug = normalizeText(input.organizationName);
  const displayName = normalizeText(input.displayName);
  const fields = {};
  let created = null;

  await store.update((state) => {
    ensureOrganizationState(state);
    const duplicate = state.organizations.some(
      (organization) => organization.slug === slug || organization.displayName === slug,
    );
    if (duplicate) {
      // A taken name short-circuits the remaining checks so the duplicate is
      // reported on its own without opening the existing organization.
      fields.organizationName = MESSAGES.organizationNameExists;
      return;
    }
    if (!isValidOrganizationName(slug)) fields.organizationName = MESSAGES.organizationNameInvalid;
    if (!isValidDisplayName(displayName)) fields.displayName = MESSAGES.displayNameRequired;
    else if (displayName.length > 100) fields.displayName = MESSAGES.displayNameTooLong;
    if (Object.keys(fields).length > 0) return;

    const organization = {
      id: randomUUID(),
      slug,
      displayName,
      createdAt: new Date().toISOString(),
    };
    state.organizations.push(organization);
    state.memberships.push({
      id: randomUUID(),
      organizationId: organization.id,
      accountId,
      role: "owner",
      createdAt: new Date().toISOString(),
    });
    created = organization;
  });

  if (created) return { ok: true, organization: publicOrganization(created, "owner") };
  return { ok: false, fields };
}

export async function createTeam(store, organizationSlug, accountId, input = {}) {
  const name = normalizeText(input.teamName);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    if (!organization) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, accountId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidTeamName(name)) {
      result = { ok: false, fields: { teamName: MESSAGES.teamNameInvalid } };
      return;
    }
    if (findTeam(state, organization.id, name)) {
      result = { ok: false, fields: { teamName: MESSAGES.teamNameExists } };
      return;
    }
    const team = {
      id: randomUUID(),
      organizationId: organization.id,
      slug: name,
      parentTeamId: null,
      createdAt: new Date().toISOString(),
    };
    state.teams.push(team);
    result = { ok: true, team: publicTeam(state, team) };
  });

  return result;
}

function isDescendantOf(state, candidateId, ancestorId) {
  const seen = new Set();
  let current = state.teams.find((team) => team.id === candidateId);
  while (current?.parentTeamId && !seen.has(current.id)) {
    if (current.parentTeamId === ancestorId) return true;
    seen.add(current.id);
    current = state.teams.find((team) => team.id === current.parentTeamId);
  }
  return false;
}

export async function setTeamParent(store, organizationSlug, teamSlug, accountId, input = {}) {
  const requested = normalizeText(input.parentTeam);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    const team = organization ? findTeam(state, organization.id, teamSlug) : undefined;
    if (!organization || !team) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, accountId)) {
      result = { forbidden: true };
      return;
    }
    if (requested === "") {
      team.parentTeamId = null;
      result = { ok: true, team: publicTeam(state, team) };
      return;
    }
    const parent = findTeam(state, organization.id, requested);
    if (!parent) {
      result = { ok: false, fields: { parentTeam: MESSAGES.teamNameInvalid } };
      return;
    }
    if (parent.id === team.id || isDescendantOf(state, parent.id, team.id)) {
      result = { ok: false, fields: { parentTeam: MESSAGES.cyclicTeamHierarchy } };
      return;
    }
    team.parentTeamId = parent.id;
    result = { ok: true, team: publicTeam(state, team) };
  });

  return result;
}

export async function addTeamMember(store, organizationSlug, teamSlug, accountId, input = {}) {
  const identifier = normalizeText(input.username);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    const team = organization ? findTeam(state, organization.id, teamSlug) : undefined;
    if (!organization || !team) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, accountId)) {
      result = { forbidden: true };
      return;
    }
    const account = findAccountByUsernameOrEmail(state, identifier);
    if (!account) {
      result = { ok: false, fields: { username: MESSAGES.accountNotFound } };
      return;
    }
    if (!isMember(state, organization.id, account.id)) {
      result = { ok: false, fields: { username: MESSAGES.notOrganizationMember } };
      return;
    }
    const exists = state.teamMembers.some((member) => member.teamId === team.id && member.accountId === account.id);
    if (!exists) {
      state.teamMembers.push({
        id: randomUUID(),
        teamId: team.id,
        accountId: account.id,
        createdAt: new Date().toISOString(),
      });
    }
    result = { ok: true, team: publicTeam(state, team), members: teamMembers(state, team) };
  });

  return result;
}

export async function removeTeamMember(store, organizationSlug, teamSlug, accountId, identifier) {
  const value = normalizeText(identifier);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    const team = organization ? findTeam(state, organization.id, teamSlug) : undefined;
    if (!organization || !team) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, accountId)) {
      result = { forbidden: true };
      return;
    }
    const account = findAccountByUsernameOrEmail(state, value);
    if (!account) {
      result = { ok: false, fields: { username: MESSAGES.accountNotFound } };
      return;
    }
    state.teamMembers = state.teamMembers.filter(
      (member) => !(member.teamId === team.id && member.accountId === account.id),
    );
    result = { ok: true, team: publicTeam(state, team), members: teamMembers(state, team) };
  });

  return result;
}

/* ------------------------------------------ organization memberships -- */

function peoplePayload(state, organization, accountId) {
  return {
    organization: publicOrganization(organization, membershipOf(state, organization.id, accountId)?.role ?? null),
    people: organizationPeople(state, organization),
  };
}

/**
 * Directly adds an existing account as an organization member (REQ-2-2-3).
 * There is no invitation state: the membership relationship is stored
 * immediately, so the account appears in People right away. Only an Owner may
 * add members, and the check runs inside the store lock.
 */
export async function addOrganizationMember(store, organizationSlug, actorId, input = {}) {
  const identifier = normalizeText(input.username);
  const role = normalizeRole(input.role) || "member";
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    if (!organization) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, actorId)) {
      result = { forbidden: true };
      return;
    }
    const account = findAccountByUsernameOrEmail(state, identifier);
    if (!account) {
      result = { ok: false, fields: { username: MESSAGES.accountNotFound } };
      return;
    }
    if (!isValidOrganizationRole(role)) {
      result = { ok: false, fields: { role: MESSAGES.roleInvalid } };
      return;
    }
    if (membershipOf(state, organization.id, account.id)) {
      result = { ok: false, fields: { username: MESSAGES.alreadyMember } };
      return;
    }
    state.memberships.push({
      id: randomUUID(),
      organizationId: organization.id,
      accountId: account.id,
      role,
      createdAt: new Date().toISOString(),
    });
    result = { ok: true, ...peoplePayload(state, organization, actorId) };
  });

  return result;
}

/**
 * Removes an organization member (REQ-2-2-4). One store update removes the
 * membership, that account’s team memberships inside the organization and its
 * direct grants on the organization’s repositories; team grants survive because
 * they belong to the team, not to the account. Removing the last Owner is
 * rejected before anything is written.
 */
export async function removeOrganizationMember(store, organizationSlug, actorId, identifier) {
  const value = normalizeText(identifier);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const organization = findOrganizationBySlug(state, organizationSlug);
    if (!organization) {
      result = { notFound: true };
      return;
    }
    if (!isOwner(state, organization.id, actorId)) {
      result = { forbidden: true };
      return;
    }
    const account = findAccountByUsernameOrEmail(state, value);
    if (!account) {
      result = { ok: false, fields: { username: MESSAGES.accountNotFound } };
      return;
    }
    const membership = membershipOf(state, organization.id, account.id);
    if (!membership) {
      result = { ok: false, fields: { username: MESSAGES.notOrganizationMember } };
      return;
    }
    const owners = state.memberships.filter(
      (candidate) => candidate.organizationId === organization.id && candidate.role === "owner",
    );
    if (membership.role === "owner" && owners.length <= 1) {
      result = { ok: false, fields: { username: MESSAGES.lastOwner } };
      return;
    }

    const teamIds = new Set(
      state.teams.filter((team) => team.organizationId === organization.id).map((team) => team.id),
    );
    const repositoryIds = new Set(
      state.repositories.filter((repository) => repository.organizationId === organization.id).map((repository) => repository.id),
    );
    state.memberships = state.memberships.filter((candidate) => candidate.id !== membership.id);
    state.teamMembers = state.teamMembers.filter(
      (member) => !(teamIds.has(member.teamId) && member.accountId === account.id),
    );
    state.repositoryGrants = state.repositoryGrants.filter(
      (grant) => !(repositoryIds.has(grant.repositoryId) && grant.subjectType === "account" && grant.subjectId === account.id),
    );

    result = { ok: true, ...peoplePayload(state, organization, actorId) };
  });

  return result;
}

/* -------------------------------------------- repository access ----- */

function resolveRepository(state, organizationSlug, repositoryName) {
  const organization = findOrganizationBySlug(state, organizationSlug);
  const repository = organization ? findRepository(state, organization.id, repositoryName) : undefined;
  return { organization, repository };
}

function grantSubject(state, organization, subjectType, name) {
  if (subjectType === "team") {
    const team = findTeam(state, organization.id, name);
    return team ? { type: "team", id: team.id, sortKey: team.slug } : null;
  }
  const account = findAccountByUsernameOrEmail(state, name);
  return account ? { type: "account", id: account.id, sortKey: account.username } : null;
}

function accessPayload(state, organization, repository) {
  return {
    repository: publicRepository(state, repository),
    access: repositoryAccessList(state, repository),
    candidates: repositoryAccessCandidates(state, organization),
  };
}

/** Adds a grant for one person or team, updating the row when it already exists. */
export async function grantRepositoryAccess(store, organizationSlug, repositoryName, actorId, input = {}) {
  const subjectType = input.subjectType === "team" ? "team" : input.subjectType === "account" ? "account" : "";
  const name = normalizeText(input.name);
  const role = normalizeRole(input.role);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const { organization, repository } = resolveRepository(state, organizationSlug, repositoryName);
    if (!organization || !repository) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidRepositoryRole(role)) {
      result = { ok: false, fields: { role: MESSAGES.roleInvalid } };
      return;
    }
    const subject = subjectType ? grantSubject(state, organization, subjectType, name) : null;
    if (!subject) {
      const message = subjectType === "team" ? MESSAGES.teamNotFound : MESSAGES.accountNotFound;
      result = { ok: false, fields: { name: message } };
      return;
    }
    const existing = state.repositoryGrants.find(
      (grant) => grant.repositoryId === repository.id && grant.subjectType === subject.type && grant.subjectId === subject.id,
    );
    if (existing) {
      existing.role = role;
    } else {
      state.repositoryGrants.push({
        id: randomUUID(),
        repositoryId: repository.id,
        subjectType: subject.type,
        subjectId: subject.id,
        role,
        createdAt: new Date().toISOString(),
      });
    }
    result = { ok: true, ...accessPayload(state, organization, repository) };
  });

  return result;
}

/** Updates the role of an existing access row instead of adding a second one. */
export async function updateRepositoryGrant(store, organizationSlug, repositoryName, actorId, grantId, input = {}) {
  const role = normalizeRole(input.role);
  let result = { notFound: true };

  await store.update((state) => {
    ensureOrganizationState(state);
    const { organization, repository } = resolveRepository(state, organizationSlug, repositoryName);
    if (!organization || !repository) {
      result = { notFound: true };
      return;
    }
    const grant = state.repositoryGrants.find(
      (candidate) => candidate.id === grantId && candidate.repositoryId === repository.id,
    );
    if (!grant) {
      result = { notFound: true };
      return;
    }
    if (!isRepositoryAdmin(state, repository, actorId)) {
      result = { forbidden: true };
      return;
    }
    if (!isValidRepositoryRole(role)) {
      result = { ok: false, fields: { role: MESSAGES.roleInvalid } };
      return;
    }
    grant.role = role;
    result = { ok: true, ...accessPayload(state, organization, repository) };
  });

  return result;
}
