import type { ShadowReport, WorkPacket } from "../types.js";
import { parseProbePlan, type ProbePlan, type ProbeStep } from "./probe-schema.js";

/** A seed link guessed at / may be reachable through the page's visible search. */
export function rootSearchNavigationPlan(packet: WorkPacket, plan: ProbePlan, report: ShadowReport): ProbePlan | undefined {
  if (report.verdict !== "inconclusive" || report.failures.length === 0) return undefined;
  const evidence = [...packet.requirements, ...(packet.prerequisites ?? [])];
  // Search must be an allowed entry path in the requirement context, not an
  // invented substitute for a specifically required home-page link.
  if (!evidence.some(requirement => /search result|repository-list item|direct address/i
    .test([requirement.text, ...requirement.scenarios].join(" ")))) return undefined;
  const seedDeclarations = evidence
    .flatMap(requirement => requirement.seedDeclarations);
  const changes = new Map<string, ProbeStep[]>();
  for (const failure of report.failures) {
    if (failure.category !== "locator" || failure.stepIndex !== 1) return undefined;
    const probeCase = plan.cases.find(item => item.id === failure.caseId);
    const [start, click] = probeCase?.steps ?? [];
    if (!probeCase || probeCase.steps.length > 28 || start?.op !== "goto" || start.path !== "/" ||
      click?.op !== "click" || click.locator.by !== "role" || click.locator.role !== "link" ||
      !click.locator.name) return undefined;
    const target = click.locator.name;
    if (!seedDeclarations.some(text => text.includes(`repository \`${target}\``))) return undefined;
    const searchboxes = [...(failure.locatorSnapshot ?? "").matchAll(/^\s*- searchbox "([^"\n]+)"/gm)];
    if (searchboxes.length !== 1) return undefined;
    const locator = { by: "role" as const, role: "searchbox", name: searchboxes[0][1], exact: true };
    changes.set(probeCase.id, [
      { op: "fill", locator, value: target },
      { op: "press", locator, key: "Enter" },
    ]);
  }
  const alternative = { ...plan, cases: plan.cases.map(item => {
    const inserted = changes.get(item.id);
    return inserted ? { ...item, steps: [item.steps[0], ...inserted, ...item.steps.slice(1)] } : item;
  }) };
  return parseProbePlan(alternative, packet);
}
