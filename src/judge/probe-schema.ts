import type { WorkPacket } from "../types.js";

export type ProbeLocator =
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "label"; text: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean };

export type ProbeStep =
  | { op: "goto"; path: string }
  | { op: "click"; locator: ProbeLocator }
  | { op: "fill"; locator: ProbeLocator; value: string }
  | { op: "select"; locator: ProbeLocator; value: string }
  | { op: "expectVisible"; locator: ProbeLocator }
  | { op: "expectText"; locator: ProbeLocator; text: string; exact?: boolean }
  | { op: "expectValue"; locator: ProbeLocator; value: string }
  | { op: "expectCount"; locator: ProbeLocator; count: number }
  | { op: "reload" }
  | { op: "newContext"; actor?: string };

export interface ProbeCase {
  id: string;
  requirementIds: string[];
  purpose: "happy_path" | "persistence" | "negative" | "permission";
  steps: ProbeStep[];
}

export interface ProbePlan {
  packetId: string;
  cases: ProbeCase[];
}

export type { ShadowReport } from "../types.js";

export const PROBE_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["packetId", "cases"],
  properties: {
    packetId: { type: "string" },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "requirementIds", "purpose", "steps"],
        properties: {
          id: { type: "string" },
          requirementIds: { type: "array", minItems: 1, items: { type: "string" } },
          purpose: {
            enum: ["happy_path", "persistence", "negative", "permission"],
          },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            description:
              "Allowed op values: goto, click, fill, select, expectVisible, expectText, expectValue, expectCount, reload, newContext. Locators use role, label, or text only.",
            items: { type: "object" },
          },
        },
      },
    },
  },
} as const;

const MAX_CASES = 6;
const MAX_STEPS = 30;
const MAX_STRING = 2_000;

export function parseProbePlan(
  value: unknown,
  packet?: Pick<WorkPacket, "id" | "requirementIds">,
): ProbePlan {
  const plan = record(value, "ProbePlan");
  keys(plan, ["packetId", "cases"], "ProbePlan");
  const packetId = text(plan.packetId, "ProbePlan.packetId");
  if (packet && packetId !== packet.id) {
    throw new Error(`ProbePlan packetId ${packetId} does not match ${packet.id}`);
  }
  const caseValues = array(plan.cases, "ProbePlan.cases");
  if (caseValues.length === 0) throw new Error("ProbePlan requires at least one case");
  if (caseValues.length > MAX_CASES) {
    throw new Error(`ProbePlan allows at most ${MAX_CASES} cases`);
  }

  const seen = new Set<string>();
  const cases = caseValues.map((candidate, index) => {
    const parsed = parseCase(candidate, index, packet?.requirementIds);
    if (seen.has(parsed.id)) throw new Error(`Duplicate case id: ${parsed.id}`);
    seen.add(parsed.id);
    return parsed;
  });
  return { packetId, cases };
}

export function assertLocatorOnlyRefinement(
  original: ProbePlan,
  refined: ProbePlan,
): void {
  if (original.packetId !== refined.packetId || original.cases.length !== refined.cases.length) {
    throw new Error("Refinement may change only locator fields");
  }

  for (let caseIndex = 0; caseIndex < original.cases.length; caseIndex += 1) {
    const beforeCase = original.cases[caseIndex];
    const afterCase = refined.cases[caseIndex];
    if (
      beforeCase.id !== afterCase.id ||
      beforeCase.purpose !== afterCase.purpose ||
      JSON.stringify(beforeCase.requirementIds) !== JSON.stringify(afterCase.requirementIds) ||
      beforeCase.steps.length !== afterCase.steps.length
    ) {
      throw new Error("Refinement may change only locator fields");
    }

    for (let stepIndex = 0; stepIndex < beforeCase.steps.length; stepIndex += 1) {
      const before = beforeCase.steps[stepIndex];
      const after = afterCase.steps[stepIndex];
      if (before.op !== after.op) throw new Error("Refinement may change only locator fields");

      const beforeBehavior = { ...before, ...("locator" in before ? { locator: undefined } : {}) };
      const afterBehavior = { ...after, ...("locator" in after ? { locator: undefined } : {}) };
      if (JSON.stringify(beforeBehavior) !== JSON.stringify(afterBehavior)) {
        throw new Error("Refinement may change only locator fields");
      }
    }
  }
}

