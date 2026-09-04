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
    `Base URL for local verification: ${platformContract.baseUrl}`,
    `The backend HTTP server must read the PORT environment variable for its listen port (default ${platformContract.port}).`,
    "The frontend must call the backend through relative same-origin paths; never hardcode a host or port in the built frontend.",
    `Install commands:\n${install || "none"}`,
    `Build commands:\n${build || "none"}`,
    `Start command: ${renderCommand(platformContract.startCommand)}`,
    `Health path: ${platformContract.healthPath}`,
    "UI contract:",
    'Every scoring-critical input uses type="text".',
    "Every input field has a visible <label> element associated with it.",
    "Validation errors are rendered as text by JavaScript; never rely on HTML5 required or pattern attributes.",
    "Action controls are <button> elements with visible plain text.",
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
