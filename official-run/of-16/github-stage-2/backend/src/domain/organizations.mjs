import { randomUUID } from "node:crypto";

import { findAccountByIdentifier } from "./identity.mjs";
import { MESSAGES, hasErrors, validateOrganizationFields } from "./validation.mjs";

export const ORGANIZATION_ROLE_OWNER = "owner";
export const ORGANIZATION_ROLE_MEMBER = "member";

export const ORGANIZATION_ROLES = [ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_MEMBER];

/** Falls back to the ordinary Member role for an unknown or missing value. */
export function normalizeOrganizationRole(value) {
  return ORGANIZATION_ROLES.includes(value) ? value : ORGANIZATION_ROLE_MEMBER;
}

export function toPublicOrganization(organization) {
  if (!organization) return null;
  return {
    slug: organization.slug,
    name: organization.name,
    displayName: organization.displayName,
    createdAt: organization.createdAt,
  };
}

/** URL identifier derived from the unique organization name. */
export function organizationSlugOf(name) {
  return typeof name === "string" ? name.trim().toLowerCase().replace(/\s+/g, "-") : "";
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function findOrganizationBySlug(state, slug) {
  const needle = normalizeKey(slug);
  if (!needle) return null;
  return state.organizations.find((organization) => organization.slug === needle) ?? null;
}

export function findOrganizationById(state, organizationId) {
  return state.organizations.find((organization) => organization.id === organizationId) ?? null;
}

/**
 * The unique name, the display name and the URL identifier share one namespace,
 * so a submission that collides with any of them is a duplicate.
 */
export function isOrganizationNameTaken(state, name) {
  const key = normalizeKey(name);
  const slug = organizationSlugOf(name);
  if (!key) return false;
  return state.organizations.some((organization) => (
    normalizeKey(organization.name) === key
    || normalizeKey(organization.displayName) === key
    || organization.slug === slug
  ));
}

export function listMemberships(state, organizationId) {
  return state.organizationMembers.filter((membership) => membership.organizationId === organizationId);
}

export function findMembership(state, organizationId, accountId) {
  if (!accountId) return null;
  return state.organizationMembers.find((membership) => (
    membership.organizationId === organizationId && membership.accountId === accountId
  )) ?? null;
}

/** Membership role of an account in an organization, or null when not a member. */
export function organizationRoleOf(state, organizationId, accountId) {
  return findMembership(state, organizationId, accountId)?.role ?? null;
}

export function isOrganizationOwner(state, organizationId, accountId) {
  return organizationRoleOf(state, organizationId, accountId) === ORGANIZATION_ROLE_OWNER;
}

/** Organizations the account is a member of, with that account's role. */
export function listOrganizationsForAccount(state, accountId) {
  const roles = new Map(
    state.organizationMembers
      .filter((membership) => membership.accountId === accountId)
      .map((membership) => [membership.organizationId, membership.role]),
  );
  return state.organizations
    .filter((organization) => roles.has(organization.id))
    .map((organization) => ({ organization, role: roles.get(organization.id) }));
}

export function addOrganizationMembership(state, { organizationId, accountId, role }) {
  const existing = findMembership(state, organizationId, accountId);
  if (existing) return existing;
  const membership = {
    id: randomUUID(),
    organizationId,
    accountId,
    role: role ?? ORGANIZATION_ROLE_MEMBER,
    createdAt: new Date().toISOString(),
  };
  state.organizationMembers.push(membership);
  return membership;
}

export function removeOrganizationMembership(state, organizationId, accountId) {
  const before = state.organizationMembers.length;
  state.organizationMembers = state.organizationMembers.filter((membership) => (
    membership.organizationId !== organizationId || membership.accountId !== accountId
  ));
  return state.organizationMembers.length !== before;
}

function countOrganizationOwners(state, organizationId) {
  return state.organizationMembers.filter((membership) => (
    membership.organizationId === organizationId && membership.role === ORGANIZATION_ROLE_OWNER
  )).length;
}

/**
 * Directly adds an existing account to an organization by username or email.
 * There is no invitation step: the membership is stored with the requested
 * role (Member by default). A duplicate or unknown account changes nothing.
 */
export function addOrganizationMember(state, organization, input = {}) {
  const identifier = typeof input.identifier === "string" ? input.identifier.trim() : "";
  const account = findAccountByIdentifier(state, identifier);
  if (!account) return { errors: { identifier: MESSAGES.accountNotFound } };
  if (findMembership(state, organization.id, account.id)) {
    return { errors: { identifier: MESSAGES.accountAlreadyMember } };
  }

  const membership = addOrganizationMembership(state, {
    organizationId: organization.id,
    accountId: account.id,
    role: normalizeOrganizationRole(input.role),
  });
  return { membership, account };
}

/**
 * Removes one account from an organization as a single mutation. The
 * organization membership, every team membership of that account in this
 * organization and every direct grant it held on repositories of this
 * organization are deleted together; grants held by teams stay untouched. The
 * account itself, its personal repositories and its memberships of other
 * organizations are never touched. Removing the last Owner is rejected and
 * leaves every relationship unchanged.
 */
export function removeOrganizationMember(state, organization, identifier) {
  const account = findAccountByIdentifier(state, identifier);
  if (!account) return { errors: { identifier: MESSAGES.accountNotFound } };
  const membership = findMembership(state, organization.id, account.id);
  if (!membership) return { errors: { identifier: MESSAGES.accountNotOrganizationMember } };
  if (membership.role === ORGANIZATION_ROLE_OWNER && countOrganizationOwners(state, organization.id) <= 1) {
    return { errors: { identifier: MESSAGES.lastOrganizationOwner } };
  }

  removeOrganizationMembership(state, organization.id, account.id);

  const teamIds = new Set(
    state.teams.filter((team) => team.organizationId === organization.id).map((team) => team.id),
  );
  state.teamMembers = state.teamMembers.filter((teamMembership) => (
    teamMembership.accountId !== account.id || !teamIds.has(teamMembership.teamId)
  ));

  const repositoryIds = new Set(
    state.repositories.filter((repository) => repository.organizationId === organization.id)
      .map((repository) => repository.id),
  );
  state.repositoryGrants = state.repositoryGrants.filter((grant) => (
    grant.accountId !== account.id || !repositoryIds.has(grant.repositoryId)
  ));

  return { account };
}

/**
 * Creates an organization for the signed-in account and stores the creating
 * account's Owner membership in the same mutation. A rejected submission
 * leaves the state untouched.
 */
export function createOrganization(state, account, input = {}) {
  const { errors, values } = validateOrganizationFields(input);
  if (isOrganizationNameTaken(state, values.name)) {
    errors.name = MESSAGES.organizationNameExists;
  }
  if (hasErrors(errors)) return { errors };

  const now = new Date().toISOString();
  const organization = {
    id: randomUUID(),
    slug: organizationSlugOf(values.name),
    name: values.name,
    displayName: values.displayName,
    createdAt: now,
  };
  state.organizations.push(organization);
  addOrganizationMembership(state, {
    organizationId: organization.id,
    accountId: account.id,
    role: ORGANIZATION_ROLE_OWNER,
  });
  return { organization };
}