function parseCase(
  value: unknown,
  index: number,
  allowedRequirementIds?: string[],
): ProbeCase {
  const location = `ProbePlan.cases[${index}]`;
  const candidate = record(value, location);
  keys(candidate, ["id", "requirementIds", "purpose", "steps"], location);
  const id = text(candidate.id, `${location}.id`);
  const requirementIds = array(candidate.requirementIds, `${location}.requirementIds`).map(
    (item, requirementIndex) =>
      text(item, `${location}.requirementIds[${requirementIndex}]`),
  );
  if (requirementIds.length === 0) {
    throw new Error(`${location}.requirementIds must not be empty`);
  }
  if (
    allowedRequirementIds &&
    requirementIds.some((requirementId) => !allowedRequirementIds.includes(requirementId))
  ) {
    throw new Error(`${location} references requirement outside packet`);
  }
  const purpose = candidate.purpose;
  if (
    purpose !== "happy_path" &&
    purpose !== "persistence" &&
    purpose !== "negative" &&
    purpose !== "permission"
  ) {
    throw new Error(`${location}.purpose is invalid`);
  }
  const stepValues = array(candidate.steps, `${location}.steps`);
  if (stepValues.length === 0) throw new Error(`${location} requires at least one step`);
  if (stepValues.length > MAX_STEPS) {
    throw new Error(`${location} allows at most ${MAX_STEPS} steps`);
  }
  const steps = stepValues.map((step, stepIndex) =>
    parseStep(step, `${location}.steps[${stepIndex}]`),
  );
  return { id, requirementIds, purpose, steps };
}

function parseStep(value: unknown, location: string): ProbeStep {
  const step = record(value, location);
  const op = text(step.op, `${location}.op`);
  switch (op) {
    case "goto": {
      keys(step, ["op", "path"], location);
      const path = text(step.path, `${location}.path`);
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        /(^|\/)\.\.(\/|$)/.test(path) ||
        /^[a-z][a-z0-9+.-]*:/i.test(path)
      ) {
        throw new Error(`${location} ProbePlan goto path must stay on the app origin`);
      }
      return { op, path };
    }
    case "click":
    case "expectVisible": {
      keys(step, ["op", "locator"], location);
      return { op, locator: parseLocator(step.locator, `${location}.locator`) };
    }
    case "fill":
    case "select":
    case "expectValue": {
      keys(step, ["op", "locator", "value"], location);
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        value: text(step.value, `${location}.value`),
      };
    }
    case "expectText": {
      keys(step, ["op", "locator", "text", "exact"], location);
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        text: text(step.text, `${location}.text`),
        ...(step.exact === undefined ? {} : { exact: boolean(step.exact, `${location}.exact`) }),
      };
    }
    case "expectCount": {
      keys(step, ["op", "locator", "count"], location);
      const count = step.count;
      if (!Number.isSafeInteger(count) || (count as number) < 0) {
        throw new Error(`${location}.count must be a non-negative integer`);
      }
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        count: count as number,
      };
    }
    case "reload":
      keys(step, ["op"], location);
      return { op };
    case "newContext":
      keys(step, ["op", "actor"], location);
      return {
        op,
        ...(step.actor === undefined ? {} : { actor: text(step.actor, `${location}.actor`) }),
      };
    default:
      throw new Error(`${location} ProbePlan operation is not allowed: ${op}`);
  }
}

function parseLocator(value: unknown, location: string): ProbeLocator {
  const locator = record(value, location);
  const by = text(locator.by, `${location}.by`);
  if (by === "role") {
    keys(locator, ["by", "role", "name", "exact"], location);
    return {
      by,
      role: text(locator.role, `${location}.role`),
      ...(locator.name === undefined ? {} : { name: text(locator.name, `${location}.name`) }),
      ...(locator.exact === undefined
        ? {}
        : { exact: boolean(locator.exact, `${location}.exact`) }),
    };
  }
  if (by === "label" || by === "text") {
    keys(locator, ["by", "text", "exact"], location);
    return {
      by,
      text: text(locator.text, `${location}.text`),
      ...(locator.exact === undefined
        ? {}
        : { exact: boolean(locator.exact, `${location}.exact`) }),
    };
  }
  throw new Error(`${location} ProbePlan locator must use role, label, or text`);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
  return value;
}

function text(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING) {
    throw new Error(`${location} must be a non-empty string up to ${MAX_STRING} characters`);
  }
  return value;
}

function boolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${location} must be a boolean`);
  return value;
}

function keys(
  value: Record<string, unknown>,
  allowed: string[],
  location: string,
): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`${location} contains unsupported ProbePlan field: ${extra}`);
}
