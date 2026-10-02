import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-validations-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file };
}

const SHEET1 = "q3-sales-sheet1";
const SHEET2 = "q3-sales-sheet2";

test("a dropdown rule trims its allowed values and rejects writes outside the list", async () => {
  const { service, file } = await makeService();

  const updated = await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "b2:b3", type: "list", values: [" East ", "North", ""], allowBlank: true }],
  });
  assert.deepEqual(updated.worksheets[0].validations, [
    { range: "B2:B3", type: "list", values: ["East", "North"] },
  ]);

  await assert.rejects(
    () => service.updateCells("q3-sales", SHEET1, { B3: "South" }),
    (error) => error.status === 400
      && error.message === "Please select one of the following values: East, North",
  );
  // The rejected write left every target cell at its previous value.
  assert.equal((await service.get("q3-sales")).worksheets[0].cells.B3, "800");

  const accepted = await service.updateCells("q3-sales", SHEET1, { B3: "North" });
  assert.equal(accepted.worksheets[0].cells.B3, "North");
  // A blank is allowed unless the rule opts out, and other worksheets are free.
  await service.updateCells("q3-sales", SHEET1, { B3: "" });
  await service.updateCells("q3-sales", SHEET2, { A1: "anything" });

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.deepEqual((await reloaded.get("q3-sales")).worksheets[0].validations, updated.worksheets[0].validations);
});

test("a number range rule rejects an out-of-range value and keeps its existing values", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "B2:B3", type: "number-between", min: 0, max: 100, allowBlank: true }],
  });

  await assert.rejects(
    () => service.updateCells("q3-sales", SHEET1, { B3: "101" }),
    (error) => error.status === 400 && error.message === "Please enter a number from 0 to 100",
  );
  // The seeded values were outside the range before the rule existed and stay
  // untouched: only later writes are constrained.
  const stored = await service.get("q3-sales");
  assert.equal(stored.worksheets[0].cells.B2, "1200");
  assert.equal(stored.worksheets[0].cells.B3, "800");

  const inside = await service.updateCells("q3-sales", SHEET1, { B3: "0" });
  assert.equal(inside.worksheets[0].cells.B3, "0");
});

test("one invalid target rejects the complete batch and keeps every target cell", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "A2:A3", type: "list", values: ["East", "North"] }],
  });

  await assert.rejects(
    () => service.updateCells("q3-sales", SHEET1, { A2: "North", A3: "South" }),
    (error) => error.status === 400,
  );
  const stored = await service.get("q3-sales");
  assert.equal(stored.worksheets[0].cells.A2, "East");
  assert.equal(stored.worksheets[0].cells.A3, "North");
});

test("saving an incomplete or unknown rule leaves the stored rules untouched", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "A2:A3", type: "list", values: ["East"] }],
  });

  await assert.rejects(
    () => service.replaceValidations("q3-sales", SHEET1, {
      validations: [{ range: "A2:A3", type: "list", values: ["   "] }],
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.replaceValidations("q3-sales", SHEET1, {
      validations: [{ range: "A2:A3", type: "number-between", min: 0 }],
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.replaceValidations("q3-sales", SHEET1, {
      validations: [{ range: "nonsense", type: "list", values: ["East"] }],
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => service.replaceValidations("nope", SHEET1, { validations: [] }),
    (error) => error.status === 404,
  );

  const stored = await service.get("q3-sales");
  assert.deepEqual(stored.worksheets[0].validations, [{ range: "A2:A3", type: "list", values: ["East"] }]);
});

test("saving an empty rule list removes the constraint and an invalid write succeeds again", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "B2:B3", type: "number-between", min: 0, max: 100 }],
  });

  const cleared = await service.replaceValidations("q3-sales", SHEET1, { validations: [] });
  assert.equal(cleared.worksheets[0].validations, undefined);

  const written = await service.updateCells("q3-sales", SHEET1, { B3: "101" });
  assert.equal(written.worksheets[0].cells.B3, "101");
});

test("row and column changes move the rule ranges with their constrained cells", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "B2:B3", type: "number-between", min: 0, max: 100 }],
  });

  const inserted = await service.changeStructure("q3-sales", SHEET1, "row", {
    action: "insert-below",
    index: 0,
  });
  assert.equal(inserted.worksheets[0].validations[0].range, "B3:B4");

  // The moved rule still rejects a write through the shifted cell.
  await assert.rejects(
    () => service.updateCells("q3-sales", SHEET1, { B4: "101" }),
    (error) => error.message === "Please enter a number from 0 to 100",
  );

  const shrunk = await service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: 3 });
  assert.equal(shrunk.worksheets[0].validations[0].range, "B3:B3");
});

test("deleting the constrained row removes the rule instead of leaving it dangling", async () => {
  const { service } = await makeService();
  await service.replaceValidations("q3-sales", SHEET1, {
    validations: [{ range: "A3:A3", type: "list", values: ["North", "South"] }],
  });

  const deleted = await service.changeStructure("q3-sales", SHEET1, "row", { action: "delete", index: 2 });
  assert.equal(deleted.worksheets[0].validations, undefined);
});
