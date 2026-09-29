import { describe, expect, it } from "vitest";

import { cellAddress, columnLabel, parseCellAddress } from "../coordinates";
import { formatLastUpdated } from "../format";
import { isCellSelected, selectionBounds, singleCellSelection } from "../selection";

describe("coordinates", () => {
  it("maps column indexes to spreadsheet labels", () => {
    expect(columnLabel(1)).toBe("A");
    expect(columnLabel(26)).toBe("Z");
    expect(columnLabel(27)).toBe("AA");
    expect(cellAddress(2, 3)).toBe("B3");
  });

  it("parses cell addresses and rejects malformed ones", () => {
    expect(parseCellAddress("A1")).toEqual({ column: 1, row: 1 });
    expect(parseCellAddress("ab12")).toEqual({ column: 28, row: 12 });
    expect(parseCellAddress("1A")).toBeNull();
    expect(parseCellAddress("A0")).toBeNull();
    expect(parseCellAddress("")).toBeNull();
  });
});

describe("selection", () => {
  it("marks only the selected rectangular region", () => {
    const bounds = selectionBounds({ anchor: "B2", focus: "C3" });
    expect(isCellSelected(bounds, "B2")).toBe(true);
    expect(isCellSelected(bounds, "C3")).toBe(true);
    expect(isCellSelected(bounds, "B3")).toBe(true);
    expect(isCellSelected(bounds, "A1")).toBe(false);
    expect(isCellSelected(bounds, "D2")).toBe(false);
  });

  it("treats a single cell selection as one cell", () => {
    const bounds = selectionBounds(singleCellSelection("A1"));
    expect(isCellSelected(bounds, "A1")).toBe(true);
    expect(isCellSelected(bounds, "A2")).toBe(false);
  });
});

describe("last updated rendering", () => {
  it("renders a stable value that is identical across pages", () => {
    expect(formatLastUpdated("2026-09-15T08:30:00.000Z")).toBe("2026-09-15 08:30 UTC");
    expect(formatLastUpdated("not-a-date")).toBe("not-a-date");
  });
});
