/**
 * Range sorting for REQ-5-1-1.
 *
 * Sorts a rectangular range of the current worksheet by one of its columns,
 * moving entire records (rows) together inside the rectangle. Numbers,
 * parseable dates, and text are compared according to their respective
 * types; equal sort keys preserve their original relative order (stable
 * sort). The optional header row (first row of the range) never
 * participates. Only cells inside the rectangle are rewritten — data
 * outside stays untouched, so filters and validation rules keep applying to
 * the same coordinates and formula text moves with its row (references stay
 * relative to the moved row, results recompute on the next read).
 */

const NUMBER_PATTERN = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

export function parseCoord(coord) {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(coord);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col: col - 1 };
}

export function cellName(row, columnIndex) {
  let n = columnIndex + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
}

export function columnIndex(letters) {
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

/**
 * Parse a loose date text (ISO, slashed, or dotted) into a UTC timestamp;
 * falls back to the platform date parser. Mirrors the frontend filter date
 * parsing so sorting and the "Before" filter condition agree. Returns null
 * when unparseable.
 */
export function parseDate(value) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dotted = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(trimmed);
  if (dotted) {
    return Date.UTC(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]));
  }
  const american = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(trimmed);
  if (american) {
    return Date.UTC(Number(american[3]), Number(american[1]) - 1, Number(american[2]));
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Sort-key type of a raw cell value. */
function classify(value) {
  if (value === "") return "empty";
  const trimmed = value.trim();
  if (NUMBER_PATTERN.test(trimmed)) return "number";
  if (parseDate(trimmed) !== null) return "date";
  return "text";
}

/** Type priority for mixed columns: numbers, then dates, then text, then empties. */
const TYPE_RANK = { number: 0, date: 1, text: 2, empty: 3 };

function compareText(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Ascending comparison of two sort keys; equal keys return 0 (stable sort). */
export function compareValues(a, b) {
  const typeA = classify(a);
  const typeB = classify(b);
  if (typeA !== typeB) return TYPE_RANK[typeA] - TYPE_RANK[typeB];
  if (typeA === "number") return Number(a) - Number(b);
  if (typeA === "date") return parseDate(a) - parseDate(b);
  if (typeA === "text") return compareText(a, b);
  return 0;
}

/**
 * Sort the cells of a rectangular range by one column. Rows move together
 * within the range; a header row (hasHeader) stays put; empty sort keys
 * always sort last regardless of order. Throws a descriptive Error for an
 * invalid range or a sort column outside the range.
 *
 * @param {Record<string, string>} cells stored cell text (values and
 *   original formulas).
 * @param {{start: string, end: string}} range selection rectangle.
 * @param {string} column sort-column letter, e.g. "B".
 * @param {"ascending"|"descending"} order sort direction.
 * @param {boolean} hasHeader whether the first row of the range is a header.
 * @returns {Record<string, string>} new cells map; the input is untouched.
 */
export function sortRangeCells(cells, range, column, order, hasHeader) {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!from || !to) throw new Error("Invalid sort range");
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  const sortCol = columnIndex(column);
  if (sortCol < colMin || sortCol > colMax) {
    throw new Error("Sort column outside range");
  }
  if (order !== "ascending" && order !== "descending") {
    throw new Error("Invalid sort order");
  }
  const direction = order === "descending" ? -1 : 1;

  // Snapshot the whole rectangle first so an in-place reorder never reads a
  // cell that has already been overwritten.
  const snapshot = new Map();
  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      snapshot.set(`${row}:${col}`, cells[cellName(row, col)] ?? "");
    }
  }

  const firstDataRow = hasHeader ? rowMin + 1 : rowMin;
  const dataRows = [];
  for (let row = firstDataRow; row <= rowMax; row += 1) dataRows.push(row);

  const keyOf = (row) => snapshot.get(`${row}:${sortCol}`) ?? "";
  dataRows.sort((a, b) => {
    const keyA = keyOf(a);
    const keyB = keyOf(b);
    // Blank cells stay at the bottom in both orders (Google Sheets behavior).
    if (keyA === "" && keyB !== "") return 1;
    if (keyB === "" && keyA !== "") return -1;
    const compared = compareValues(keyA, keyB);
    return compared === 0 ? 0 : direction * compared;
  });

  const result = { ...cells };
  // Clear the data rows inside the rectangle, then write them back in the
  // sorted order, skipping empty fields so the store stays clean.
  for (let row = firstDataRow; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      delete result[cellName(row, col)];
    }
  }
  dataRows.forEach((sourceRow, index) => {
    const targetRow = firstDataRow + index;
    for (let col = colMin; col <= colMax; col += 1) {
      const value = snapshot.get(`${sourceRow}:${col}`);
      if (value !== "") result[cellName(targetRow, col)] = value;
    }
  });
  return result;
}
