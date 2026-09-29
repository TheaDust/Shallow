/**
 * Domain rules for repository creation (REQ-3-2-1). A repository always belongs to
 * exactly one namespace — an individual account (personal repository) or an
 * organization (organization repository) — and its name only has to be unique
 * inside that namespace, compared case-insensitively. The rules are mirrored by
 * the creation page for immediate field feedback; the server stays authoritative.
 */

export const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
export const REPOSITORY_NAME_MAX_LENGTH = 100;
export const REPOSITORY_DESCRIPTION_MAX_LENGTH = 500;

/** Default branch created by every repository initialization. */
export const DEFAULT_BRANCH = "main";
/** File created when the creation form asks for an initial commit. */
export const README_FILE = "README.md";
export const INITIAL_COMMIT_MESSAGE = "Initial commit";

export const REPOSITORY_MESSAGES = {
  nameRequired: "Repository name is required",
  nameFormat: "Repository name format is invalid",
  nameTaken: "Repository name already exists",
  descriptionTooLong: "Description is too long",
  visibility: "Visibility is invalid",
  ownerRequired: "Owner is required",
  ownerUnknown: "Owner not found",
  ownerForbidden: "You do not have permission to create repositories for this owner",
};

/** Lookup / uniqueness key: repository names ignore case, as on the served product. */
export function repositoryKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Returns the trimmed name, or the applicable message when it cannot be used. */
export function readRepositoryName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { name: null, error: REPOSITORY_MESSAGES.nameRequired };
  if (name.length > REPOSITORY_NAME_MAX_LENGTH || !REPOSITORY_NAME_PATTERN.test(name)) {
    return { name: null, error: REPOSITORY_MESSAGES.nameFormat };
  }
  return { name, error: null };
}

/** Description is optional; only its length is constrained. */
export function readRepositoryDescription(value) {
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length > REPOSITORY_DESCRIPTION_MAX_LENGTH) {
    return { description: null, error: REPOSITORY_MESSAGES.descriptionTooLong };
  }
  return { description, error: null };
}

/** Visibility is a two-valued option; an omitted value keeps the public default. */
export function readVisibility(value) {
  if (value === undefined || value === null || value === "") return "public";
  const visibility = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (visibility === "public" || visibility === "private") return visibility;
  return null;
}

export function readInitialization(value) {
  return value === true || value === "true";
}

/** Normalizes the submitted namespace: `{ ownerType, ownerName }`. */
export function readOwnerInput(body) {
  const ownerType = body?.ownerType === "organization" ? "organization" : "account";
  const ownerName = typeof body?.ownerName === "string" ? body.ownerName.trim() : "";
  return { ownerType, ownerName };
}

/**
 * Content of the README written by the initialization option. The file name is
 * fixed so a created repository always exposes the same initialization entry.
 */
export function initialReadmeContent(name, description = "") {
  const heading = `# ${name}\n`;
  return description ? `${heading}\n${description}\n` : heading;
}
