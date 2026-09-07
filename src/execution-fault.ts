/** Execution infrastructure failed to produce product evidence. Never a Shadow verdict. */
export class ExecutionFault extends Error {
  constructor(
    readonly source: "browser" | "builder",
    readonly code: "browser_launch" | "browser_disconnected" | "page_crashed" | "builder_start" | "builder_self_test",
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(`${source}: ${code}`, options);
    this.name = "ExecutionFault";
  }
}
