import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  RunStateStore,
  decideAfterReport,
} from "../src/run-state.js";
import type { ShadowReport } from "../src/types.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Decision Loop accepts a passing Shadow report", () => {
  assert.deepEqual(decideAfterReport(report("pass"), 1, false), {
    kind: "accept",
  });
});

test("Decision Loop allows exactly two repairs and makes the second root-cause-first", () => {
  assert.deepEqual(decideAfterReport(report("fail"), 1, false), {
    kind: "repair",
    nextAttempt: 2,
    requireRootCauseFirst: false,
  });
  assert.deepEqual(decideAfterReport(report("fail"), 2, false), {
    kind: "repair",
    nextAttempt: 3,
    requireRootCauseFirst: true,
  });
  assert.deepEqual(decideAfterReport(report("fail"), 3, false), {
    kind: "block_and_restore",
  });
});

test("Decision Loop refines an inconclusive locator only once", () => {
  assert.deepEqual(decideAfterReport(report("inconclusive"), 1, false), {
    kind: "refine_locators",
  });
  assert.deepEqual(decideAfterReport(report("inconclusive"), 1, true), {
    kind: "repair",
    nextAttempt: 2,
    requireRootCauseFirst: false,
  });
});

test("RunState enters delivery at the final 20 percent and never leaves it", () => {
  const state = new RunStateStore({
    statusByRequirementId: { REQ: "todo" },
    acceptedSha: "initial",
    startedAtMs: 1_000,
    totalBudgetMs: 1_000,
  });

  assert.equal(state.shouldEnterDelivery(1_799), false);
  assert.equal(state.shouldEnterDelivery(1_800), true);
  assert.equal(state.shouldEnterDelivery(1_200), true);
  assert.equal(state.snapshot.deliveryMode, true);
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
