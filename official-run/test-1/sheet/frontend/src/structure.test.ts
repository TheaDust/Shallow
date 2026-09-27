import { describe, expect, it } from "vitest";
import {
  ROW_ACTIONS,
  shiftRowNumber,
  shiftCells,
  adjustCellRefs,
  shiftCoordinateRow,
} from "./structure";
import {
  COLUMN_ACTIONS,
  shiftColumnNumber,
  shiftColumnLabel,
  shiftCellsColumn,
  adjustCellRefsColumn,
  shiftCoordinateColumn,
} from "./structure";

describe("row structure helpers (REQ-2-2-1)", () => {
  it("lists the supported row operations", () => {
    expect(ROW_ACTIONS).toEqual(["insert-above", "insert-below", "delete"]);
  });

  it("shiftRowNumber moves rows for insert-above / insert-below / delete", () => {
    expect(shiftRowNumber(2, "insert-above", 2)).toBe(3);
    expect(shiftRowNumber(1, "insert-above", 2)).toBe(1);
    expect(shiftRowNumber(5, "insert-above", 2)).toBe(6);
    expect(shiftRowNumber(2, "insert-below", 2)).toBe(2);
    expect(shiftRowNumber(3, "insert-below", 2)).toBe(4);
    expect(shiftRowNumber(3, "delete", 2)).toBe(2);
    expect(shiftRowNumber(2, "delete", 2)).toBe("#REF!");
  });

  it("shiftCells shifts the seeded grid rows together on insertion", () => {
    const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
    expect(shiftCells(cells, "insert-above", 2)).toEqual({
      cells: { A1: "Region", A3: "East", B3: "1200", A4: "North", B4: "800" },
      maxRow: 4,
    });
    expect(shiftCells(cells, "insert-below", 2)).toEqual({
      cells: { A1: "Region", A2: "East", B2: "1200", A4: "North", B4: "800" },
      maxRow: 4,
    });
  });

  it("shiftCells removes the deleted row and shifts later rows up", () => {
    const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
    expect(shiftCells(cells, "delete", 2)).toEqual({
      cells: { A1: "Region", A2: "North", B2: "800" },
      maxRow: 2,
    });
  });

  it("adjustCellRefs adjusts formula references and marks deleted-row references #REF!", () => {
    expect(adjustCellRefs("=B2+C3", "insert-above", 2)).toBe("=B3+C4");
    expect(adjustCellRefs("=SUM(B2:C3)", "insert-above", 2)).toBe("=SUM(B3:C4)");
    expect(adjustCellRefs("=B2+C3", "insert-below", 2)).toBe("=B2+C4");
    expect(adjustCellRefs("=A1+B2", "delete", 1)).toBe("=#REF!+B1");
    expect(adjustCellRefs("=A2", "delete", 1)).toBe("=A1");
  });

  it("shiftCells adjusts formula text in shifted cells", () => {
    const cells = { A1: "=B2", A2: "=SUM(B2:C3)", B1: "5" };
    const above = shiftCells(cells, "insert-above", 2);
    expect(above.cells.A1).toBe("=B3");
    expect(above.cells.A3).toBe("=SUM(B3:C4)");
    expect(above.cells.B1).toBe("5");
    expect(shiftCells({ A2: "=A1", B1: "x" }, "delete", 1)).toEqual({
      cells: { A1: "=#REF!" },
      maxRow: 1,
    });
  });

  it("shiftCoordinateRow moves coordinates with the row shift", () => {
    expect(shiftCoordinateRow("A2", "insert-above", 2)).toBe("A3");
    expect(shiftCoordinateRow("A1", "insert-above", 2)).toBe("A1");
    expect(shiftCoordinateRow("A3", "insert-below", 2)).toBe("A4");
    expect(shiftCoordinateRow("A3", "delete", 2)).toBe("A2");
    expect(shiftCoordinateRow("A2", "delete", 2)).toBe("A2");
  });
});

