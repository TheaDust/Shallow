export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

export class CsvFormatError extends Error {
  constructor(message = INVALID_CSV_MESSAGE) {
    super(message);
    this.name = "CsvFormatError";
  }
}

/**
 * Parses CSV text into rows of raw field text.
 *
 * Rules: fields are separated by commas, records by CRLF/LF/CR, empty fields are preserved,
 * double quotes are escaped by doubling them, and line breaks inside a quoted field are kept.
 * A field that opens with a double quote and never closes it is invalid CSV.
 */
export function parseCsv(source) {
  if (typeof source !== "string") throw new CsvFormatError();
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

  const rows = [];
  let row = [];
  let field = "";
  // "start" -> field not started, "plain" -> unquoted field, "quoted" -> inside quotes, "quotedEnd" -> quote just closed
  let state = "start";
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
    state = "start";
  };

  while (index < text.length) {
    const character = text[index];

    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        state = "quotedEnd";
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === "\n" || character === "\r") {
      const step = character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      endField();
      rows.push(row);
      row = [];
      index += step;
      continue;
    }

    if (character === ",") {
      endField();
      index += 1;
      continue;
    }

    if (character === '"' && state === "start") {
      state = "quoted";
      index += 1;
      continue;
    }

    if (state === "quotedEnd") throw new CsvFormatError();

    state = "plain";
    field += character;
    index += 1;
  }

  if (state === "quoted") throw new CsvFormatError();
  if (state === "quotedEnd" || field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows;
}
