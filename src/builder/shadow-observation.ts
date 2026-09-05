import type { ShadowReport } from "../types.js";
import type { BuilderShadowObservation } from "./prompt-input.js";

const FREE_TEXT_LIMIT = 1_500;

export function toBuilderShadowObservation(
  report: ShadowReport,
): BuilderShadowObservation {
  return {
    packetId: report.packetId,
    passedCaseIds: [...report.passedCases],
    failures: report.failures.map((failure) => ({
      caseId: failure.caseId,
      stepIndex: failure.stepIndex,
      category: failure.category,
      message: sanitizeObservationText(failure.message),
      ...(failure.locatorSnapshot
        ? {
            accessibilityExcerpt: sanitizeObservationText(
              failure.locatorSnapshot,
            ),
          }
        : {}),
    })),
    applicationStartupFailed: report.failures.some(
      (failure) => failure.caseId === "<application>",
    ),
  };
}

function sanitizeObservationText(text: string): string {
  const normalized = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  return normalized.length <= FREE_TEXT_LIMIT
    ? normalized
    : normalized.slice(0, FREE_TEXT_LIMIT);
}
