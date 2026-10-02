import { randomUUID } from "node:crypto";

import {
  canAdministerRepository,
  canReadRepository,
  effectiveRepositoryRole,
  isOrganizationOwner,
  membershipOf,
  organizationByName,
  organizationRoleOf,
  ownerNameOf,
  repositoriesOfOrganization,
  repositoryByOwnerAndName,
  teamsOfOrganization,
} from "./access.mjs";
import { serializeRepository } from "./repositories.mjs";
import { isValidUsername } from "./validation.mjs";

export const ORGANIZATION_MESSAGES = {
  nameExists: "Organization name already exists",
  nameFormat: "Organization name format is invalid",
  displayNameRequired: "Display name is required",
  displayNameTooLong: "Display name is too long",
  notAuthenticated: "Not authenticated",
  notFound: "Organization not found",
  accessDenied: "Access denied",
};

export const MEMBER_MESSAGES = {
  accountNotFound: "Account not found",
  alreadyMember: "Account is already a member",
  roleUnsupported: "Role is not supported",
  memberNotFound: "Member not found",
  lastOwner: "Organization must have at least one Owner",
};

export const ORGANIZATION_ROLES = ["member", "owner"];

export const DISPLAY_NAME_MAX_LENGTH = 100;

let clock = () => new Date().toISOString();

function publicOrganization(organization) {
  return {
    name: organization.name,
    displayName: organization.displayName,
    createdAt: organization.createdAt,
  };
}

function displayNameError(displayName) {
  if (displayName.length === 0) return ORGANIZATION_MESSAGES.displayNameRequired;
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return ORGANIZATION_MESSAGES.displayNameTooLong;
  }
  return null;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

