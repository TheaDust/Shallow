import type { ShadowReport, WorkPacket } from "../types.js";
import { parseProbePlan, type ProbePlan, type ProbeStep } from "./probe-schema.js";

/** Recover requirement-backed seed navigation using the visible search and object identity. */
export function rootSearchNavigationPlan(packet: WorkPacket, plan: ProbePlan, report: ShadowReport): ProbePlan | undefined {
  if (report.verdict === "pass" || report.failures.length === 0) return undefined;
  const evidence = [...packet.requirements, ...(packet.prerequisites ?? [])];
  // Search must be an allowed entry path in the requirement context, not an
  // invented substitute for a specifically required home-page link.
  const navigationText = evidence.flatMap(requirement => [requirement.text, ...requirement.scenarios,
    ...requirement.seedDeclarations,
    ...requirement.ancestors.map(ancestor => ancestor.description)]).join(" ");
  const seedDeclarations = evidence
    .flatMap(requirement => requirement.seedDeclarations);
  const changes = new Map<string, { index: number; steps: ProbeStep[]; inserted: number }>();
  for (const failure of report.failures) {
    if (failure.category !== "locator" && failure.category !== "precondition") continue;
    const probeCase = plan.cases.find(item => item.id === failure.caseId);
    const start = probeCase?.steps[0];
    const click = probeCase?.steps[failure.stepIndex];
    if (!probeCase || start?.op !== "goto" || start.path !== "/" ||
      click?.op !== "click" || click.locator.by !== "role" || click.locator.role !== "link" ||
      !click.locator.name) continue;
    const target = click.locator.name;
    if (!seedDeclarations.some(text => text.includes(`repository \`${target}\``))) continue;
    const ownershipText = seedDeclarations.filter(text => text.includes(`repository \`${target}\``)).join(" ");
    const owners = [...new Set([...ownershipText.matchAll(/\bowner\s+`([^`]+)`/gi)].map(match => match[1]))];
    const snapshot = failure.locatorSnapshot ?? "";
    const scopes = owners.flatMap(owner => visibleObjectScopes(snapshot, target, `${owner}/${target}`));
    if (!click.locator.scope && scopes.length === 1) {
      changes.set(probeCase.id, { index: failure.stepIndex, inserted: 0,
        steps: [{ ...click, locator: { ...click.locator, scope: scopes[0] } }] });
      continue;
    }
    // A visible but ambiguous target needs identity evidence, not another search.
    if (snapshot.includes(`- link "${target}"`) || !/\bsearch(?: result)?\b|repository-list item|direct address/i.test(navigationText) ||
      probeCase.steps.length > 28) continue;
    const searchboxes = [...snapshot.matchAll(/^\s*- searchbox "([^"\n]+)"/gm)];
    if (searchboxes.length !== 1) continue;
    if (probeCase.steps.slice(0, failure.stepIndex).some(step => step.op === "fill" && step.value === target &&
      step.locator.by === "role" && step.locator.role === "searchbox")) continue;
    const locator = { by: "role" as const, role: "searchbox", name: searchboxes[0][1], exact: true };
    changes.set(probeCase.id, { index: failure.stepIndex, inserted: 2, steps: [
      { op: "fill", locator, value: target },
      { op: "press", locator, key: "Enter" },
      click,
    ] });
  }
  if (changes.size === 0) return undefined;
  const alternative = { ...plan, cases: plan.cases.map(item => {
    const change = changes.get(item.id);
    return change ? { ...item,
      ...(item.setupStepCount && change.index < item.setupStepCount ? { setupStepCount: item.setupStepCount + change.inserted } : {}),
      steps: [...item.steps.slice(0, change.index), ...change.steps, ...item.steps.slice(change.index + 1)] } : item;
  }) };
  return parseProbePlan(alternative, packet);
}

function visibleObjectScopes(snapshot: string, target: string, identity: string) {
  const lines = snapshot.split("\n");
  const scopes: Array<{ by: "role"; role: string; hasText: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const container = lines[index].match(/^(\s*)- (listitem|row|article)(?:\s|:|$)/);
    if (!container) continue;
    let end = index + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > container[1].length)) end++;
    const block = lines.slice(index + 1, end).join("\n");
    if (block.includes(`- link "${target}"`) && block.split("\n").some(line =>
      line.trim() === `- paragraph: ${identity}` || line.trim() === `- text: ${identity}`)) {
      scopes.push({ by: "role", role: container[2], hasText: identity });
    }
  }
  return scopes;
}
