export class WorkbookError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WorkbookError";
    this.status = status;
  }
}
