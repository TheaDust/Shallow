import { cp } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  BuilderPort,
  BuilderRequest,
  BuilderResult,
} from "../../src/builder/port.js";

export class FakeBuilder implements BuilderPort {
  readonly requests: BuilderRequest[] = [];
  private callIndex = 0;

  constructor(
    private readonly outcomes: BuilderResult["outcome"][] = ["completed"],
  ) {}

  async run(request: BuilderRequest): Promise<BuilderResult> {
    this.requests.push(request);
    await cp(resolve("test/fixtures/app"), request.outputDir, {
      recursive: true,
      force: true,
    });
    const outcome = this.outcomes[this.callIndex] ?? this.outcomes.at(-1) ?? "completed";
    this.callIndex += 1;
    return {
      sessionId: `fake-session-${this.callIndex}`,
      outcome,
      summary: `Fake builder ${outcome}`,
    };
  }

  async close(): Promise<void> {}
}
