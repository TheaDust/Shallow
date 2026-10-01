// Repository visibility changes.
//
// Switching a repository between Public and Private is a repository-Admin
// operation: the request is resolved from the trusted session, the target
// repository is re-read inside the same atomic update and the viewer's Admin
// permission is checked there. Every later read (search, repository lists and
// direct addresses) evaluates the stored value through the shared access rule,
// so one write is enough to change what every view shows.

import {
  canAdministerRepository,
  canReadRepository,
  repositoryByOwnerAndName,
} from "./access.mjs";
import { REPOSITORY_VISIBILITIES, serializeRepository } from "./repositories.mjs";

export const REPOSITORY_VISIBILITY_MESSAGES = {
  visibilityInvalid: "Visibility is invalid",
  confirmationMismatch: "Repository name does not match",
};

// The confirmation text is optional: the change never requires the repository
// name to be retyped. When the client does send a name it must match the stored
// one, so a mistyped confirmation leaves the repository untouched.
const CONFIRMATION_FIELDS = ["confirmation", "confirmName", "repositoryName"];

function requestedVisibility(input) {
  const raw =
    typeof input?.visibility === "string"
      ? input.visibility
      : typeof input?.value === "string"
        ? input.value
        : "";
  const normalized = raw.trim().toLowerCase();
  return REPOSITORY_VISIBILITIES.includes(normalized) ? normalized : null;
}

function confirmationText(input) {
  for (const field of CONFIRMATION_FIELDS) {
    const value = input?.[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

export function createRepositoryVisibilityService(store) {
  /**
   * Applies the requested visibility to `owner/name`. The outcome is either
   * `{ ok: true, repository }`, `{ unauthorized }`, `{ notFound }`,
   * `{ forbidden }` or `{ ok: false, fieldErrors }`.
   */
  async function changeVisibility(accountId, ownerName, repositoryName, input) {
    if (!accountId) return { unauthorized: true };

    let outcome = { ok: false, fieldErrors: {} };
    await store.update((state) => {
      const repository = repositoryByOwnerAndName(state, ownerName, repositoryName);
      if (!repository) {
        outcome = { notFound: true };
        return;
      }
      if (!canReadRepository(state, repository, accountId)) {
        outcome = { forbidden: true };
        return;
      }
      if (!canAdministerRepository(state, repository, accountId)) {
        outcome = { forbidden: true };
        return;
      }

      const visibility = requestedVisibility(input);
      if (!visibility) {
        outcome = {
          ok: false,
          fieldErrors: { visibility: REPOSITORY_VISIBILITY_MESSAGES.visibilityInvalid },
        };
        return;
      }
      const confirmation = confirmationText(input);
      if (
        confirmation.length > 0 &&
        confirmation.toLowerCase() !== repository.name.toLowerCase()
      ) {
        outcome = {
          ok: false,
          fieldErrors: { confirmation: REPOSITORY_VISIBILITY_MESSAGES.confirmationMismatch },
        };
        return;
      }

      const updatedAt = new Date().toISOString();
      state.repositories = (state.repositories ?? []).map((candidate) =>
        candidate.id === repository.id ? { ...candidate, visibility, updatedAt } : candidate,
      );
      const updated = state.repositories.find((candidate) => candidate.id === repository.id);
      outcome = { ok: true, repository: serializeRepository(state, updated) };
    });
    return outcome;
  }

  return { changeVisibility };
}
