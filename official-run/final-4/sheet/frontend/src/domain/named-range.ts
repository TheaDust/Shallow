/**
 * Named ranges: workbook-scoped names standing for an A1 area of one worksheet.
 *
 * A stored reference keeps its optional `Sheet!` qualifier (`ForecastModel!J3:J5`),
 * so a name stays meaningful in a workbook with several worksheets. The display
 * values of the active worksheet are calculated with every name resolved to the
 * cells of the worksheet it points at, which makes a saved name usable inside a
 * formula (`=SUM(CapacityPlan)`) exactly like a written range.
 */

import type { NamedRange, Workbook, Worksheet } from "./types";

/** Cells of one worksheet, keyed by A1 coordinate. */
export type CellValues = Record<string, string>;

/**
 * One name resolved for a formula: the area it stands for plus the cells that
 * area is read from. The engine compares `cells` with its own map by identity,
 * so a name of the formula's own worksheet costs nothing extra.
 */
export interface NamedRangeBinding {
  name: string;
  /** Top-left A1 coordinate of the bound area. */
  start: string;
  /** Bottom-right A1 coordinate; equal to `start` for a single cell. */
  end: string;
  cells?: CellValues;
}

export interface ParsedNamedRangeReference {
  /** Worksheet name of the qualifier, or `null` for an unqualified reference. */
  sheet: string | null;
  /** Canonical A1 area, for example `J3:J5`. */
  range: string;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const CELL_PATTERN = /^([A-Za-z]+)([1-9][0-9]*)$/;

function toColumn(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

function toLetters(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/**
 * Splits a stored reference into its optional worksheet name and its canonical
 * A1 area, or returns `null` when it is not usable.
 */
export function parseNamedRangeReference(value: string): ParsedNamedRangeReference | null {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const separator = text.indexOf("!");
  let sheet: string | null = null;
  let areaText = text;
  if (separator >= 0) {
    sheet = text.slice(0, separator).trim();
    areaText = text.slice(separator + 1).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'") && sheet.length >= 2) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'").trim();
    }
    if (sheet === "") return null;
  }
  const parts = areaText.replace(/\$/g, "").split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = CELL_PATTERN.exec(parts[0].trim());
  const last = CELL_PATTERN.exec((parts.length === 2 ? parts[1] : parts[0]).trim());
  if (!first || !last) return null;
  const rows = [Number(first[2]), Number(last[2])].sort((a, b) => a - b);
  const columns = [toColumn(first[1]), toColumn(last[1])].sort((a, b) => a - b);
  const range = `${toLetters(columns[0])}${rows[0]}:${toLetters(columns[1])}${rows[1]}`;
  return { sheet, range };
}

/** True when `name` starts with a letter, so the server would store it. */
export function isValidNamedRangeName(name: string): boolean {
  return NAME_PATTERN.test(String(name ?? "").trim());
}

/** Canonical text of a parsed reference (`Sheet!A1:B2` or `A1:B2`). */
export function formatNamedRangeReference(parsed: ParsedNamedRangeReference): string {
  return parsed.sheet ? `${parsed.sheet}!${parsed.range}` : parsed.range;
}

/**
 * Every stored name of `workbook` resolved for formulas of `worksheet`: a name
 * whose qualifier matches another worksheet reads that worksheet's cells, an
 * unqualified one reads the given worksheet. A name whose worksheet no longer
 * exists is left out, so the formula shows its unknown-name error instead of a
 * value of the wrong sheet.
 */
export function namedRangeBindings(
  workbook: Workbook | null,
  worksheet: Worksheet | null,
): NamedRangeBinding[] {
  const ranges: NamedRange[] = workbook?.namedRanges ?? [];
  if (!worksheet) return [];
  const sheets = workbook?.worksheets ?? [worksheet];
  const bindings: NamedRangeBinding[] = [];
  for (const entry of ranges) {
    if (!entry || typeof entry.name !== "string") continue;
    const parsed = parseNamedRangeReference(entry.range);
    if (!parsed) continue;
    const target = parsed.sheet
      ? sheets.find((candidate) => candidate.name.trim().toLowerCase() === parsed.sheet!.trim().toLowerCase())
      : worksheet;
    if (!target) continue;
    const [start, end = start] = parsed.range.split(":");
    bindings.push({ name: entry.name, start, end, cells: target.cells });
  }
  return bindings;
}
