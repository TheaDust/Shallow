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
  const changes = new Map<string, { index: number; steps: ProbeStep[]; inserted: number; replaced: number }>();
  for (const failure of report.failures) {
    if (failure.category !== "locator" && failure.category !== "precondition") continue;
    const probeCase = plan.cases.find(item => item.id === failure.caseId);
    const start = probeCase?.steps[0];
    const entry = probeCase?.steps[failure.stepIndex];
    if (!probeCase || start?.op !== "goto" || start.path !== "/" ||
      !entry || (entry.op !== "click" && entry.op !== "expectVisible") ||
      entry.locator.by !== "role" || entry.locator.role !== "link" || !entry.locator.name) continue;
    const target = entry.locator.name;
    if (!seedDeclarations.some(text => text.includes(`repository \`${target}\``))) continue;
    const ownershipText = seedDeclarations.filter(text => text.includes(`repository \`${target}\``)).join(" ");
    const owners = [...new Set([...ownershipText.matchAll(/\bowner\s+`([^`]+)`/gi)].map(match => match[1]))];
    const snapshot = failure.locatorSnapshot ?? "";
    const scopes = owners.flatMap(owner => visibleObjectScopes(snapshot, target, `${owner}/${target}`));
    if (!entry.locator.scope && scopes.length === 1) {
      let begin = failure.stepIndex;
      while (begin > 0 && probeCase.steps[begin - 1].op === "expectVisible" &&
        isRepositoryLink(probeCase.steps[begin - 1], target)) begin--;
      let end = failure.stepIndex + 1;
      if (entry.op === "expectVisible") {
        while (isRepositoryLink(probeCase.steps[end], target)) {
          if (probeCase.steps[end++].op === "click") break;
        }
      }
      changes.set(probeCase.id, { index: begin, inserted: 0, replaced: end - begin,
        steps: probeCase.steps.slice(begin, end).map(step => {
          if (!isRepositoryLink(step, target) || step.locator.scope) return step;
          return { ...step, locator: { ...step.locator, scope: scopes[0],
            ...(step.locator.fallbacks ? { fallbacks: step.locator.fallbacks.map(locator =>
              locator.by === "role" && locator.role === "link" && locator.name === target && !locator.scope
                ? { ...locator, scope: scopes[0] } : locator) } : {}) } };
        }) });
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
    changes.set(probeCase.id, { index: failure.stepIndex, inserted: 2, replaced: 1, steps: [
      { op: "fill", locator, value: target },
      { op: "press", locator, key: "Enter" },
      entry,
    ] });
  }
  if (changes.size === 0) return undefined;
  const alternative = { ...plan, cases: plan.cases.map(item => {
    const change = changes.get(item.id);
    return change ? { ...item,
      ...(item.setupStepCount && change.index < item.setupStepCount ? { setupStepCount: item.setupStepCount + change.inserted } : {}),
      steps: [...item.steps.slice(0, change.index), ...change.steps, ...item.steps.slice(change.index + change.replaced)] } : item;
  }) };
  return parseProbePlan(alternative, packet);
}

function isRepositoryLink(step: ProbeStep | undefined, name: string): step is Extract<ProbeStep, { op: "click" | "expectVisible" }> {
  return Boolean(step && (step.op === "click" || step.op === "expectVisible") &&
    step.locator.by === "role" && step.locator.role === "link" && step.locator.name === name);
}

function visibleObjectScopes(snapshot: string, target: string, identity: string) {
  const lines = snapshot.split("\n");
  const scopes: Array<{ start: number; end: number; scope: { by: "role"; role: string; hasText: string } }> = [];
  for (let index = 0; index < lines.length; index++) {
    const container = lines[index].match(/^(\s*)- (listitem|row|article)(?:\s|:|$)/);
    if (!container) continue;
    let end = index + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > container[1].length)) end++;
    const block = lines.slice(index + 1, end).join("\n");
    if (block.includes(`- link "${target}"`) && block.split("\n").some(line =>
      line.trim() === `- paragraph: ${identity}` || line.trim() === `- text: ${identity}`)) {
      scopes.push({ start: index, end, scope: { by: "role", role: container[2], hasText: identity } });
    }
  }
  // Nested listitem/article containers describe one result. Keep its innermost
  // identity-bearing container; distinct same-identity results remain ambiguous.
  return scopes.filter(outer => !scopes.some(inner => inner.start > outer.start && inner.end <= outer.end))
    .map(item => item.scope);
}
