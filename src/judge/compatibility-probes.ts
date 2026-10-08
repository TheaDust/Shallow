import type { WorkPacket } from "../types.js";
import type { ProbeCase, ProbePlan, ProbeStep } from "./probe-schema.js";
import { declaredGlobalSearchControls, isHomeEntryStep, requirementEvidenceTexts } from "./probe-schema.js";

/**
 * Build non-verifying compatibility samples from an already grounded business
 * plan. They may expose a repairable candidate defect, but the pipeline keeps
 * their result outside the requirement verification map.
 */
export function overlayLifecyclePlan(packet: WorkPacket, businessPlan: ProbePlan | undefined): ProbePlan | undefined {
  if (!businessPlan || !packet.requirements.some(item => item.product.evolution)) return undefined;
  const evidence = requirementEvidenceTexts(packet.requirements, packet.prerequisites).join(" ");
  if (!/\b(?:dialog|menu|popover|modal)\b/i.test(evidence)) return undefined;
  // Only inspect a lifecycle that the grounded business plan actually opens
  // and safely closes. Merely seeing an unrelated hidden menu elsewhere in the
  // application must not create a compatibility failure.
  const lifecycle = businessPlan.cases.map(overlayReopenCase).find((value): value is ProbeCase => value !== undefined);
  return lifecycle ? { packetId: packet.id, cases: [lifecycle] } : undefined;
}

/** Replays an already-grounded home search after reaching a real nested state. */
export function globalControlCrossRoutePlan(
  packet: WorkPacket,
  businessPlan: ProbePlan | undefined,
  sources: readonly { packet: WorkPacket; plan: ProbePlan }[],
): ProbePlan | undefined {
  if (!businessPlan || !packet.requirements.some(item => item.product.evolution)) return undefined;
  const prefix = nestedPrefix(businessPlan.cases);
  if (!prefix) return undefined;
  const sequence = sources.flatMap(source => {
    const controls = declaredGlobalSearchControls(source.packet);
    if (controls.length !== 1) return [];
    return source.plan.cases.map(probeCase => globalSearchSequence(probeCase, controls[0].name));
  }).find((value): value is ProbeStep[] => value !== undefined);
  if (!sequence) return undefined;
  const source = preferredCase(businessPlan.cases)!;
  return { packetId: packet.id, cases: [{
    id: `compat-global-cross-route-${source.id}`,
    requirementIds: source.requirementIds,
    purpose: "happy_path",
    expectationBasis: source.expectationBasis,
    setupStepCount: prefix.length,
    steps: [...structuredClone(prefix), ...structuredClone(sequence)],
  }] };
}

function nestedPrefix(cases: readonly ProbeCase[]): ProbeStep[] | undefined {
  for (const probeCase of cases) {
    const setupCount = probeCase.setupStepCount ?? 0;
    if (setupCount > 1 && probeCase.steps[setupCount - 1]?.op.startsWith("expect") &&
      probeCase.steps.slice(0, setupCount).some(step => step.op === "click")) {
      return probeCase.steps.slice(0, setupCount);
    }
    let acted = false;
    for (let index = 0; index < probeCase.steps.length; index += 1) {
      const step = probeCase.steps[index];
      if (["click", "doubleClick", "rightClick"].includes(step.op)) acted = true;
      if (acted && step.op.startsWith("expect") && index > 1 && index < 15) return probeCase.steps.slice(0, index + 1);
    }
  }
  return undefined;
}

function overlayReopenCase(probeCase: ProbeCase): ProbeCase | undefined {
  const dialogIndex = probeCase.steps.findIndex(step => step.op === "expectVisible" &&
    step.locator.by === "role" && ["dialog", "alertdialog", "menu"].includes(step.locator.role));
  if (dialogIndex < 1) return undefined;
  let openerIndex = -1;
  for (let index = dialogIndex - 1; index >= 0; index -= 1) {
    if (probeCase.steps[index].op === "click") { openerIndex = index; break; }
  }
  if (openerIndex < 0) return undefined;
  const closeOffset = probeCase.steps.slice(dialogIndex + 1).findIndex(step =>
    step.op === "click" && /\b(?:cancel|close|dismiss)\b/i.test(locatorStepName(step) ?? "") ||
    step.op === "press" && step.key === "Escape");
  if (closeOffset < 0) return undefined;
  const closeIndex = dialogIndex + 1 + closeOffset;
  const setupCount = Math.min(probeCase.setupStepCount ?? openerIndex, openerIndex);
  const setup = setupCount > 0 ? probeCase.steps.slice(0, setupCount) : [];
  if (setupCount > 0 && setup.at(-1)?.op !== "goto" && !setup.at(-1)?.op.startsWith("expect")) return undefined;
  const action = probeCase.steps.slice(Math.max(setupCount, openerIndex), closeIndex + 1);
  const opener = probeCase.steps[openerIndex];
  const dialog = probeCase.steps[dialogIndex];
  if (opener.op !== "click" || dialog.op !== "expectVisible" || setup.length > 15 || action.length + 3 > 30) return undefined;
  return {
    id: `compat-overlay-reopen-${probeCase.id}`,
    requirementIds: probeCase.requirementIds,
    purpose: "happy_path",
    expectationBasis: probeCase.expectationBasis,
    ...(setupCount ? { setupStepCount: setupCount } : {}),
    steps: [...structuredClone(setup), ...structuredClone(action), { op: "expectClosedOverlaysEmpty" },
      structuredClone(opener), structuredClone(dialog)],
  };
}

function locatorStepName(step: ProbeStep): string | undefined {
  if (!("locator" in step)) return undefined;
  return step.locator.by === "role" ? step.locator.name : step.locator.text;
}

function globalSearchSequence(probeCase: ProbeCase, name: string): ProbeStep[] | undefined {
  const sameControl = (step: ProbeStep): boolean => "locator" in step && step.locator.by === "role" &&
    ["search", "searchbox"].includes(step.locator.role) && step.locator.name === name &&
    step.locator.scope?.by === "role" && step.locator.scope.role === "banner";
  const start = probeCase.steps.findIndex(step => step.op === "fill" && sameControl(step));
  if (start < 0 || !isHomeEntryStep(probeCase, start)) return undefined;
  const endOffset = probeCase.steps.slice(start + 1).findIndex(step => step.op === "expectVisible" &&
    step.locator.by === "role" && step.locator.role === "link" && step.locator.exact === true);
  if (endOffset < 0) return undefined;
  const end = start + 1 + endOffset;
  const sequence = probeCase.steps.slice(start, end + 1);
  return sequence.some(step => step.op === "press" && sameControl(step) && step.key === "Enter") ? sequence : undefined;
}

function preferredCase(cases: readonly ProbeCase[]): ProbeCase | undefined {
  return cases.find(item => item.purpose === "happy_path") ??
    cases.find(item => item.purpose === "persistence") ?? cases[0];
}
