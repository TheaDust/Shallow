/**
 * Domain failure carrying the HTTP status the API answers with. It lives in its
 * own module so every domain module (validation, filter, structure, workbooks)
 * can reject a request without importing the workbook service — a circular
 * import that would otherwise appear once the validation/filter models need it.
 * `workbooks.mjs` re-exports it for the existing callers.
 */
export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
