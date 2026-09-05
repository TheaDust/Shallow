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
      "2026-09-05T06:04:00.000Z",
      "packet_blocked",
      { packetId: "auth-login", detail: { reason: "shadow attempts exhausted" } },
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
    /^\[\d{2}:\d{2}:\d{2} \+4m0s\] 需求包已阻塞并回滚（auth-login）：shadow attempts exhausted$/,
  );
  assert.match(
    formatLine(formatter, lines[5]),
    /^\[\d{2}:\d{2}:\d{2} \+5m0s\] 最终验收未通过（readiness），启动交付修复：\/health unreachable$/,
  );
  assert.match(
    formatLine(formatter, lines[6]),
    /^\[\d{2}:\d{2}:\d{2} \+6m0s\] 交付失败（readiness）：\/health unreachable$/,
  );
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