export function createOrganizationService(store) {
  async function listForAccount(accountId) {
    const state = await store.read();
    const organizations = (state.organizations ?? []).filter((organization) =>
      membershipOf(state, organization.id, accountId),
    );
    return organizations
      .map((organization) => ({
        ...publicOrganization(organization),
        role: organizationRoleOf(state, organization.id, accountId),
      }))
      .sort(byName);
  }

  /**
   * Creates an organization together with the creator's Owner membership in a
   * single atomic update. A duplicate identifier is reported before the
   * display-name reason so an existing organization is never reused silently.
   */
  async function create(accountId, input) {
    if (!accountId) return { ok: false, unauthorized: true };
    const source = input ?? {};
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const displayName = typeof source.displayName === "string" ? source.displayName.trim() : "";

    if (!isValidUsername(name)) {
      return { ok: false, fieldErrors: { name: ORGANIZATION_MESSAGES.nameFormat } };
    }

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      if (organizationByName(state, name)) {
        outcome = { ok: false, fieldErrors: { name: ORGANIZATION_MESSAGES.nameExists } };
        return;
      }
      const invalidDisplayName = displayNameError(displayName);
      if (invalidDisplayName) {
        outcome = { ok: false, fieldErrors: { displayName: invalidDisplayName } };
        return;
      }

      const createdAt = clock();
      const organization = {
        id: `organization-${randomUUID()}`,
        name,
        displayName,
        createdAt,
      };
      const membership = {
        id: `membership-${randomUUID()}`,
        organizationId: organization.id,
        accountId,
        role: "owner",
        createdAt,
      };
      state.organizations = [...(state.organizations ?? []), organization];
      state.memberships = [...(state.memberships ?? []), membership];
      outcome = { ok: true, organization: publicOrganization(organization) };
    });
    return outcome;
  }

  async function detailForViewer(name, accountId) {
    const state = await store.read();
    const organization = organizationByName(state, name);
    if (!organization) return null;
    return {
      organization: publicOrganization(organization),
      viewerRole: organizationRoleOf(state, organization.id, accountId),
    };
  }

  async function membersFor(name) {
    const state = await store.read();
    const organization = organizationByName(state, name);
    if (!organization) return null;
    const accountsById = new Map((state.accounts ?? []).map((account) => [account.id, account]));
    return (state.memberships ?? [])
      .filter((membership) => membership.organizationId === organization.id)
      .map((membership) => {
        const account = accountsById.get(membership.accountId);
        if (!account) return null;
        return { username: account.username, role: membership.role };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.role !== right.role) return left.role === "owner" ? -1 : 1;
        return left.username.localeCompare(right.username);
      });
  }

  /** Repositories of the organization that the current viewer may read. */
  async function repositoriesFor(name, accountId) {
    const state = await store.read();
    const organization = organizationByName(state, name);
    if (!organization) return null;
    return repositoriesOfOrganization(state, organization.id)
      .filter((repository) => canReadRepository(state, repository, accountId))
      .map((repository) => ({
        id: repository.id,
        name: repository.name,
        description: repository.description ?? "",
        visibility: repository.visibility,
        updatedAt: repository.updatedAt,
      }))
      .sort(byName);
  }

  /**
   * A repository belongs to an organization or to an account. Private
   * repositories answer "denied" without telling the viewer whether the
   * repository exists.
   */
  async function repositoryForViewer(ownerName, repositoryName, accountId) {
    const state = await store.read();
    const repository = repositoryByOwnerAndName(state, ownerName, repositoryName);

    if (!repository) return { status: "not-found" };
    if (!canReadRepository(state, repository, accountId)) return { status: "denied" };
    return {
      status: "ok",
      repository: {
        ...serializeRepository(state, repository),
        owner: ownerNameOf(state, repository) ?? ownerName,
      },
      viewerRole: effectiveRepositoryRole(state, repository, accountId),
      // The Settings page only offers the visibility action to a repository
      // Admin; the server still re-checks every submitted change.
      canAdminister: canAdministerRepository(state, repository, accountId),
    };
  }

  /**
   * Stores an organization-account-role membership directly; there is no
   * invitation or pending step, and a duplicate or unknown account keeps the
   * current relationships untouched.
   */
  async function addMember(organizationName, accountId, input) {
    const identifier = ["identifier", "usernameOrEmail", "username", "email"]
      .map((key) => (typeof input?.[key] === "string" ? input[key].trim() : ""))
      .find((value) => value.length > 0) ?? "";
    const rawRole = typeof input?.role === "string" ? input.role.trim().toLowerCase() : "";
    const role = rawRole.length === 0 ? "member" : rawRole;

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      if (!ORGANIZATION_ROLES.includes(role)) {
        outcome = { ok: false, fieldErrors: { role: MEMBER_MESSAGES.roleUnsupported } };
        return;
      }
      const account = (state.accounts ?? []).find(
        (candidate) =>
          candidate.username === identifier || candidate.email === identifier,
      );
      if (!account) {
        outcome = { ok: false, fieldErrors: { identifier: MEMBER_MESSAGES.accountNotFound } };
        return;
      }
      if (membershipOf(state, organization.id, account.id)) {
        outcome = { ok: false, fieldErrors: { identifier: MEMBER_MESSAGES.alreadyMember } };
        return;
      }
      state.memberships = [
        ...(state.memberships ?? []),
        {
          id: `membership-${randomUUID()}`,
          organizationId: organization.id,
          accountId: account.id,
          role,
          createdAt: clock(),
        },
      ];
      outcome = { ok: true, member: { username: account.username, role } };
    });
    return outcome;
  }

  /**
   * Atomically drops the organization membership together with the account's
   * team memberships in this organization and its direct grants on this
   * organization's repositories. Team grants and the account itself survive,
   * and the last Owner is never removed.
   */
  async function removeMember(organizationName, accountId, username) {
    const identifier = typeof username === "string" ? username.trim() : "";

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const organization = organizationByName(state, organizationName);
      if (!organization) {
        outcome = { notFound: true };
        return;
      }
      if (!isOrganizationOwner(state, organization.id, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      const account =
        (state.accounts ?? []).find(
          (candidate) => candidate.username === identifier || candidate.email === identifier,
        ) ?? null;
      const membership = account ? membershipOf(state, organization.id, account.id) : null;
      if (!membership) {
        outcome = { ok: false, fieldErrors: { username: MEMBER_MESSAGES.memberNotFound } };
        return;
      }
      const owners = (state.memberships ?? []).filter(
        (candidate) => candidate.organizationId === organization.id && candidate.role === "owner",
      );
      if (membership.role === "owner" && owners.length <= 1) {
        outcome = { ok: false, fieldErrors: { username: MEMBER_MESSAGES.lastOwner } };
        return;
      }

      const teamIds = new Set(teamsOfOrganization(state, organization.id).map((team) => team.id));
      const repositoryIds = new Set(
        repositoriesOfOrganization(state, organization.id).map((repository) => repository.id),
      );
      state.memberships = (state.memberships ?? []).filter(
        (candidate) => candidate.id !== membership.id,
      );
      state.teamMembers = (state.teamMembers ?? []).filter(
        (teamMember) =>
          !(teamMember.accountId === account.id && teamIds.has(teamMember.teamId)),
      );
      state.repositoryGrants = (state.repositoryGrants ?? []).filter(
        (grant) =>
          !(
            grant.subjectType === "account" &&
            grant.subjectId === account.id &&
            repositoryIds.has(grant.repositoryId)
          ),
      );
      outcome = { ok: true };
    });
    return outcome;
  }

  return {
    listForAccount,
    create,
    detailForViewer,
    membersFor,
    repositoriesFor,
    repositoryForViewer,
    addMember,
    removeMember,
  };
}
