import { randomUUID } from "node:crypto";

import {
  DEFAULT_BRANCH,
  REPOSITORY_MESSAGES,
  readInitialization,
  readOwnerInput,
  readRepositoryDescription,
  readRepositoryName,
  readVisibility,
  repositoryKey,
} from "../domain/repositories.mjs";
import { getCurrentAccount } from "../lib/auth-context.mjs";
import { sendJson } from "../lib/http.mjs";
import {
  accountRepositories,
  canCreateRepositoryInNamespace,
  findOrganizationById,
  isOrganizationOwner,
  resolveRepositoryOwner,
} from "../lib/org-access.mjs";
import { buildInitialization, removeRepositoryContent } from "../lib/repository-content.mjs";
import { repositoryOverview, repositorySummary } from "../lib/repository-payload.mjs";

/**
 * Collection endpoints of the repository resource (REQ-3-2-1):
 *
 *   GET  /api/repository-owners    the namespaces the signed-in account may create in
 *   GET  /api/repositories?scope=mine  the personal repositories of the account
 *   POST /api/repositories         create a repository, optionally with an initial commit
 *
 * Every permission is resolved from the session on the server; the creation form only
 * offers namespaces the account may actually use. Repository initialization writes the
 * branch, the README file and the commit; a failure at any step removes the repository
 * again, so a rejected creation never leaves a partial record behind.
 */

async function loadContext(stores) {
  const [
    { accounts },
    { organizations },
    { memberships },
    { repositories },
  ] = await Promise.all([
    stores.accounts.read(),
    stores.organizations.read(),
    stores.organizationMembers.read(),
    stores.repositories.read(),
  ]);
  return { accounts, organizations, memberships, repositories };
}

async function requireAccount(stores, request, response) {
  const current = await getCurrentAccount(stores, request);
  if (!current) {
    sendJson(response, 401, { error: "Authentication required" });
    return null;
  }
  return current.account;
}

/** Namespaces of the creation form: the account itself first, then owned organizations. */
async function handleRepositoryOwners({ request, response, stores }) {
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  const context = await loadContext(stores);
  const personal = {
    id: account.id,
    type: "account",
    name: account.username,
    label: account.username,
  };
  const organizations = context.memberships
    .filter(
      (membership) =>
        membership.accountId === account.id &&
        isOrganizationOwner(context.memberships, membership.organizationId, account.id),
    )
    .map((membership) => findOrganizationById(context.organizations, membership.organizationId))
    .filter(Boolean)
    .map((organization) => ({
      id: organization.id,
      type: "organization",
      name: organization.name,
      label: organization.displayName || organization.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  sendJson(response, 200, { owners: [personal, ...organizations] });
}

/** The personal repositories of the signed-in account (`scope=mine`). */
async function handleListMyRepositories({ request, response, stores }) {
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  const { repositories } = await stores.repositories.read();
  const mine = accountRepositories(repositories, account.id)
    .map((repository) => repositorySummary(repository, account.username))
    .sort((left, right) => left.name.localeCompare(right.name));
  sendJson(response, 200, { repositories: mine });
}

/** Removes a repository record and every branch, commit and file that came with it. */
async function rollbackCreation(stores, repositoryId) {
  await stores.repositories.update((state) => {
    state.repositories = state.repositories.filter((candidate) => candidate.id !== repositoryId);
  });
  await stores.repositoryContent.update((state) => removeRepositoryContent(state, repositoryId));
}

async function handleCreateRepository({ request, response, stores, body }) {
  const account = await requireAccount(stores, request, response);
  if (!account) return;
  const context = await loadContext(stores);

  const { ownerType, ownerName } = readOwnerInput(body);
  const errors = {};

  const owner = ownerName ? resolveRepositoryOwner(context, ownerName) : null;
  if (!ownerName) {
    errors.owner = REPOSITORY_MESSAGES.ownerRequired;
  } else if (!owner || owner.type !== ownerType) {
    errors.owner = REPOSITORY_MESSAGES.ownerUnknown;
  } else if (
    !canCreateRepositoryInNamespace({ memberships: context.memberships, owner, accountId: account.id })
  ) {
    errors.owner = REPOSITORY_MESSAGES.ownerForbidden;
  }

  const { name, error: nameError } = readRepositoryName(body.name);
  if (nameError) errors.name = nameError;
  const { description, error: descriptionError } = readRepositoryDescription(body.description);
  if (descriptionError) errors.description = descriptionError;
  const visibility = readVisibility(body.visibility);
  if (!visibility) errors.visibility = REPOSITORY_MESSAGES.visibility;
  const initialize = readInitialization(body.initialize);

  if (Object.keys(errors).length > 0) {
    sendJson(response, 400, { error: "Repository creation failed", errors });
    return;
  }

  const now = new Date().toISOString();
  const repository = {
    id: `repo-${randomUUID()}`,
    ownerType: owner.type,
    ownerId: owner.id,
    name,
    description,
    visibility,
    defaultBranch: DEFAULT_BRANCH,
    createdById: account.id,
    createdAt: now,
    updatedAt: now,
  };

  // The uniqueness check lives inside the queued store update, so two concurrent
  // creations of the same name cannot both succeed.
  let created = false;
  await stores.repositories.update((state) => {
    const taken = state.repositories.some(
      (candidate) =>
        candidate.ownerType === owner.type &&
        candidate.ownerId === owner.id &&
        repositoryKey(candidate.name) === repositoryKey(name),
    );
    if (taken) return;
    state.repositories.push(repository);
    created = true;
  });
  if (!created) {
    sendJson(response, 400, {
      error: "Repository creation failed",
      errors: { name: REPOSITORY_MESSAGES.nameTaken },
    });
    return;
  }

  let content = await stores.repositoryContent.read();
  if (initialize) {
    const initialization = buildInitialization({
      repository,
      authorId: account.id,
      authorName: account.username,
      description,
      now,
    });
    try {
      content = await stores.repositoryContent.update((state) => {
        state.branches.push(initialization.branch);
        state.commits.push(initialization.commit);
        state.files.push(initialization.file);
      });
    } catch {
      await rollbackCreation(stores, repository.id);
      sendJson(response, 500, { error: "Repository creation failed" });
      return;
    }
  }

  sendJson(response, 201, { repository: repositoryOverview(repository, owner.name, content) });
}

/**
 * Handles the collection endpoints above; returns false when the request belongs to
 * another module (`/api/repositories/:owner/:repository…`).
 */
export async function handleRepositoryCollectionRoutes({ request, response, url, stores, body }) {
  const method = request.method ?? "GET";
  if (url.pathname === "/api/repository-owners" && method === "GET") {
    await handleRepositoryOwners({ request, response, stores });
    return true;
  }
  if (url.pathname === "/api/repositories") {
    if (method === "GET") {
      const scope = url.searchParams.get("scope") ?? "mine";
      if (scope !== "mine") {
        sendJson(response, 400, { error: "Unsupported scope" });
        return true;
      }
      await handleListMyRepositories({ request, response, stores });
      return true;
    }
    if (method === "POST") {
      await handleCreateRepository({ request, response, stores, body: body ?? {} });
      return true;
    }
  }
  return false;
}
