import type { WorkPacket } from "../types.js";

export type ProbeLocator =
  | { by: "role"; role: string; name?: string; exact?: boolean }
  | { by: "label"; text: string; exact?: boolean }
  | { by: "text"; text: string; exact?: boolean };

export const PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
] as const;

export type ProbePressKey = (typeof PRESS_KEYS)[number];

export type ProbeStep =
  | { op: "goto"; path: string }
  | { op: "click"; locator: ProbeLocator }
  | { op: "doubleClick"; locator: ProbeLocator }
  | { op: "hover"; locator: ProbeLocator }
  | { op: "press"; locator: ProbeLocator; key: ProbePressKey }
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

const STRING_SCHEMA = { type: "string", maxLength: 2_000 };
const NONEMPTY_STRING_SCHEMA = { ...STRING_SCHEMA, minLength: 1 };
const OPTIONAL_STRING_SCHEMA = { type: ["string", "null"], maxLength: 2_000 };
const OPTIONAL_BOOLEAN_SCHEMA = { type: ["boolean", "null"] };

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function literalSchema(value: string) {
  return { type: "string", enum: [value] };
}

const LOCATOR_SCHEMA = {
  anyOf: [
    objectSchema({
      by: literalSchema("role"), role: NONEMPTY_STRING_SCHEMA,
      name: OPTIONAL_STRING_SCHEMA, exact: OPTIONAL_BOOLEAN_SCHEMA,
    }),
    ...["label", "text"].map((by) => objectSchema({
      by: literalSchema(by), text: NONEMPTY_STRING_SCHEMA, exact: OPTIONAL_BOOLEAN_SCHEMA,
    })),
  ],
};
const LOCATOR_REF = { $ref: "#/$defs/locator" };
const STEP_SCHEMA = {
  anyOf: [
    objectSchema({ op: literalSchema("goto"), path: NONEMPTY_STRING_SCHEMA }),
    ...["click", "expectVisible", "doubleClick", "hover"].map((op) => objectSchema({
      op: literalSchema(op), locator: LOCATOR_REF,
    })),
    ...["fill", "select", "expectValue"].map((op) => objectSchema({
      op: literalSchema(op), locator: LOCATOR_REF, value: STRING_SCHEMA,
    })),
    objectSchema({
      op: literalSchema("press"), locator: LOCATOR_REF,
      key: { type: "string", enum: [...PRESS_KEYS] },
    }),
    objectSchema({
      op: literalSchema("expectText"), locator: LOCATOR_REF,
      text: STRING_SCHEMA, exact: OPTIONAL_BOOLEAN_SCHEMA,
    }),
    objectSchema({
      op: literalSchema("expectCount"), locator: LOCATOR_REF,
      count: { type: "integer", minimum: 0 },
    }),
    objectSchema({ op: literalSchema("reload") }),
    objectSchema({ op: literalSchema("newContext"), actor: { ...OPTIONAL_STRING_SCHEMA, minLength: 1 } }),
  ],
};

export const PROBE_PLAN_JSON_SCHEMA = {
  $defs: { locator: LOCATOR_SCHEMA },
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
            type: "string",
            enum: ["happy_path", "persistence", "negative", "permission"],
          },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            description:
              "Allowed op values: goto, click, doubleClick, hover, press, fill, select, expectVisible, expectText, expectValue, expectCount, reload, newContext. press key must be one of: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End. Locators use role, label, or text only. Locator strings and expectText text are literal, not regular expressions; expectText matches the full text unless exact: false; expectCount count 0 asserts absence.",
            items: STEP_SCHEMA,
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
  if (packet) {
    const covered = new Set(cases.flatMap((probeCase) => probeCase.requirementIds));
    const missing = packet.requirementIds.filter((id) => !covered.has(id));
    if (missing.length > 0) throw new Error(`ProbePlan does not cover requirements: ${missing.join(", ")}`);
  }
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
  if (!steps.some((step) => step.op.startsWith("expect"))) {
    throw new Error(`${location} requires at least one assertion`);
  }
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
        /[\\\u0000-\u0020\u007f]/.test(path) ||
        /(^|\/)\.\.(\/|$)/.test(path) ||
        /^[a-z][a-z0-9+.-]*:/i.test(path)
      ) {
        throw new Error(`${location} ProbePlan goto path must stay on the app origin`);
      }
      return { op, path };
    }
    case "click":
    case "doubleClick":
    case "hover":
    case "expectVisible": {
      keys(step, ["op", "locator"], location);
      return { op, locator: parseLocator(step.locator, `${location}.locator`) };
    }
    case "press": {
      keys(step, ["op", "locator", "key"], location);
      const key = step.key;
      if (typeof key !== "string" || !PRESS_KEYS.includes(key as ProbePressKey)) {
        throw new Error(`${location}.key must be one of: ${PRESS_KEYS.join(", ")}`);
      }
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        key: key as ProbePressKey,
      };
    }
    case "fill":
    case "select":
    case "expectValue": {
      keys(step, ["op", "locator", "value"], location);
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        value: dataText(step.value, `${location}.value`),
      };
    }
    case "expectText": {
      keys(step, ["op", "locator", "text", "exact"], location);
      return {
        op,
        locator: parseLocator(step.locator, `${location}.locator`),
        text: dataText(step.text, `${location}.text`),
        ...(step.exact == null ? {} : { exact: boolean(step.exact, `${location}.exact`) }),
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
        ...(step.actor == null ? {} : { actor: text(step.actor, `${location}.actor`) }),
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
      ...(locator.name == null ? {} : { name: dataText(locator.name, `${location}.name`) }),
      ...(locator.exact == null
        ? {}
        : { exact: boolean(locator.exact, `${location}.exact`) }),
    };
  }
  if (by === "label" || by === "text") {
    keys(locator, ["by", "text", "exact"], location);
    return {
      by,
      text: text(locator.text, `${location}.text`),
      ...(locator.exact == null
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

function dataText(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length > MAX_STRING) {
    throw new Error(`${location} must be a string up to ${MAX_STRING} characters`);
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
