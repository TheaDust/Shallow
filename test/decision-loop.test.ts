import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  RunStateStore,
  decideAfterReport,
  sanitizeDiagnosticText,
} from "../src/run-state.js";
import type { ShadowReport } from "../src/types.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Decision Loop accepts a passing Shadow report", () => {
  assert.deepEqual(decideAfterReport(report("pass"), 1), {
    kind: "accept",
  });
});

test("Decision Loop allows exactly two repairs and makes the second root-cause-first", () => {
  assert.deepEqual(decideAfterReport(report("fail"), 1), {
    kind: "repair",
    nextAttempt: 2,
    requireRootCauseFirst: false,
  });
  assert.deepEqual(decideAfterReport(report("fail"), 2), {
    kind: "repair",
    nextAttempt: 3,
    requireRootCauseFirst: true,
  });
  assert.deepEqual(decideAfterReport(report("fail"), 3), {
    kind: "block_and_restore",
  });
});

test("Decision Loop routes inconclusive verdicts through the bounded repair ladder", () => {
  assert.deepEqual(decideAfterReport(report("inconclusive"), 1), {
    kind: "repair",
    nextAttempt: 2,
    requireRootCauseFirst: false,
  });
  assert.deepEqual(decideAfterReport(report("inconclusive"), 2), {
    kind: "repair",
    nextAttempt: 3,
    requireRootCauseFirst: true,
  });
  assert.deepEqual(decideAfterReport(report("inconclusive"), 3), {
    kind: "block_and_restore",
  });
});

test("RunState enters delivery only when the budget is exhausted and never leaves it", () => {
  const state = new RunStateStore({
    statusByRequirementId: { REQ: "todo" },
    acceptedSha: "initial",
    startedAtMs: 1_000,
    totalBudgetMs: 1_000,
  });

  assert.equal(state.shouldEnterDelivery(1_799), false);
  assert.equal(state.shouldEnterDelivery(1_999), false);
  assert.equal(state.shouldEnterDelivery(2_000), true);
  assert.equal(state.shouldEnterDelivery(1_500), true);
  assert.equal(state.snapshot.deliveryMode, true);
});

test("RunState never enters delivery by time when the budget is unlimited", () => {
  const state = new RunStateStore({
    statusByRequirementId: { REQ: "todo" },
    acceptedSha: "initial",
    startedAtMs: 1_000,
    totalBudgetMs: 0,
  });

  assert.equal(state.shouldEnterDelivery(1_001_000), false);
  assert.equal(state.snapshot.deliveryMode, false);
});

test("RunState records global transitions and writes a redacted JSONL ledger", async () => {
  await withTempDir("shallow-ledger-", async (directory) => {
    const ledgerFile = join(directory, "run-ledger.jsonl");
    const state = new RunStateStore(
      {
        statusByRequirementId: { REQ: "todo" },
        acceptedSha: "initial",
        startedAtMs: 0,
        totalBudgetMs: 10_000,
      },
      ledgerFile,
    );

    state.markRequirements(["REQ"], "verified");
    state.setAcceptedSha("accepted");
    state.setPacketAttempt("packet-req", 2);
    await state.record({
      at: "2026-09-04T00:00:00.000Z",
      type: "accepted",
      packetId: "packet-req",
      detail: {
        apiKey: "secret-value",
        message: "x".repeat(3_000),
      },
    });

    assert.equal(state.snapshot.statusByRequirementId.REQ, "verified");
    assert.equal(state.snapshot.acceptedSha, "accepted");
    assert.equal(state.snapshot.attemptsByPacketId["packet-req"], 2);
    const ledger = await readFile(ledgerFile, "utf8");
    assert.doesNotMatch(ledger, /secret-value/);
    assert.match(ledger, /\[redacted\]/);
    assert.ok(ledger.length < 2_500);
  });
});

test("RunState keeps decisions intact when diagnostic sinks fail", async () => {
  await withTempDir("shallow-ledger-", async (directory) => {
    const blocker = join(directory, "blocker.txt");
    await writeFile(blocker, "not a directory");
    const blockedLedgerPath = join(blocker, "run-ledger.jsonl");
    const store = new RunStateStore(
      {
        statusByRequirementId: { REQ: "todo" },
        acceptedSha: "initial",
        startedAtMs: 0,
        totalBudgetMs: 10_000,
      },
      blockedLedgerPath,
      {
        write() {
          throw new Error("log unavailable");
        },
      },
    );

    await assert.doesNotReject(
      store.record({ at: "2026-09-04T00:00:00.000Z", type: "builder_finished" }),
    );
    assert.equal(store.snapshot.ledger.length, 1);
  });
});

test("Diagnostic text is sanitized and capped for logs", () => {
  assert.equal(sanitizeDiagnosticText("结果\u0000：完成"), "结果 ：完成");
  assert.equal(sanitizeDiagnosticText("x".repeat(2_000)).length, 1_500);
});

function report(verdict: ShadowReport["verdict"]): ShadowReport {
  return {
    packetId: "packet-req",
    verdict,
    passedCases: verdict === "pass" ? ["case"] : [],
    failures:
      verdict === "pass"
        ? []
        : [
            {
              caseId: "case",
              stepIndex: 1,
              category: verdict === "inconclusive" ? "locator" : "assertion",
              message: "failure",
            },
          ],
  };
}