describe("column structure helpers (REQ-2-2-2)", () => {
  it("lists the supported column operations", () => {
    expect(COLUMN_ACTIONS).toEqual(["insert-left", "insert-right", "delete"]);
  });

  it("shiftColumnNumber moves columns for insert-left / insert-right / delete", () => {
    expect(shiftColumnNumber(2, "insert-left", 2)).toBe(3);
    expect(shiftColumnNumber(1, "insert-left", 2)).toBe(1);
    expect(shiftColumnNumber(5, "insert-left", 2)).toBe(6);
    expect(shiftColumnNumber(2, "insert-right", 2)).toBe(2);
    expect(shiftColumnNumber(3, "insert-right", 2)).toBe(4);
    expect(shiftColumnNumber(3, "delete", 2)).toBe(2);
    expect(shiftColumnNumber(2, "delete", 2)).toBe("#REF!");
  });

  it("shiftColumnLabel maps labels across the shift", () => {
    expect(shiftColumnLabel("B", "insert-left", 2)).toBe("C");
    expect(shiftColumnLabel("A", "insert-left", 2)).toBe("A");
    expect(shiftColumnLabel("C", "insert-right", 2)).toBe("D");
    expect(shiftColumnLabel("C", "delete", 2)).toBe("B");
    expect(shiftColumnLabel("B", "delete", 2)).toBe("#REF!");
    expect(shiftColumnLabel("Z", "insert-left", 2)).toBe("AA");
  });

  it("shiftCellsColumn shifts the seeded grid columns on insertion", () => {
    const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
    // insert left of B: column A stays put, B and later columns move right
    expect(shiftCellsColumn(cells, "insert-left", 2)).toEqual({
      cells: { A1: "Region", A2: "East", C2: "1200", A3: "North", C3: "800" },
      maxCol: 3,
    });
    // insert right of B: columns after B move right (no data there yet)
    expect(shiftCellsColumn(cells, "insert-right", 2)).toEqual({
      cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
      maxCol: 2,
    });
  });

  it("shiftCellsColumn removes the deleted column and shifts later columns left", () => {
    const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
    // deleting column B removes 1200/800 (they lived in column B)
    expect(shiftCellsColumn(cells, "delete", 2)).toEqual({
      cells: { A1: "Region", A2: "East", A3: "North" },
      maxCol: 1,
    });
    // data in a later column shifts left into the deleted column's place
    expect(shiftCellsColumn({ A1: "x", C1: "y" }, "delete", 2)).toEqual({
      cells: { A1: "x", B1: "y" },
      maxCol: 2,
    });
    // deleting column A removes the label column as well
    expect(shiftCellsColumn(cells, "delete", 1)).toEqual({
      cells: { A2: "1200", A3: "800" },
      maxCol: 1,
    });
  });

  it("adjustCellRefsColumn adjusts formula references and marks deleted-column references #REF!", () => {
    expect(adjustCellRefsColumn("=B2+C3", "insert-left", 2)).toBe("=C2+D3");
    expect(adjustCellRefsColumn("=SUM(B2:C3)", "insert-left", 2)).toBe("=SUM(C2:D3)");
    expect(adjustCellRefsColumn("=B2+C3", "insert-right", 2)).toBe("=B2+D3");
    expect(adjustCellRefsColumn("=A1+B2", "delete", 1)).toBe("=#REF!+A2");
    expect(adjustCellRefsColumn("=B2", "delete", 1)).toBe("=A2");
  });

  it("shiftCellsColumn adjusts formula text in shifted cells", () => {
    const cells = { A1: "=B2", B2: "=SUM(B2:C3)", C1: "5" };
    const left = shiftCellsColumn(cells, "insert-left", 2);
    expect(left.cells.A1).toBe("=C2");
    expect(left.cells.C2).toBe("=SUM(C2:D3)");
    expect(left.cells.D1).toBe("5");
    expect(shiftCellsColumn({ B2: "=A1", A1: "x" }, "delete", 1)).toEqual({
      cells: { A2: "=#REF!" },
      maxCol: 1,
    });
  });

  it("shiftCoordinateColumn moves coordinates with the column shift", () => {
    expect(shiftCoordinateColumn("B2", "insert-left", 2)).toBe("C2");
    expect(shiftCoordinateColumn("A1", "insert-left", 2)).toBe("A1");
    expect(shiftCoordinateColumn("C3", "insert-right", 2)).toBe("D3");
    expect(shiftCoordinateColumn("C3", "delete", 2)).toBe("B3");
    expect(shiftCoordinateColumn("B2", "delete", 2)).toBe("B2");
  });
});
