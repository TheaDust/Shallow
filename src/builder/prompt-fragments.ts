import { loadBuilderPrompt } from "./prompt-assets.js";
import type {
  BuilderPromptInput,
  BuilderShadowObservation,
} from "./prompt-input.js";
import type { ProductKind, WorkPacket } from "../types.js";

export type PromptFragmentId =
  | "accessible_web_controls"
  | "server_persistence"
  | "auth_and_permission"
  | "repository_collaboration"
  | "spreadsheet_grid"
  | "delivery_contract";

const FRAGMENT_ORDER: PromptFragmentId[] = [
  "accessible_web_controls",
  "server_persistence",
  "auth_and_permission",
  "repository_collaboration",
  "spreadsheet_grid",
  "delivery_contract",
];

export const PROMPT_FRAGMENTS: Record<PromptFragmentId, string> = {
  accessible_web_controls: loadBuilderPrompt(
    "fragments",
    "accessible-web-controls",
  ),
  server_persistence: loadBuilderPrompt("fragments", "server-persistence"),
  auth_and_permission: loadBuilderPrompt("fragments", "auth-and-permission"),
  repository_collaboration: loadBuilderPrompt(
    "fragments",
    "repository-collaboration",
  ),
  spreadsheet_grid: loadBuilderPrompt("fragments", "spreadsheet-grid"),
  delivery_contract: loadBuilderPrompt("fragments", "delivery-contract"),
};

const PRODUCT_BASE_FRAGMENTS: Record<ProductKind, PromptFragmentId[]> = {
  repository_collaboration: [
    "accessible_web_controls",
    "server_persistence",
    "auth_and_permission",
    "repository_collaboration",
  ],
  spreadsheet: [
    "accessible_web_controls",
    "server_persistence",
    "spreadsheet_grid",
  ],
  generic_web: ["accessible_web_controls"],
};

const GENERIC_FALLBACK_LEXICON_VERSION = "2026-09-04";

const GENERIC_FALLBACK_LEXICON: Array<{
  fragment: PromptFragmentId;
  keywords: string[];
}> = [
  {
    fragment: "server_persistence",
    keywords: [
      "保存",
      "刷新",
      "重开",
      "切换",
      "历史",
      "同步",
      "save",
      "refresh",
      "reopen",
      "switch",
      "history",
      "sync",
      "persist",
    ],
  },
  {
    fragment: "auth_and_permission",
    keywords: [
      "登录",
      "账号",
      "成员",
      "所有者",
      "角色",
      "私有",
      "权限",
      "login",
      "account",
      "member",
      "owner",
      "role",
      "private",
      "permission",
    ],
  },
  {
    fragment: "repository_collaboration",
    keywords: [
      "仓库",
      "分支",
      "提交",
      "议题",
      "合并请求",
      "repository",
      "branch",
      "commit",
      "issue",
      "merge request",
      "pull request",
    ],
  },
  {
    fragment: "spreadsheet_grid",
    keywords: [
      "工作簿",
      "工作表",
      "单元格",
      "公式",
      "区域",
      "workbook",
      "worksheet",
      "spreadsheet",
      "cell",
      "formula",
      "region",
    ],
  },
];

export function selectPromptFragments(
  request: BuilderPromptInput,
): PromptFragmentId[] {
  if (request.mode === "delivery_repair") {
    return ["delivery_contract"];
  }

  const selected = new Set<PromptFragmentId>(
    PRODUCT_BASE_FRAGMENTS[request.projectContext.product.kind],
  );

  if (request.projectContext.product.kind === "generic_web") {
    for (const fragment of selectGenericFallbackFragments(request.packet)) {
      selected.add(fragment);
    }
  }

  const observation: BuilderShadowObservation | undefined =
    request.mode === "implement" ? undefined : request.shadowObservation;
  if (observation) {
    if (observation.failures.some((failure) => failure.category === "locator")) {
      selected.add("accessible_web_controls");
    }
    if (observation.applicationStartupFailed) {
      selected.add("delivery_contract");
    }
  }

  return FRAGMENT_ORDER.filter((fragment) => selected.has(fragment));
}

function selectGenericFallbackFragments(
  packet: WorkPacket,
): PromptFragmentId[] {
  const haystack = [
    ...packet.requirements.flatMap((requirement) => [
      requirement.name,
      ...requirement.scenarios,
    ]),
  ]
    .join("\n")
    .toLowerCase();

  const selected = new Set<PromptFragmentId>();
  for (const entry of GENERIC_FALLBACK_LEXICON) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      selected.add(entry.fragment);
    }
  }
  return [...selected];
}

export { GENERIC_FALLBACK_LEXICON_VERSION };
