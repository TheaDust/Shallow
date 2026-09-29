import test from "node:test";
import assert from "node:assert/strict";

import {
  BEFORE,
  FILTER_OPERATOR_LABELS,
  GREATER_THAN,
  IS_EMPTY,
  IS_NOT_EMPTY,
  TEXT_CONTAINS,
  columnMatches,
  filterHiddenRows,
  normalizeFilter,
} from "../src/domain/filtering.mjs";
import {
  checkValidationRule,
  dropdownMessage,
  matchesDropdownValue,
  normalizeValidation,
  numberBetweenMessage,
  numberRangeMessage,
  parseAllowedValues,
} from "../src/domain/validation.mjs";

/** The seeded data region A1:C6 with the three Q3 records. */
const SEED_CELLS = {
  A1: "Region",
  B1: "Sales",
  C1: "Status",
  A2: "East",
  B2: "1200",
  C2: "Open",
  A3: "North",
  B3: "800",
  C3: "Closed",
  A4: "South",
  B4: "700",
  C4: "Open",
};

const SEED_RANGE = { start: "A1", end: "C6" };

test("a filter marks the data rows that fail a value list, keeping the header visible", () => {
  const filter = {
    range: SEED_RANGE,
    columns: { A: { kind: "values", values: ["East", "South"] } },
  };
  // North is not selected, and the two empty rows after the last record match no value.
  assert.deepEqual(filterHiddenRows(filter, SEED_CELLS, SEED_CELLS), [3, 5, 6]);
  // No column entry at all means nothing is hidden.
  assert.deepEqual(filterHiddenRows({ range: SEED_RANGE, columns: {} }, SEED_CELLS, SEED_CELLS), []);
  assert.deepEqual(filterHiddenRows(null, SEED_CELLS, SEED_CELLS), []);
});

test("conditions of different columns are combined with AND", () => {
  const filter = {
    range: SEED_RANGE,
    columns: {
      C: { kind: "condition", operator: TEXT_CONTAINS, value: "open" },
      B: { kind: "condition", operator: GREATER_THAN, value: "1000" },
    },
  };
  // East/1200/Open passes both, the other records fail at least one.
  assert.deepEqual(filterHiddenRows(filter, SEED_CELLS, SEED_CELLS), [3, 4, 5, 6]);
});

test("text, numeric and date conditions use their own comparison", () => {
  assert.equal(columnMatches("North", { operator: TEXT_CONTAINS, value: "nor" }), true);
  assert.equal(columnMatches("East", { operator: TEXT_CONTAINS, value: "nor" }), false);
  assert.equal(columnMatches("", { operator: TEXT_CONTAINS, value: "" }), true);

  assert.equal(columnMatches("1200", { operator: GREATER_THAN, value: "1000" }), true);
  assert.equal(columnMatches("800", { operator: GREATER_THAN, value: "1000" }), false);
  assert.equal(columnMatches("North", { operator: GREATER_THAN, value: "1000" }), false);
  assert.equal(columnMatches("", { operator: GREATER_THAN, value: "1000" }), false);

  assert.equal(columnMatches("2026-08-01", { operator: BEFORE, value: "2026-09-01" }), true);
  assert.equal(columnMatches("2026-10-01", { operator: BEFORE, value: "2026-09-01" }), false);
  assert.equal(columnMatches("", { operator: BEFORE, value: "2026-09-01" }), false);

  assert.equal(columnMatches("  ", { operator: IS_EMPTY, value: "" }), true);
  assert.equal(columnMatches("East", { operator: IS_EMPTY, value: "" }), false);
  assert.equal(columnMatches("East", { operator: IS_NOT_EMPTY, value: "" }), true);
  assert.equal(columnMatches("", { operator: IS_NOT_EMPTY, value: "" }), false);
});

test("the empty rows after the last record are hidden by a value list only", () => {
  const filter = {
    range: SEED_RANGE,
    columns: { A: { kind: "condition", operator: IS_NOT_EMPTY, value: "" } },
  };
  assert.deepEqual(filterHiddenRows(filter, SEED_CELLS, SEED_CELLS), [5, 6]);
});

