import type {
  AtomicRequirement,
  PlatformContract,
  ProcessCommand,
  WorkPacket,
} from "../types.js";
import type {
  BuilderPromptInput,
  BuilderProjectContext,
  BuilderShadowObservation,
  DeliveryFailureObservation,
} from "./prompt-input.js";
import {
  PROMPT_FRAGMENTS,
  selectPromptFragments,
  type PromptFragmentId,
} from "./prompt-fragments.js";
import { fillTemplate, loadBuilderPrompt } from "./prompt-assets.js";

export interface CompiledBuilderPrompt {
  systemPrompt: string;
  taskPrompt: string;
  fragmentIds: PromptFragmentId[];
}

const SYSTEM_PROMPT = loadBuilderPrompt("system", "builder-system");

export function buildBuilderSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function compileBuilderPrompt(
  request: BuilderPromptInput,
): CompiledBuilderPrompt {
  return {
    systemPrompt: SYSTEM_PROMPT,
    taskPrompt: buildBuilderTaskPrompt(request),
    fragmentIds: selectPromptFragments(request),
  };
}

export function buildBuilderTaskPrompt(request: BuilderPromptInput): string {
  const receipt = receiptSection();
  switch (request.mode) {
    case "implement": {
      const task = fillTemplate(
        loadBuilderPrompt("system", "task-implement"),
        {
          PACKET_ID: request.packet.id,
          PACKET_ATTEMPT: String(request.packet.attempt),
          OUTPUT_DIR: request.outputDir,
          ACTION: implementAction(),
          PROJECT_CONTEXT: projectContextSection(request.projectContext),
          WORK_PACKET: workPacketSection(request.packet),
          PLATFORM_CONTRACT: platformContractSection(request.platformContract),
          FRAGMENTS: fragmentSection(selectPromptFragments(request)),
        },
      );
      return `${task}\n\n${receipt}`.trim();
    }
    case "repair":
    case "root_cause_repair": {
      const name =
        request.mode === "repair" ? "task-repair" : "task-root-cause-repair";
      const task = fillTemplate(loadBuilderPrompt("system", name), {
        PACKET_ID: request.packet.id,
        PACKET_ATTEMPT: String(request.packet.attempt),
        OUTPUT_DIR: request.outputDir,
        ACTION:
          request.mode === "repair"
            ? repairAction(request.shadowObservation)
            : rootCauseRepairAction(request.shadowObservation),
        PROJECT_CONTEXT: projectContextSection(request.projectContext),
        WORK_PACKET: workPacketSection(request.packet),
        PLATFORM_CONTRACT: platformContractSection(request.platformContract),
        FRAGMENTS: fragmentSection(selectPromptFragments(request)),
      });
      return `${task}\n\n${receipt}`.trim();
    }
    case "delivery_repair": {
      const task = fillTemplate(
        loadBuilderPrompt("system", "task-delivery-repair"),
        {
          OUTPUT_DIR: request.outputDir,
          ACTION: deliveryRepairAction(
            request.deliveryFailure,
            request.platformContract,
          ),
          FRAGMENTS: fragmentSection(selectPromptFragments(request)),
        },
      );
      return `${task}\n\n${receipt}`.trim();
    }
  }
}

function implementAction(): string {
  return loadBuilderPrompt("system", "action-implement");
}

function repairAction(observation: BuilderShadowObservation): string {
  return fillTemplate(loadBuilderPrompt("system", "action-repair"), {
    PASSED_CASE_IDS: observation.passedCaseIds.join("、") || "无",
    FAILURES: renderFailures(observation),
  });
}

function rootCauseRepairAction(observation: BuilderShadowObservation): string {
  return fillTemplate(loadBuilderPrompt("system", "action-root-cause-repair"), {
    PASSED_CASE_IDS: observation.passedCaseIds.join("、") || "无",
    FAILURES: renderFailures(observation),
  });
}

