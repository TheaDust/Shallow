import { randomUUID } from "node:crypto";

import {
  isValidDisplayName,
  isValidOrganizationName,
  normalizeDisplayName,
} from "./validation.mjs";

/**
 * Organization identity and discovery (REQ-2-1).
 *
 * An organization owns a globally unique lowercase identifier (the same
 * format as a REQ-1 username) and a display name. Creating one atomically
 * stores the organization object and the creator's Owner membership, so every
 * later team, member and repository authorization is scoped by the
 * organization id.
 */

export const ORGANIZATION_MESSAGES = {
  nameExists: "Organization name already exists",
  nameFormat: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
};

export const ORGANIZATION_ROLES = ["Owner", "Member"];

/** Resolves an organization by identifier, id or display name. */
export function findOrganization(data, identifier) {
  if (typeof identifier !== "string") return null;
  const raw = identifier.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return data.organizations.find((organization) => organization.name === lower)
    ?? data.organizations.find((organization) => organization.id === raw)
    ?? data.organizations.find((organization) => organization.displayName.toLowerCase() === lower)
    ?? null;
}

export function findOrganizationByName(data, name) {
  const lower = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!lower) return null;
  return data.organizations.find((organization) => organization.name === lower) ?? null;
}

export function organizationMembership(data, organizationId, accountId) {
  if (!accountId) return null;
  return data.memberships.find(
    (membership) => membership.organizationId === organizationId && membership.accountId === accountId,
  ) ?? null;
}

export function organizationsForAccount(data, accountId) {
  if (!accountId) return [];
  return data.memberships
    .filter((membership) => membership.accountId === accountId)
    .map((membership) => {
      const organization = data.organizations.find(
        (candidate) => candidate.id === membership.organizationId,
      );
      if (!organization) return null;
      return {
        name: organization.name,
        displayName: organization.displayName,
        role: membership.role,
      };
    })
    .filter(Boolean);
}

export function publicOrganizations(data) {
  return data.organizations
    .map((organization) => ({ name: organization.name, displayName: organization.displayName }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function organizationMembers(data, organizationId) {
  return data.memberships
    .filter((membership) => membership.organizationId === organizationId)
    .map((membership) => {
      const account = data.accounts.find((candidate) => candidate.id === membership.accountId);
      if (!account) return null;
      return { username: account.username, role: membership.role };
    })
    .filter(Boolean)
    .sort((left, right) => left.username.localeCompare(right.username));
}

/**
 * Resolves an existing account by username (case-insensitive) or verified
 * email address, as used by the People page and team membership (REQ-2-2).
 */
export function findAccountByIdentifier(data, identifier) {
  const raw = typeof identifier === "string" ? identifier.trim() : "";
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return data.accounts.find((account) => account.username.toLowerCase() === lower)
    ?? data.accounts.find(
      (account) => account.emailVerified !== false && (account.email ?? "").toLowerCase() === lower,
    )
    ?? null;
}

/**
 * Field validation for organization creation. The identifier check runs before
 * the format check so submitting an already taken identifier always reports
 * "Organization name already exists" instead of a format message.
 */
export function validateOrganizationFields(input, data) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const displayName = normalizeDisplayName(input.displayName);
  const lower = name.toLowerCase();
  const existing = data.organizations.find(
    (organization) => organization.name === lower
      || organization.displayName.toLowerCase() === lower,
  );

  const errors = {};
  if (name && existing) errors.name = ORGANIZATION_MESSAGES.nameExists;
  else if (!isValidOrganizationName(name)) errors.name = ORGANIZATION_MESSAGES.nameFormat;
  if (!isValidDisplayName(input.displayName)) {
    errors.displayName = ORGANIZATION_MESSAGES.displayNameRequired;
  }
  return { errors, name, displayName };
}

/** Creates the organization and the creator's Owner membership atomically. */
export async function createOrganization(store, accountId, input) {
  const data = await store.read();
  const preliminary = validateOrganizationFields(input, data);
  if (Object.keys(preliminary.errors).length > 0) {
    return { ok: false, errors: preliminary.errors };
  }

  let outcome = null;
  await store.update((draft) => {
    const checked = validateOrganizationFields(input, draft);
    if (Object.keys(checked.errors).length > 0) {
      outcome = { ok: false, errors: checked.errors };
      return undefined;
    }
    const organization = {
      id: randomUUID(),
      name: checked.name,
      displayName: checked.displayName,
      createdAt: new Date().toISOString(),
    };
    draft.organizations.push(organization);
    draft.memberships.push({
      id: randomUUID(),
      organizationId: organization.id,
      accountId,
      role: "Owner",
      createdAt: organization.createdAt,
    });
    outcome = { ok: true, organization };
    return draft;
  });
  return outcome;
}