test("rows outside the filtered region stay visible whatever the condition says", () => {
  const filter = {
    range: { start: "A2", end: "C3" },
    columns: { A: { kind: "values", values: ["East"] } },
  };
  assert.deepEqual(filterHiddenRows(filter, SEED_CELLS, SEED_CELLS), [3]);
});

test("normalizing a filter keeps only usable ranges, columns and entries", () => {
  const accepted = normalizeFilter({
    range: { start: "C6", end: "A1" },
    columns: {
      a: { kind: "values", values: ["East", "East", "South"] },
      b: { kind: "condition", operator: GREATER_THAN, value: " 1000 " },
      c: { kind: "condition", operator: IS_EMPTY, value: "ignored" },
    },
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.filter.range, { start: "A1", end: "C6" });
  assert.deepEqual(accepted.filter.columns.A, { kind: "values", values: ["East", "South"] });
  assert.deepEqual(accepted.filter.columns.B, { kind: "condition", operator: GREATER_THAN, value: "1000" });
  assert.deepEqual(accepted.filter.columns.C, { kind: "condition", operator: IS_EMPTY, value: "" });

  assert.deepEqual(normalizeFilter(null), { ok: true, filter: null });

  const rejected = [
    { range: "nope", columns: {} },
    { range: "A1:C6", columns: { D: { kind: "values", values: ["East"] } } },
    { range: "A1:C6", columns: { A: { kind: "values", values: "East" } } },
    { range: "A1:C6", columns: { A: { kind: "condition", operator: "equals", value: "East" } } },
    { range: "A1:C6", columns: { A: { kind: "condition", operator: TEXT_CONTAINS, value: "  " } } },
    { range: "A1:C6", columns: { A: { kind: "after", value: "East" } } },
  ];
  for (const input of rejected) {
    assert.equal(normalizeFilter(input).ok, false, JSON.stringify(input));
  }
});

test("every condition operator of the filter dialog has its visible name", () => {
  assert.deepEqual(FILTER_OPERATOR_LABELS, {
    [TEXT_CONTAINS]: "Text contains",
    [GREATER_THAN]: "Greater than",
    [BEFORE]: "Before",
    [IS_EMPTY]: "Is empty",
    [IS_NOT_EMPTY]: "Is not empty",
  });
});

test("the \"Allowed values\" text is split on commas and every item is trimmed", () => {
  assert.deepEqual(parseAllowedValues(" East , North ,, South "), ["East", "North", "South"]);
  assert.deepEqual(parseAllowedValues(""), []);
  assert.deepEqual(parseAllowedValues("   ,  "), []);
});

test("a dropdown rule accepts only its allowed values and keeps its prompt", () => {
  const normalized = normalizeValidation({
    range: "A2:A3",
    type: "dropdown",
    values: [" East ", "", "North", "South"],
  });
  assert.equal(normalized.ok, true);
  const rule = normalized.rule;
  assert.deepEqual(rule.values, ["East", "North", "South"]);
  assert.equal(rule.message, "Please select one of the following values: East, North, South");
  assert.equal(dropdownMessage(rule.values), rule.message);

  assert.equal(matchesDropdownValue(rule, "East"), true);
  assert.equal(matchesDropdownValue(rule, " East "), true);
  assert.equal(matchesDropdownValue(rule, "West"), false);

  assert.equal(checkValidationRule(rule, "North"), null);
  assert.equal(checkValidationRule(rule, "West"), rule.message);
  // A blank cell is never a violation, so a rule can be cleared.
  assert.equal(checkValidationRule(rule, "   "), null);

  const invalid = normalizeValidation({ range: "A2:A3", type: "dropdown", values: ["  "] });
  assert.equal(invalid.ok, false);
});

test("numeric rules name their bound and keep a stored message verbatim", () => {
  const defaulted = normalizeValidation({ range: "B1:B3", type: "number-between", min: 0, max: 100 });
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.rule.message, "Please enter a number from 0 to 100");
  assert.equal(numberBetweenMessage(0, 100), defaulted.rule.message);
  assert.equal(numberRangeMessage(0, 100), "Please enter a number between 0 and 100");

  const stored = normalizeValidation({
    range: "B2:B3",
    type: "number-between",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(stored.rule.message, "Please enter a number from 0 to 100");
  assert.equal(checkValidationRule(stored.rule, "101"), "Please enter a number from 0 to 100");
});