function deliveryRepairAction(
  failure: DeliveryFailureObservation,
  contract: PlatformContract,
): string {
  return fillTemplate(loadBuilderPrompt("system", "action-delivery-repair"), {
    FAILURE_STAGE: failure.stage,
    FAILURE_COMMAND: failure.command ?? "未提供",
    FAILURE_EXPECTED: failure.expected,
    FAILURE_ACTUAL: failure.actual,
    PLATFORM_CONTRACT: platformContractSection(contract),
  });
}

function projectContextSection(context: BuilderProjectContext): string {
  return [
    "## 项目上下文",
    "",
    "产品目标：",
    context.product.description,
    ...(context.product.seedData.length > 0 ? [
      "",
      fillTemplate(loadBuilderPrompt("system", "seed-data"), {
        SEED_DATA: context.product.seedData.map(({ category, items }) =>
          [`### ${category}`, ...items.map((item) => `- ${item}`)].join("\n"),
        ).join("\n\n"),
      }),
    ] : []),
    "",
    "当前功能路径：",
    context.ancestors.length > 0
      ? context.ancestors
          .map(
            (ancestor) =>
              `${ancestor.id} ${ancestor.name}：${ancestor.description}`,
          )
          .join("\n")
      : "无",
    "",
    "已满足的直接依赖：",
    context.satisfiedDependencies.length > 0
      ? context.satisfiedDependencies
          .map(
            (dependency) =>
              `${dependency.id} ${dependency.name}：${dependency.contract}`,
          )
          .join("\n")
      : "无",
    "",
    "这些依赖已经被外部控制器接受。可以复用和兼容它们，但不要重新设计或破坏它们。",
  ].join("\n");
}

function workPacketSection(packet: WorkPacket): string {
  return [
    "## 当前工作包",
    "",
    packet.requirements.map(renderRequirement).join("\n\n"),
  ].join("\n");
}

function renderRequirement(requirement: AtomicRequirement): string {
  return [
    `### ${requirement.id}：${requirement.name}`,
    "",
    `父级路径：${requirement.folderPath.join(" / ")}`,
    "",
    "需求原文：",
    requirement.text,
    "",
    "验收场景：",
    requirement.scenarios.join("\n\n") || "无",
    "",
    "引用资料：",
    requirement.references.join("、") || "无",
    "",
    "必须保持精确的界面文案：",
    requirement.exactUiStrings.join(" | ") || "无",
  ].join("\n");
}

function renderFailures(observation: BuilderShadowObservation): string {
  if (observation.failures.length === 0) return "无";
  return observation.failures
    .map((failure) => {
      const lines = [
        `- 用例 ${failure.caseId}，步骤 ${failure.stepIndex}，类别 ${failure.category}`,
        `  消息：${failure.message}`,
      ];
      if (failure.accessibilityExcerpt) {
        lines.push(`  可访问性节选：${failure.accessibilityExcerpt}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function platformContractSection(contract: PlatformContract): string {
  return fillTemplate(loadBuilderPrompt("system", "platform-contract"), {
    PROBE_PORT: String(contract.port),
    INSTALL_COMMANDS: contract.installCommands.map(renderCommand).join("\n") || "无",
    BUILD_COMMANDS: contract.buildCommands.map(renderCommand).join("\n") || "无",
    START_COMMAND: renderCommand(contract.startCommand),
    HEALTH_PATH: contract.healthPath,
    BASE_URL: contract.baseUrl,
  });
}

function fragmentSection(fragmentIds: PromptFragmentId[]): string {
  return [
    "## 本次适用的实现规则",
    "",
    fragmentIds.map((id) => PROMPT_FRAGMENTS[id]).join("\n\n"),
  ].join("\n");
}

function receiptSection(): string {
  return loadBuilderPrompt("system", "receipt");
}

function renderCommand(command: ProcessCommand): string {
  const prefix = command.cwd === "output" ? [] : ["--prefix", command.cwd];
  return [command.executable, ...prefix, ...command.args].join(" ");
}
