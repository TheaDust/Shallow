import type { ProcessCommand } from "../types.js";
import type { BuilderRequest } from "./port.js";

export function buildBuilderPrompt(request: BuilderRequest): string {
  const { packet, platformContract } = request;
  const requirements = packet.requirements
    .map(
      (requirement) => [
        `## ${requirement.id}: ${requirement.name}`,
        requirement.text,
        `Dependencies already satisfied: ${requirement.dependencyIds.join(", ") || "none"}`,
        `Scenarios:\n${requirement.scenarios.join("\n\n") || "none"}`,
        `References: ${requirement.references.join(", ") || "none"}`,
        `Exact UI strings: ${requirement.exactUiStrings.join(" | ") || "none"}`,
      ].join("\n"),
    )
    .join("\n\n");
  const install = platformContract.installCommands.map(renderCommand).join("\n");
  const build = platformContract.buildCommands.map(renderCommand).join("\n");
  const repair = request.shadowReport
    ? `\nObserved black-box report:\n${JSON.stringify(request.shadowReport, null, 2)}\n`
    : "";
  const rootCause = request.requireRootCauseFirst
    ? "\nBefore changing files, identify and state the root cause before editing. Then make the smallest coherent repair.\n"
    : "";

  return [
    `Implement work packet ${packet.id}, attempt ${packet.attempt}, in ${request.outputDir}.`,
    "You own the target application's technical choices, file changes, and local developer checks.",
    "Keep existing verified behavior working. Implement only the requirements in this packet.",
    requirements,
    "Platform contract:",
    `Base URL: ${platformContract.baseUrl}`,
    `Install commands:\n${install || "none"}`,
    `Build commands:\n${build || "none"}`,
    `Start command: ${renderCommand(platformContract.startCommand)}`,
    `Health path: ${platformContract.healthPath}`,
    repair,
    rootCause,
    "Run the relevant local checks before finishing and summarize the result.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderCommand(command: ProcessCommand): string {
  const prefix = command.cwd === "output" ? [] : ["--prefix", command.cwd];
  return [command.executable, ...prefix, ...command.args].join(" ");
}
