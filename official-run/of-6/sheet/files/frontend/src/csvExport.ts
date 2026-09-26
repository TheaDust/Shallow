import type { Sheet } from './types';
import { coordinateToCell } from './gridUtils';
import { evaluateFormula, formatFormulaValue } from './formula';

// CSV serialization for exporting the current active worksheet.
// - Iterates the grid's actual row and column structure (rowCount x
//   columnCount), preserving empty cells as empty fields in order.
// - Fields containing commas, double quotes or line breaks are quoted with
//   internal double quotes escaped as "".
// - Ordinary cells export their stored text; formula cells (values starting
//   with '=') export their calculated result instead of the expression.

export function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export function cellExportValue(raw: string, sheet: Sheet): string {
  if (raw.startsWith('=')) {
    try {
      return formatFormulaValue(evaluateFormula(raw, sheet.cells));
    } catch {
      return raw;
    }
  }
  return raw;
}

export function sheetToCsv(sheet: Sheet): string {
  const lines: string[] = [];
  for (let row = 0; row < sheet.rowCount; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column < sheet.columnCount; column += 1) {
      const coord = coordinateToCell(row, column);
      const raw = sheet.cells[coord] ?? '';
      fields.push(escapeCsvField(cellExportValue(raw, sheet)));
    }
    lines.push(fields.join(','));
  }
  return lines.join('\n');
}
