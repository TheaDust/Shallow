import type { WorkPacket } from "../types.js";
import type { ProbeCase, ProbeLocator, ProbePlan, ProbeStep } from "./probe-schema.js";
import { declaredGlobalSearchControls, requirementEvidenceTexts } from "./probe-schema.js";

type CompatibilityPacket = Pick<WorkPacket, "requirements"> & Partial<Pick<WorkPacket, "prerequisites">>;

export interface CompatibilityApplicability {
  url: boolean;
  authPublicEntry: boolean;
  globalControl: boolean;
  entityDetailIdentity: boolean;
  uniquePublishConflict: boolean;
}

/** Semantic triggers only: no product names, packet IDs, seed prefixes or fixture counts. */
export function compatibilityApplicability(packet: CompatibilityPacket): CompatibilityApplicability {
  const own = packet.requirements.flatMap(item => [item.text,
    ...(item.scenarioContracts ?? []).flatMap(scenario => scenario.steps.map(step => step.content))]).join(" ");
  const inherited = packet.requirements.some(item => item.product.evolution);
  const localOverlay = /\b(?:dialog|menu|popover)\b/i.test(own) &&
    !/\b(?:detail|overview)\s+page\b|\bpage\s+(?:displays?|shows?|opens?)\b/i.test(own);
  return {
    url: /\b(?:page\s+)?(?:address|url)\b/i.test(own),
    authPublicEntry: inherited && /\b(?:revok(?:e|ed|ing)|expir(?:e|ed|ing))\b[^.!?]*\b(?:session|browser)\b|\b(?:session|browser)\b[^.!?]*\b(?:revok(?:e|ed|ing)|expir(?:e|ed|ing))\b/i.test(own) &&
      /\b(?:sign[ -]?in|log[ -]?in|unauthenticated)\b/i.test(own),
    globalControl: inherited && declaredGlobalSearchControls(packet).length === 1,
    entityDetailIdentity: inherited && !localOverlay && /\bdetail\b/i.test(own) &&
      /\b(?:unique|identifier|tag)\b/i.test(own) && /\b(?:opens?|displays?|shows?)\b/i.test(own),
    uniquePublishConflict: inherited && !localOverlay && /\b(?:create|publish)(?:es|ed|ing)?\b/i.test(own) &&
      /\b(?:unique|duplicate|conflict|already exists)\b/i.test(own) && /\bform\b/i.test(own) &&
      /\b(?:detail|overview|entity|record|item)\b/i.test(own),
  };
}

/**
 * Validate the compatibility conventions that can be derived without browser
 * discovery. These checks tighten a Planner plan but never create verified
 * status; browser-only contracts are executed as separate compatibility plans.
 */
export function assertCompatibilityPlan(plan: ProbePlan, packet: CompatibilityPacket): void {
  const applies = compatibilityApplicability(packet);
  if (applies.authPublicEntry) assertAuthPublicEntry(plan, packet);
  if (applies.entityDetailIdentity) assertDetailIdentityHeadings(plan, packet);
  if (applies.uniquePublishConflict) assertUniqueConflictContext(plan, packet);
}

function assertAuthPublicEntry(plan: ProbePlan, packet: CompatibilityPacket): void {
  const names = declaredPublicEntryLinks(packet);
  if (!names.length) return;
  const relevant = relevantCases(plan, packet, text =>
    /\brevoked browser\b|\bredirected to (?:the )?(?:sign[ -]?in|log[ -]?in) page\b/i.test(text));
  if (!relevant.length) return;
  const valid = relevant.some(probeCase => probeCase.steps.some(step => step.op === "expectVisible" &&
    locatorName(step.locator) !== undefined && names.includes(locatorName(step.locator)!) &&
    step.locator.by === "role" && step.locator.role === "link" && step.locator.exact === true &&
    step.locator.scope?.by === "role" && step.locator.scope.role === "main"));
  if (!valid) throw new Error("Compatibility contract requires the declared unauthenticated entry link to be visible in main after session revocation");
}

