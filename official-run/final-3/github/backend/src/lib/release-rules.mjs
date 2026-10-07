// Exact messages and validators of the repository-release operations (REQ-4-5).
// The tag is required and unique inside its repository; the title is required
// and the target must be an existing branch of the same repository.

export const RELEASE_MESSAGES = {
  tagRequired: "Tag name is required",
  tagExists: "Tag already exists",
  titleRequired: "Release title is required",
  branchInvalid: "Target branch is invalid",
  releaseNotFound: "Release not found",
};

/** A release tag is a non-empty name after trimming. */
export function validateReleaseTag(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 255;
}

/** A release title is a non-empty name after trimming. */
export function validateReleaseTitle(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 255;
}
