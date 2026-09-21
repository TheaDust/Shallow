import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanRunFormatter } from "../src/human-log.js";

function eventLine(at: string, type: string, rest: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ at, type, ...rest })}\n`;
}

function formatLine(formatter: HumanRunFormatter, raw: string): string {
  const formatted = formatter.format(raw);
  assert.ok(formatted !== null, `expected a formatted line for ${raw.trim()}`);
  return formatted;
}

test("Gateway recovery logs distinguish saved code from completed requirements", () => {
  const formatter = new HumanRunFormatter();
  const at = "2026-09-20T00:00:00Z";
  assert.match(formatLine(formatter, eventLine(at, "gateway_wait", {
    packetId: "a", detail: { source: "builder", retry: 2, delayMs: 60_000, failure: { kind: "rate_limit", retryable: true, status: 429 } },
  })), /网关恢复等待.*a.*builder.*1m.*重试 2/);
  assert.match(formatLine(formatter, eventLine(at, "builder_work_preserved", {
    packetId: "a", detail: { preserved: true, requirementIds: ["A"] },
  })), /保存为可运行检查点.*仍待完成/);
  assert.match(formatLine(formatter, eventLine(at, "implementation_paused", {
    packetId: "a", detail: { requirementIds: ["A"], failure: { kind: "rate_limit", retryable: true, status: 429 } },
  })), /停止派发.*保持待处理/);
});

test("HumanRunFormatter reports candidate reuse, installation and preparation failures", () => {
  const formatter = new HumanRunFormatter();
  const built = formatLine(formatter, eventLine("2026-09-08T00:00:00Z", "candidate_prepared", {
    detail: { candidateId: "candidate-1", reused: false, installed: true, installMs: 2000, buildMs: 3000, durationMs: 5000 },
  }));
  assert.match(built, /候选构建已完成.*candidate-1.*已安装依赖.*安装 2s，构建 3s/);
  const reused = formatLine(formatter, eventLine("2026-09-08T00:00:06Z", "candidate_prepared", {
    detail: { candidateId: "candidate-1", reused: true, installed: false, installMs: 0, buildMs: 0, durationMs: 100 },
  }));
  assert.match(reused, /候选构建已复用.*复用依赖/);
  assert.match(formatLine(formatter, eventLine("2026-09-08T00:00:07Z", "candidate_prepare_failed", {
    detail: { stage: "build", message: "build failed", durationMs: 1000 },
  })), /候选准备失败.*build failed/);
});

test("HumanRunFormatter reports reference image use and text fallback", () => {
  const formatter = new HumanRunFormatter();
  for (const [mode, expected] of [
    ["attached", /发送 2 张参考图片/],
    ["text_fallback", /图片输入不受支持，已回退纯文本/],
    ["unavailable", /参考图片不可用，按文字继续/],
  ] as const) {
    const line = formatLine(formatter, eventLine("2026-09-05T06:00:00.000Z", "builder_reference_images", {
      packetId: "profile", detail: { mode, attachedCount: 2, skipped: [{ reference: "missing.png", reason: "unreadable_image" }] },
    }));
    assert.match(line, expected);
    assert.match(line, /跳过 1 项/);
  }
});

test("HumanRunFormatter distinguishes bounded infrastructure recovery from Builder repair", () => {
  const formatter = new HumanRunFormatter();
  for (const retry of [true, false]) {
    const line = formatLine(formatter, eventLine("2026-09-06T06:00:00.000Z", "execution_fault", {
      packetId: "profile", detail: { source: "browser", code: "browser_disconnected", retry, attempt: 3 },
    }));
    assert.match(line, /browser_disconnected/);
    assert.match(line, retry ? /保持候选和计划/ : /停止当前执行/);
    assert.match(line, /Builder 尝试 3/);
  }
});

test("HumanRunFormatter shows planner validation reasons while keeping response previews in the ledger", () => {
  const formatter = new HumanRunFormatter();
  for (const type of ["probe_planner_retry", "probe_planner_failed", "probe_refinement_failed"]) {
    const line = formatLine(formatter, eventLine("2026-09-06T06:00:00.000Z", type, {
      packetId: "profile", detail: {
        message: "Probe planner content violates ProbePlan", category: "schema",
        validationError: "ProbePlan.cases[0] requires at least one assertion",
        contentPreview: "PRIVATE-PLAN-PREVIEW",
      },
    }));
    assert.match(line, /schema/);
    assert.match(line, /requires at least one assertion/);
    assert.doesNotMatch(line, /PRIVATE-PLAN-PREVIEW/);
  }
});

test("HumanRunFormatter identifies both locator recovery rounds", () => {
  const formatter = new HumanRunFormatter();
  for (const [type, refinementAttempt] of [["probe_refinement_failed", 1], ["probe_refined", 2]] as const) {
    assert.match(formatLine(formatter, eventLine("2026-09-13T00:00:00Z", type, {
      packetId: "p", detail: { refinementAttempt, validationError: "unchanged failed locator" },
    })), new RegExp(`定位恢复第 ${refinementAttempt}/2 轮`));
  }
});

test("HumanRunFormatter renders a happy path in Chinese with elapsed time", () => {
  const formatter = new HumanRunFormatter();
  const lines = [
    eventLine("2026-09-05T06:00:00.000Z", "pipeline_started"),
    eventLine("2026-09-05T06:00:02.000Z", "packet_selected", { packetId: "auth-login" }),
    eventLine("2026-09-05T06:00:03.000Z", "builder_started", { packetId: "auth-login" }),
    eventLine(
      "2026-09-05T06:02:13.000Z",
      "builder_finished",
      { packetId: "auth-login", detail: { outcome: "completed", sessionId: "s1" } },
    ),
    eventLine(
      "2026-09-05T06:02:15.000Z",
      "probe_planned",
      { packetId: "auth-login", detail: { cases: 3 } },
    ),
    eventLine(
      "2026-09-05T06:02:30.000Z",
      "probe_finished",
      { packetId: "auth-login", detail: { verdict: "pass" } },
    ),
    eventLine("2026-09-05T06:02:31.000Z", "packet_accepted", { packetId: "auth-login" }),
    eventLine("2026-09-05T06:03:00.000Z", "pipeline_finished"),
  ];

  assert.match(formatLine(formatter, lines[0]), /^\[\d{2}:\d{2}:\d{2} \+0s\] 流水线启动$/);
  assert.match(formatLine(formatter, lines[1]), /^\[\d{2}:\d{2}:\d{2} \+2s\] 选定需求包 auth-login$/);
  assert.match(
    formatLine(formatter, lines[2]),
    /^\[\d{2}:\d{2}:\d{2} \+3s\] Builder 开始编写代码（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[3]),
    /^\[\d{2}:\d{2}:\d{2} \+2m13s\] Builder 完成（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[4]),
    /^\[\d{2}:\d{2}:\d{2} \+2m15s\] 已生成 3 个探针用例（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[5]),
    /^\[\d{2}:\d{2}:\d{2} \+2m30s\] 探针通过（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[6]),
    /^\[\d{2}:\d{2}:\d{2} \+2m31s\] 需求包验收通过（auth-login）$/,
  );
  assert.match(formatLine(formatter, lines[7]), /^\[\d{2}:\d{2}:\d{2} \+3m0s\] 流水线结束$/);
});

test("HumanRunFormatter renders feature grouping stats at pipeline start", () => {
  const formatter = new HumanRunFormatter();
  const line = formatLine(formatter, eventLine("2026-09-16T00:00:00.000Z", "pipeline_started", {
    detail: { requirements: 24, totalBudgetMs: 0, port: 43210,
      grouping: { packets: 6, requirements: 24, maxPacketSize: 5, crossModulePackets: 0, cohesionRate: 0.347, thresholdLimitedPackets: 0 } },
  }));
  assert.match(line, /流水线启动；原子需求 24；预算 不限时；探针端口 43210；功能组 6$/);
});

test("HumanRunFormatter surfaces failure reasons and refined reruns", () => {
  const formatter = new HumanRunFormatter();
  const lines = [
    eventLine("2026-09-05T06:00:00.000Z", "pipeline_started"),
    eventLine(
      "2026-09-05T06:01:00.000Z",
      "application_start_failed",
      { packetId: "auth-login", detail: { message: "npm start exited 1: missing script" } },
    ),
    eventLine(
      "2026-09-05T06:02:00.000Z",
      "builder_finished",
      { packetId: "auth-login", detail: { outcome: "timed_out", sessionId: "s2" } },
    ),
    eventLine(
      "2026-09-05T06:03:00.000Z",
      "probe_finished",
      { packetId: "auth-login", detail: { verdict: "inconclusive", refined: true } },
    ),
    eventLine(
      "2026-09-05T06:05:00.000Z",
      "delivery_repair_started",
      { detail: { stage: "readiness", message: "/health unreachable" } },
    ),
    eventLine(
      "2026-09-05T06:06:00.000Z",
      "delivery_finished",
      { detail: { ok: false, stage: "readiness", message: "/health unreachable" } },
    ),
  ];

  assert.match(formatLine(formatter, lines[0]), /^\[\d{2}:\d{2}:\d{2} \+0s\] 流水线启动$/);
  assert.match(
    formatLine(formatter, lines[1]),
    /^\[\d{2}:\d{2}:\d{2} \+1m0s\] 应用启动失败（auth-login）：npm start exited 1: missing script$/,
  );
  assert.match(
    formatLine(formatter, lines[2]),
    /^\[\d{2}:\d{2}:\d{2} \+2m0s\] Builder 超时（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[3]),
    /^\[\d{2}:\d{2}:\d{2} \+3m0s\] 探针无法定论（精化后重跑）（auth-login）$/,
  );
  assert.match(
    formatLine(formatter, lines[4]),
    /^\[\d{2}:\d{2}:\d{2} \+5m0s\] 最终验收未通过（readiness），启动交付修复：\/health unreachable$/,
  );
  assert.match(
    formatLine(formatter, lines[5]),
    /^\[\d{2}:\d{2}:\d{2} \+6m0s\] 交付失败（readiness）：\/health unreachable$/,
  );
});

test("HumanRunFormatter breaks Builder time into model and tool and reports tokens", () => {
  const formatter = new HumanRunFormatter();
  const detailed = formatLine(formatter, eventLine("2026-09-17T00:00:00.000Z", "builder_finished", {
    packetId: "p",
    detail: {
      outcome: "completed",
      durationMs: 1_471_000,
      execution: {
        toolCalls: 29,
        usage: { status: "available", input: 1000, output: 200, cacheRead: 300, cacheWrite: 0, total: 1500 },
        timing: { turns: 12, modelMsTotal: 1_082_000, toolMsTotal: 389_000,
          longestTools: [{ name: "shell", durationMs: 130_000 }, { name: "read", durationMs: 63_000 }] },
      },
    },
  }));
  assert.match(detailed, /耗时分布 模型 18m2s \/ 工具 6m29s/);
  assert.match(detailed, /轮次 12/);
  assert.match(detailed, /工具调用 29（最慢 shell 2m10s、read 1m3s）/);
  assert.match(detailed, /tokens 入 1000 \/ 出 200 \/ 缓存读 300 \/ 总计 1500/);
  assert.match(detailed, /本阶段耗时 24m31s/);

  const partial = formatLine(formatter, eventLine("2026-09-17T00:00:01.000Z", "builder_finished", {
    packetId: "p", detail: { outcome: "failed", execution: { usage: { status: "unavailable" } } },
  }));
  assert.match(partial, /Builder 失败（p）$/);
});

test("HumanRunFormatter ignores garbage lines and unknown event types", () => {
  const formatter = new HumanRunFormatter();
  assert.equal(formatter.format("not json\n"), null);
  assert.equal(formatter.format("\n"), null);
  assert.equal(formatter.format('{"at":"2026-09-05T06:00:00.000Z"}\n'), null);
  assert.equal(
    formatter.format(
      eventLine("2026-09-05T06:00:00.000Z", "something_new", { packetId: "x" }),
    ),
    null,
  );
});

test("HumanRunFormatter covers remaining planner, refinement, and delivery events", () => {
  const formatter = new HumanRunFormatter();
  const base = "2026-09-05T06:00:00.000Z";
  assert.match(
    formatLine(
      formatter,
      eventLine(base, "probe_planner_retry", {
        packetId: "p",
        detail: { message: "gateway 500" },
      }),
    ),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 探针规划失败，将重试（p）：gateway 500$/,
  );
  assert.match(
    formatLine(formatter, eventLine(base, "probe_planner_failed", { packetId: "p" })),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 探针规划失败（p）$/,
  );
  assert.match(
    formatLine(formatter, eventLine(base, "probe_refined", { packetId: "p" })),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 定位器已精化，重跑探针（p）$/,
  );
  assert.match(
    formatLine(
      formatter,
      eventLine(base, "probe_refinement_failed", {
        packetId: "p",
        detail: { message: "schema drift" },
      }),
    ),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 定位器精化失败（p）：schema drift$/,
  );
  assert.match(
    formatLine(formatter, eventLine(base, "delivery_started")),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 进入交付窗口，开始最终验收$/,
  );
  assert.match(
    formatLine(formatter, eventLine(base, "delivery_repair_accepted")),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 交付修复验收通过$/,
  );
  assert.match(
    formatLine(
      formatter,
      eventLine(base, "delivery_finished", { detail: { ok: true, stage: "browser" } }),
    ),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] 交付完成（browser）$/,
  );
  assert.match(
    formatLine(
      formatter,
      eventLine(base, "builder_finished", { packetId: "p", detail: { sessionId: "s" } }),
    ),
    /^\[\d{2}:\d{2}:\d{2} \+0s\] Builder 结束（p）$/,
  );
});


test("Human logs report rescued modules in Chinese", () => {
  const formatter = new HumanRunFormatter();
  assert.match(formatLine(formatter, eventLine("2026-09-15T00:00:00Z", "module_rescued", {
    packetId: "packet-a", detail: { requirementIds: ["A", "B"], reason: "timed_out" },
  })), /Builder 未完成回执，但写出的应用可运行，已保存为可运行版本.*A、B.*timed_out/);
});

test("Human logs explain the bounded implementation retry", () => {
  assert.match(formatLine(new HumanRunFormatter(), eventLine("2026-09-21T00:00:00Z", "implementation_retry", {
    packetId: "packet-a", detail: { requirementIds: ["A"], timeoutMs: 2_700_000 },
  })), /新会话续做原需求包.*仅重试一次.*45m/);
});

test("Human logs distinguish runnable checkpoints, unknown audits, and retained repairs", () => {
  const formatter = new HumanRunFormatter();
  const checkpoint = formatLine(formatter, eventLine("2026-09-13T00:00:00Z", "checkpoint_saved", {
    acceptedSha: "runnable-sha", detail: { requirementIds: ["A"], reason: "module-a" },
  }));
  assert.match(checkpoint, /可运行检查点.*功能验收状态单独记录/);
  assert.doesNotMatch(checkpoint, /验收通过/);
  assert.match(formatLine(formatter, eventLine("2026-09-13T00:00:01Z", "audit_result", {
    packetId: "packet-a", detail: { requirementIds: ["A"], status: "inconclusive", reason: "invalid plan" },
  })), /无法判断.*保留可运行检查点/);
  assert.match(formatLine(formatter, eventLine("2026-09-13T00:00:02Z", "repair_batch_finished", {
    detail: { round: 1, retained: false, reason: "regression" },
  })), /已恢复原检查点.*regression/);
});
