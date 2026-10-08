import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { withModulePipeline, pass, fail } from "./helpers/module-pipeline.js";

test("a later repair preserves an already-passed shared component sample from another module", async () => {
  await withModulePipeline(async fixture => {
    const tree = JSON.parse(await readFile(fixture.options.requirementsFile, "utf8"));
    tree.name = "Evolution Requirements for an anonymous workspace";
    for (const module of tree.children) for (const requirement of module.children) {
      requirement.description = "The account menu confirms actions in a dialog. Display the main workspace.";
    }
    await writeFile(fixture.options.requirementsFile, JSON.stringify(tree));
    let guardRunsAfterRepair = 0;
    fixture.deps.runner.run = async plan => {
      const component = plan.cases.some(probeCase => probeCase.steps.some(step => step.op === "expectClosedOverlaysEmpty"));
      const ids = plan.cases.flatMap(probeCase => probeCase.requirementIds);
      const repairing = fixture.builder.requests.some(request => request.mode === "repair") && fixture.git.restoredShas.length === 0;
      if (component && ids.includes("B") && repairing) {
        guardRunsAfterRepair += 1;
        const report = fail(plan);
        report.failures[0].stepIndex = plan.cases[0].steps.length - 1;
        report.failures[0].message = "Closed shared dialog still contains stale controls";
        return report;
      }
      if (!component && ids.includes("C") && !repairing) return fail(plan);
      return pass(plan);
    };
    const summary = await fixture.run();
    assert.ok(guardRunsAfterRepair >= 2, "the shared regression is independently reproduced");
    assert.equal(fixture.git.restoredShas.length, 1);
    assert.ok(summary.verifiedRequirementIds.includes("A"));
    assert.ok(summary.verifiedRequirementIds.includes("B"));
    assert.deepEqual(summary.failedRequirementIds, ["C"]);
    assert.equal(summary.status, "partial");
    assert.ok((await fixture.events()).some(event => event.type === "repair_batch_finished" && event.detail?.retained === false));
  });
});
