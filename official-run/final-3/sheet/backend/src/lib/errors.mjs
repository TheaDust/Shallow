/**
 * Typed request errors shared by the store, the domain modules and the HTTP
 * layer. `status` is the response code the handler uses for the message, so a
 * rejected request always surfaces the same text on the client.
 */

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}
