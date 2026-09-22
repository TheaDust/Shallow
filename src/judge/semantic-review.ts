import type { WorkPacket } from "../types.js";
import {
  assertQuotesGrounded,
  parseProbePlan,
  probePlanSha256,
  requirementEvidenceTexts,
  PROBE_PLAN_BODY,
  PROBE_PLAN_JSON_SCHEMA,
  type ProbePlan,
} from "./probe-schema.js";

export interface PlanCorrection {
  caseId: string;
  conflict: string;
  basis: string[];
}

export type PlanReview =
  | { status: "sound"; rationale: string }
  | { status: "corrected"; rationale: string; plan: ProbePlan; corrections: PlanCorrection[] };

const MAX_RATIONALE = 2_000;
const MAX_CONFLICT = 1_000;
const MAX_QUOTE = 2_000;
const MAX_CORRECTIONS = 6;
const MAX_BASIS_QUOTES = 3;

export const PROBE_REVIEW_JSON_SCHEMA = {
  $defs: { ...PROBE_PLAN_JSON_SCHEMA.$defs, plan: PROBE_PLAN_BODY },
  type: "object",
  additionalProperties: false,
  required: ["verdict", "rationale"],
  properties: {
    verdict: { type: "string", enum: ["sound", "corrected"] },
    rationale: { type: "string", minLength: 1, maxLength: MAX_RATIONALE },
    corrections: {
      type: ["array", "null"],
      maxItems: MAX_CORRECTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseId", "conflict", "basis"],
        properties: {
          caseId: { type: "string", minLength: 1 },
          conflict: { type: "string", minLength: 1, maxLength: MAX_CONFLICT },
          basis: { type: "array", minItems: 1, maxItems: MAX_BASIS_QUOTES, items: { type: "string", minLength: 1 } },
        },
      },
    },
    plan: { anyOf: [{ $ref: "#/$defs/plan" }, { type: "null" }] },
  },
} as const;

export function parsePlanReview(
  value: unknown,
  packet: Pick<WorkPacket, "id" | "requirementIds"> & Partial<Pick<WorkPacket, "requirements" | "prerequisites">>,
  original: ProbePlan,
): PlanReview {
  const review = record(value, "PlanReview");
  keys(review, ["verdict", "rationale", "corrections", "plan"], "PlanReview");
  const rationale = boundedText(review.rationale, "PlanReview.rationale", MAX_RATIONALE);
  if (review.verdict === "sound") {
    if (review.corrections != null || review.plan != null) {
      throw new Error("PlanReview verdict sound must not carry corrections or a plan");
    }
    return { status: "sound", rationale };
  }
  if (review.verdict !== "corrected") throw new Error("PlanReview.verdict must be sound or corrected");
  if (review.plan == null) throw new Error("PlanReview verdict corrected requires a corrected plan");
  const plan = parseProbePlan(review.plan, packet);
  if (probePlanSha256(plan) === probePlanSha256(original)) {
    throw new Error("PlanReview corrected plan must differ from the reviewed plan");
  }
  const correctionValues = array(review.corrections, "PlanReview.corrections");
  if (correctionValues.length === 0) throw new Error("PlanReview corrected verdict requires corrections");
  if (correctionValues.length > MAX_CORRECTIONS) {
    throw new Error(`PlanReview allows at most ${MAX_CORRECTIONS} corrections`);
  }
  const originalIds = new Set(original.cases.map(item => item.id));
  const correctedIds = new Set(plan.cases.map(item => item.id));
  const seen = new Set<string>();
  const corrections = correctionValues.map((item, index) => {
    const location = `PlanReview.corrections[${index}]`;
    const correction = record(item, location);
    keys(correction, ["caseId", "conflict", "basis"], location);
    const caseId = boundedText(correction.caseId, `${location}.caseId`, MAX_QUOTE);
    if (!originalIds.has(caseId) || !correctedIds.has(caseId)) {
      throw new Error(`${location}.caseId must name a case of the reviewed and corrected plans`);
    }
    if (seen.has(caseId)) throw new Error(`${location}.caseId is duplicated: ${caseId}`);
    seen.add(caseId);
    const conflict = boundedText(correction.conflict, `${location}.conflict`, MAX_CONFLICT);
    const basisValues = array(correction.basis, `${location}.basis`);
    if (basisValues.length === 0 || basisValues.length > MAX_BASIS_QUOTES) {
      throw new Error(`${location}.basis must carry 1-${MAX_BASIS_QUOTES} quotes`);
    }
    const basis = basisValues.map((quote, quoteIndex) => boundedText(quote, `${location}.basis[${quoteIndex}]`, MAX_QUOTE));
    if (packet.requirements) {
      const correctedCase = plan.cases.find(item => item.id === caseId);
      const scoped = packet.requirements.filter(item => correctedCase?.requirementIds.includes(item.id));
      assertQuotesGrounded(basis, requirementEvidenceTexts(scoped, packet.prerequisites ?? []), `${location}.basis`);
    }
    return { caseId, conflict, basis };
  });
  return { status: "corrected", rationale, plan, corrections };
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

function boundedText(value: unknown, location: string, limit: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) {
    throw new Error(`${location} must be a non-empty string up to ${limit} characters`);
  }
  return value;
}

function keys(value: Record<string, unknown>, allowed: string[], location: string): void {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra) throw new Error(`${location} contains unsupported field: ${extra}`);
}
