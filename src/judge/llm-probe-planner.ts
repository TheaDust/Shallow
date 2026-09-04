import type { WorkPacket } from "../types.js";
import {
  PROBE_PLAN_JSON_SCHEMA,
  assertLocatorOnlyRefinement,
  parseProbePlan,
  type ProbePlan,
} from "./probe-schema.js";

export interface ProbePlanner {
  plan(packet: WorkPacket): Promise<ProbePlan>;
  refineLocators(original: ProbePlan, snapshot: string): Promise<ProbePlan>;
}

export interface ProbePlannerConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export type ProbePlannerErrorCategory =
  | "transport"
  | "response"
  | "json"
  | "schema"
  | "refinement";

export class ProbePlannerError extends Error {
  constructor(
    readonly category: ProbePlannerErrorCategory,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProbePlannerError";
  }
}

export class LlmProbePlanner implements ProbePlanner {
  private readonly refinedPacketIds = new Set<string>();

  constructor(
    private readonly config: ProbePlannerConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async plan(packet: WorkPacket): Promise<ProbePlan> {
    const content = await this.complete([
      {
        role: "system",
        content:
          "Create independent black-box browser probes from only the supplied requirement evidence. Return JSON matching the schema. Cover a happy path and add persistence, negative, or permission cases only when required. Use only the listed operations and accessible locators.",
      },
      {
        role: "user",
        content: JSON.stringify({
          packetId: packet.id,
          requirements: packet.requirements.map((requirement) => ({
            id: requirement.id,
            name: requirement.name,
            text: requirement.text,
            scenarios: requirement.scenarios,
            references: requirement.references,
            exactUiStrings: requirement.exactUiStrings,
          })),
        }),
      },
    ]);
    return this.parse(content, packet);
  }

  async refineLocators(original: ProbePlan, snapshot: string): Promise<ProbePlan> {
    if (this.refinedPacketIds.has(original.packetId)) {
      throw new ProbePlannerError(
        "refinement",
        `Locator refinement already used for ${original.packetId}`,
      );
    }
    this.refinedPacketIds.add(original.packetId);
    const content = await this.complete([
      {
        role: "system",
        content:
          "Adjust locator objects only, using the accessibility snapshot. Preserve case order, operations, inputs, expected values, assertions, and step counts. Return the complete JSON plan.",
      },
      {
        role: "user",
        content: JSON.stringify({
          original,
          accessibilitySnapshot: sanitizeSnapshot(snapshot),
        }),
      },
    ]);
    const refined = this.parse(content, {
      id: original.packetId,
      requirementIds: [...new Set(original.cases.flatMap((item) => item.requirementIds))],
    });
    try {
      assertLocatorOnlyRefinement(original, refined);
    } catch (error) {
      throw new ProbePlannerError(
        "refinement",
        "Planner changed behavior during locator refinement",
        { cause: error },
      );
    }
    return refined;
  }

  private async complete(
    messages: Array<{ role: "system" | "user"; content: string }>,
  ): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "probe_plan",
              strict: true,
              schema: PROBE_PLAN_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ProbePlannerError("transport", "Probe planner request failed", {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new ProbePlannerError(
        "transport",
        `Probe planner returned HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ProbePlannerError("response", "Probe planner returned invalid response JSON", {
        cause: error,
      });
    }
    const content = extractContent(payload);
    if (content === undefined) {
      throw new ProbePlannerError("response", "Probe planner response has no message content");
    }
    return content;
  }

  private parse(
    content: string,
    packet: Pick<WorkPacket, "id" | "requirementIds">,
  ): ProbePlan {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch (error) {
      throw new ProbePlannerError("json", "Probe planner content is not JSON", {
        cause: error,
      });
    }
    try {
      return parseProbePlan(value, packet);
    } catch (error) {
      throw new ProbePlannerError("schema", "Probe planner content violates ProbePlan", {
        cause: error,
      });
    }
  }
}

function extractContent(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}

function sanitizeSnapshot(snapshot: string): string {
  return snapshot
    .replace(/\b(password|token|api[_-]?key|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 4_000);
}