function assertDetailIdentityHeadings(plan: ProbePlan, packet: CompatibilityPacket): void {
  for (const requirement of packet.requirements) {
    if (!/\bdetail\b/i.test(requirement.text) || !/\b(?:unique|identifier|tag)\b/i.test(requirement.text)) continue;
    for (const scenario of requirement.scenarioContracts ?? []) {
      const then = scenario.steps.filter(step => ["THEN", "AND", "BUT"].includes(step.keyword.toUpperCase()))
        .map(step => step.content).join(" ");
      if (!/\bdetail\b[^.!?]*\bdisplays?\b/i.test(then)) continue;
      const value = detailIdentityValue(then, scenario.steps.find(step => step.keyword.toUpperCase() === "WHEN")?.content ?? "");
      if (!value || sensitive(value)) continue;
      const cases = plan.cases.filter(probeCase => (probeCase.outcomeChecks ?? []).some(check => check.scenarioId === scenario.id));
      if (!cases.length) continue;
      const valid = cases.some(probeCase => probeCase.steps.some(step => exactHeading(step, value)));
      if (!valid) throw new Error(`Compatibility contract requires detail identity ${JSON.stringify(value)} as an exact heading`);
    }
  }
}

function assertUniqueConflictContext(plan: ProbePlan, packet: CompatibilityPacket): void {
  for (const requirement of packet.requirements) {
    if (!/\b(?:create|publish)(?:es|ed|ing)?\b/i.test(requirement.text) ||
      !/\b(?:unique|duplicate|already exists|conflict)\b/i.test(requirement.text) || !/\bform\b/i.test(requirement.text)) continue;
    for (const scenario of requirement.scenarioContracts ?? []) {
      const then = scenario.steps.filter(step => ["THEN", "AND", "BUT"].includes(step.keyword.toUpperCase()))
        .map(step => step.content).join(" ");
      if (!/\b(?:already exists|duplicate|conflict)\b/i.test(then)) continue;
      const when = scenario.steps.find(step => step.keyword.toUpperCase() === "WHEN")?.content ?? "";
      const value = /\b(?:existing|duplicate|conflicting)\b[^`]{0,80}`([^`]+)`/i.exec(when)?.[1];
      if (!value || sensitive(value)) continue;
      const cases = plan.cases.filter(probeCase => (probeCase.outcomeChecks ?? []).some(check => check.scenarioId === scenario.id));
      if (!cases.length) continue;
      const valid = cases.some(probeCase => {
        const submitted = probeCase.steps.some(step => step.op === "fill" && step.value === value);
        const retained = probeCase.steps.some(step => step.op === "expectValue" && step.value === value);
        const single = probeCase.steps.some(step => step.op === "expectCount" && step.count === 1 &&
          locatorName(step.locator) === value && step.locator.exact === true);
        return submitted && retained && single;
      });
      if (!valid) throw new Error(`Compatibility contract requires the non-sensitive submitted identifier ${JSON.stringify(value)} to remain in the form and appear exactly once in the conflict context`);
    }
  }
}

function relevantCases(plan: ProbePlan, packet: CompatibilityPacket, matches: (text: string) => boolean): ProbeCase[] {
  const ids = new Set(packet.requirements.flatMap(requirement => (requirement.scenarioContracts ?? [])
    .filter(scenario => scenario.steps.some(step => ["THEN", "AND", "BUT"].includes(step.keyword.toUpperCase()) && matches(step.content)))
    .map(scenario => scenario.id)));
  return plan.cases.filter(probeCase => (probeCase.outcomeChecks ?? []).some(check => ids.has(check.scenarioId)));
}

function declaredPublicEntryLinks(packet: CompatibilityPacket): string[] {
  const names = new Set<string>();
  for (const text of requirementEvidenceTexts(packet.requirements, packet.prerequisites)) {
    for (const match of text.matchAll(/\b(?:visible\s+)?link(?:\s+named)?\s*[“"']([^”"']+)[”"']/gi)) names.add(match[1]);
  }
  return [...names];
}

function exactHeading(step: ProbeStep, value: string): boolean {
  if (!("locator" in step) || step.locator.by !== "role" || step.locator.role !== "heading" || step.locator.exact !== true) return false;
  if (step.locator.name === value && step.op === "expectVisible") return true;
  return step.op === "expectText" && step.text === value && step.exact === true;
}

function locatorName(locator: ProbeLocator): string | undefined {
  return locator.by === "role" ? locator.name : locator.text;
}

function detailIdentityValue(then: string, when: string): string | undefined {
  return /\bdetail\b[^`]{0,80}`([^`]+)`/i.exec(then)?.[1] ??
    /\bopens?\s+(?:the\s+)?(?:exact\s+)?`([^`]+)`\s+[\p{L}\p{N}_-]+\b/iu.exec(when)?.[1] ??
    /\benters?\s+(?:the\s+)?(?:unique\s+)?(?:identifier|tag|name|title)\s+`([^`]+)`/i.exec(when)?.[1];
}

function sensitive(value: string): boolean {
  return value.includes("@") || /\b(?:password|token|secret|api[_-]?key)\b/i.test(value);
}
