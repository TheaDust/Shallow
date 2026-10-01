import { cellCoordinate, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Message of the numeric-range validation rule (0-to-100) that rejects a paste. It is the value
 * the UI must display verbatim when such a rule refuses the operation. The validation rules
 * themselves live in `validation.mjs`, which every write path shares.
 */
export { NUMBER_RANGE_MESSAGE } from "./validation.mjs";

/**
 * Splits clipboard text into rows of fields: `\t` separates the columns of one row, `\r\n`/`\n`/`\r`
 * separate rows. A single trailing line break (the one a copy usually appends) does not create an
 * extra empty row. Empty fields are kept as empty strings so the target rectangle can be overwritten
 * completely.
 */
export function parsePastedText(text) {
  if (typeof text !== "string") return [];
  let normalised = text;
  if (normalised.endsWith("\r\n")) normalised = normalised.slice(0, -2);
  else if (normalised.endsWith("\n") || normalised.endsWith("\r")) normalised = normalised.slice(0, -1);
  if (normalised === "") return [];
  return normalised.split(/\r\n|\n|\r/).map((line) => line.split("\t"));
}

/**
 * Coordinates and raw values of the rectangle the parsed rows occupy when they start at `start`.
 * Row `n`/column `m` of the pasted table targets the cell offset by `n` rows and `m` columns.
 */
export function pastedRectangle(rows, start) {
  const position = parseCellCoordinate(start);
  if (!position) return [];
  const updates = [];
  rows.forEach((row, rowOffset) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, columnOffset) => {
      updates.push({
        coordinate: cellCoordinate(position.row + rowOffset, position.column + columnOffset),
        value: typeof value === "string" ? value : "",
      });
    });
  });
  return updates;
}

/** Size the pasted rectangle needs, so the sheet can grow instead of dropping values. */
export function pastedRectangleBounds(rows, start) {
  const position = parseCellCoordinate(start);
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (!position || !rows.length || !width) return null;
  return { rows: position.row + rows.length, columns: position.column + width };
}

