/**
 * The creation limits of a pull request (REQ-6-2-3). The comparison page gates
 * its creation form with the same rules the server applies, so a blank or
 * overlong title is reported next to the field and never reaches the API:
 * the title is the 1–256 non-empty characters that remain after trimming the
 * surrounding whitespace, and the optional description holds at most 65536
 * characters. The messages mirror `domain/pull-requests.mjs`.
 */

export const PULL_REQUEST_TITLE_MAX_LENGTH = 256;
export const PULL_REQUEST_DESCRIPTION_MAX_LENGTH = 65_536;

export const PULL_REQUEST_TITLE_REQUIRED = "Title is required";
export const PULL_REQUEST_TITLE_TOO_LONG = `Title is too long (${PULL_REQUEST_TITLE_MAX_LENGTH} characters maximum)`;
export const PULL_REQUEST_DESCRIPTION_TOO_LONG = `Description is too long (${PULL_REQUEST_DESCRIPTION_MAX_LENGTH} characters maximum)`;

/** The text a creation stores: the submitted value without its outer blanks. */
export function trimPullRequestText(value: string): string {
  return value.trim();
}

/** The complaint of a submitted title, or null when the title is acceptable. */
export function pullRequestTitleError(value: string): string | null {
  const title = trimPullRequestText(value);
  if (!title) return PULL_REQUEST_TITLE_REQUIRED;
  if (title.length > PULL_REQUEST_TITLE_MAX_LENGTH) return PULL_REQUEST_TITLE_TOO_LONG;
  return null;
}

/** The complaint of an optional submitted description, or null when it fits. */
export function pullRequestDescriptionError(value: string): string | null {
  return trimPullRequestText(value).length > PULL_REQUEST_DESCRIPTION_MAX_LENGTH
    ? PULL_REQUEST_DESCRIPTION_TOO_LONG
    : null;
}
