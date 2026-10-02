# Architecture

Online spreadsheet (Google-Sheets-like): workbooks, worksheets, editing, formulas, sort/filter, pivots.

## Entry points

- `frontend/` React + Vite + TypeScript (hand-written hash routing); `backend/` zero-dependency Node
  HTTP: `/health` + `/api/health`, `/api/**` JSON API, static files from `frontend/dist` (resolved from
  the server file location). Listens on `PORT` (default 3000) plus `backend/src/platform-ports.json`
  ports unless `ARC_EXTRA_PORTS=0`; one `http.createServer` per port, all interfaces; unknown paths → 404.
- Persistence: `backend/src/store.mjs` reads `SHALLOW_DATA_DIR` (default `backend/data`), one atomic JSON
  file `workbooks.json` via `lib/json-store.mjs`; the frontend uses same-origin relative API paths.

## Frontend routes (`src/App.tsx`, hash routing)

- `#/` → `pages/WorkbookHomePage.tsx`; `#/workbooks/new` → `pages/NewWorkbookPage.tsx`;
  `#/workbooks/<workbookId>` → `pages/WorkbookEditorPage.tsx` (refreshable); else a page-not-found view.

## Shared interfaces

Workbook (`backend/src/domain/workbooks.mjs`, mirrored by `frontend/src/domain/workbook.ts`):
`{ id, name, createdAt, updatedAt, activeSheetId, sheets: [{ id, name, cells, selection?, rowCount?,
columnCount?, validations?, filter?, pivot? }] }`. `cells` is keyed by uppercased A1 and holds the **raw
submitted text** (`=A1+B1` for a formula) - what the formula bar shows and the store persists. `values`
(displayed text) and `hiddenRows` (1-based rows the filter hides) are derived by `serializeWorkbook` on
  every response and never stored, so reads always recompute results from the stored state.

Formula engine (`domain/formula.mjs`): numbers, `+ - * /`, parentheses, unary signs, A1 and same-sheet
range refs, case-insensitive `SUM`/`AVERAGE`/`COUNT`/`MIN`/`MAX`; aggregates skip blanks and text
(`COUNT` counts numeric cells), text in arithmetic is `#ERROR!`. Stable errors: `#DIV/0!`, `#REF!`
(outside the grid, `A0`, `=#REF!`, a cycle), `#NAME?`, `#ERROR!`; an error
propagates to dependents without blocking other cells. `domain/reference.mjs`: copying
(`translateFormulaText`) moves relative parts and keeps `$`; a structure change
(`adjustFormulaTextForStructure`) moves refs at or beyond the insertion point (`$` too) and turns a
reference to a deleted row/column into `#REF!`. Helpers: `domain/address.mjs` (`columnName`,
`cellAddress`, `parseAddress`); `domain/worksheets.mjs` (`nextWorksheetName` = first unused `SheetN`,
`isWorksheetNameTaken`, `isPivotSource`, `adjacentWorksheetId`, contract strings `Worksheet name cannot
be empty` / `Worksheet name already exists` / `A workbook must contain at least one worksheet` /
`Please delete or rebuild dependent pivot tables first`).

## HTTP JSON API (`backend/src/api.mjs`), error strings are contract text

- `GET /api/workbooks` → `{ workbooks: [{ id, name, updatedAt }] }`; `POST /api/workbooks` `{ name? }` →
  201 `{ workbook }` (blank `Sheet1` active; blank name → `Untitled spreadsheet`); `GET /api/workbooks/:id`
  → `{ workbook }` | 404; `PATCH /api/workbooks/:id` `{ name?, activeSheetId? }` → `{ workbook }`
  (blank name → 400 `Workbook name cannot be empty`; unknown sheet → 400).
- `POST /api/workbooks/import` `{ fileName, content }` → 201: `domain/csv.mjs` parses `content` into
  `Sheet1` (active), name = file name minus its final `.csv`; unparsable → 400
  `Invalid CSV file format. Import failed.`, nothing written. `POST .../sheets` → 201 (blank worksheet
  named after the first unused `SheetN`, activated); `PATCH .../sheets/:sheetId` `{ name?, selection? }`
  (name trimmed, unique per workbook case-insensitively; the view-only `selection` leaves `updatedAt`
  alone; no supported field → rejected); `DELETE .../sheets/:sheetId` removes the worksheet with its
  whole state, refused (400, unchanged) for the last remaining worksheet
  (`A workbook must contain at least one worksheet`) or while a pivot table still reads the target
  (`Please delete or rebuild dependent pivot tables first`); an adjacent worksheet becomes active.
- `POST .../sheets/:sheetId/rows` `{ action: "insert-above" | "insert-below" | "delete", row }` and
  `.../columns` (`insert-left` / `insert-right` / `delete`, 1-based) → 200 `{ workbook }`;
  `domain/structure.mjs` moves the cell map, every formula and every range-bearing entity (validation
  rules, filter view) in one pass inside one serialized `store.update`, so a rejected request changes
  nothing (400 `Invalid row number` / `Invalid column number` / `Unknown row operation` /
  `Unknown column operation`). Insertion grows `rowCount`/`columnCount`; a pivot's source range shifts
  (`shiftRangeForStructure`) while its stored summary waits for the explicit refresh.- `PUT .../sheets/:sheetId/cells/:address` `{ value }` → 200 `{ workbook }`; `domain/cells.mjs` rejects an
  invalid address, a non-string value and a validation violation (`Invalid cell address`,
  `Invalid cell value`), so grid and formula bar keep the last successful content.
- `POST …/paste` `{ start, text }` (`domain/paste.mjs`, tab-separated columns / newline-separated rows)
  and `POST .../range-transfer` `{ source, target, mode: "copy" | "cut" }`
  (`domain/range-transfer.mjs`) read the source once, validate every destination, then write all targets
  (a cut removes the source) - or nothing changes; copied formulas go through `translateFormulaText` and
  the target becomes the stored selection. Any invalid target rejects everything
  (`The pasted range does not fit in the worksheet`, `Invalid cell address` or the rule message).
- `PUT .../sheets/:sheetId/state` `{ cells, rowCount?, columnCount?, validations? }` →
  `domain/worksheet-state.mjs#replaceWorksheetState` normalizes and bounds-checks a whole worksheet state
  (absent field = keep, `null` = reset) and clamps the stored selection; undo/redo restores through it.
- `PUT .../sheets/:sheetId/validations` `{ validations: [...] }` replaces the whole rule list in one
  atomic write. `PUT .../filter` `{ filter: null | { range, columns } }` uses
  `domain/filter.mjs#normalizeFilter` (400 `Invalid filter`). View state (`selection`, `filter`) leaves
  `updatedAt` alone; data changes bump it.
- `POST .../sheets/:sheetId/sort` `{ range, column, order, hasHeader }` (`domain/sort.mjs`, `rangeBounds`
  in `domain/address.mjs`) sorts the data rows of the selected rectangle by one of its columns: records
  move whole, a moved formula keeps its own row, blanks stay last, equal keys keep their order (stable).
  Rejections (`Invalid sort range`/`column`/`order`) change nothing; filter and validation ranges are kept.
- `POST /api/workbooks/:id/pivots` `{ sourceSheetId, sourceRange }` → 201 `{ workbook, worksheet }` (a
  worksheet named after the first unused `PivotN`, activated, no summary yet);
  `PUT .../sheets/:sheetId/pivot` `{ rowField, columnField, valueField, method }` and
  `POST .../sheets/:sheetId/pivot/refresh` recompute and store the configuration with its summary, and
  refuse (400, contract message) without changing either worksheet.
Validation rules (`domain/validation.mjs`): `{ id, range, type: "number-range" | "dropdown", min?, max?,
values?, message? }`. Defaults: `Please enter a number between <min> and <max>`, or
`Please enter a number from <min> to <max>` for the 0-to-100 boundary rule; dropdown
`Please select one of the following values: <v1, v2>`; a rule's own `message` wins, blank values pass, and
the same check guards a cell write, a paste and a range move, so an invalid bulk target changes nothing.

Filter views (`domain/filter.mjs`): `{ range, columns: [{ column, mode: "values", values } | { column,
mode: "condition", condition: "text-contains" | "greater-than" | "before" | "is-empty" |
"is-not-empty", value }] }`; the first row of `range` is the header row that never hides, columns are
combined with AND, and only visibility changes (`hiddenRows`).
Pivot tables (`domain/pivot.mjs` + `frontend/src/domain/pivot.ts`): a pivot-result worksheet stores
`pivot: { sourceSheetId, sourceRange, rowField, columnField, valueField, method }` and the summary it last
computed as its own `cells`, so the source worksheet is only read. Fields are the header texts of the
source range's first row (deleted header → `Pivot field is no longer available. Select a new field.`);
`SUM`/`AVERAGE` need one parseable number (`Value field requires numeric values`) while `COUNT` counts
non-empty value-field records and never refuses. Row groups and column values keep first-appearance order
and the last row/column is `Grand Total`. CSV helpers: `domain/csv.mjs` (`parseCsv`, `cellsFromRows`,
`workbookNameFromFileName`) and `domain/csv.ts` (`worksheetUsedRange`, `formatCsvField`, `worksheetToCsv`,
`csvFileName`); export keeps hidden rows.

Frontend domain (modules under `frontend/src/domain/`): `clipboard.ts` (copied/cut rectangle, TSV text,
paste target), `history.ts` (undo/redo over `WorksheetSnapshot` = `{ sheetId, cells, rowCount?,
columnCount?, validations }`), `spreadsheet.ts` (grid geometry, `SHEET_COLUMN_COUNT = 26`,
`SHEET_ROW_COUNT = 50`, `selectionBounds`, `isCellSelected`, `shiftAddress`), `filter.ts`, `validation.ts`
(rule coverage, contract messages, `selectionRangeText`), `pivot.ts` (field options, `computePivotCells`)
and `sort.ts` (mirrored type-aware compare, `Sort by` option labels, `looksLikeHeaderRow`);
`frontend/src/api/workbooks.ts` wraps every call with explicit types; UI primitives come from `src/ui/`;
`pages/WorkbookEditorPage.tsx` keeps the editor state, delegates the data commands to
`pages/use-data-tools.ts`, and the editor pieces live in `src/components/`.

## ARIA contract implemented for the editor

- Worksheet tabs (`components/WorksheetTabs.tsx`): `role="tablist"` (`aria-label="Worksheets"`) holds the
  `Add worksheet` button plus, per worksheet, an ARIA tab (`aria-selected` on the active one, arrow/Home/
  End keys) and an options button `Worksheet options for <worksheet name>` opening a `role="menu"` of
  `menuitem` buttons (`Rename`, `Delete`). Dialogs: `Rename worksheet` (`Worksheet name` text box,
  `Cancel`, `Save`) and `Delete worksheet` (names the target in its text, `Cancel` + `Delete worksheet`);
  a refused delete closes the dialog and shows its message beside the tab bar. A tab switch restores that
  worksheet's selection (confirmed rectangles are mirrored onto their own worksheet locally), so grid,
  row/column counts, formula bar, filter buttons, validation entry points and pivot results follow the
  active tab; reopening restores `activeSheetId` and every stored selection.
- Grid: `role="grid"` named `Worksheet grid`, `aria-multiselectable="true"`, arrow-key navigation; cells
  are `role="gridcell"` named by A1 with `aria-selected` true exactly inside the current rectangle, a
  filtered-out row keeps its cells but carries `hidden`; headers are `rowheader`/`columnheader`.
- Context menus (`components/HeaderContextMenu.tsx`): `role="menu"` named `Row <n> options` /
  `Column <letter> options` / `Cell <coordinate> options` with `menuitem` buttons `Insert 1 row
  above`/`below`, `Delete row`, `Insert 1 column left`/`right`, `Delete column`, `Copy`, `Cut`, `Paste`;
  commands stay `disabled` in flight and a failure shows a `role="alert"`.
- `Formula bar` (input inside the active `role="tabpanel"`) shows the raw text of the selected cell (the
  original formula for formula cells); Enter or blur commits, Escape cancels, a rejected commit shows a
  `role="alert"` while grid, bar and dependent results keep the last successful state. Grid editing uses an
  inline text box `Edit <cell coordinate>`; a finished drag selects and saves its rectangle per worksheet.
- Toolbar (`components/EditorToolbar.tsx`, `role="toolbar"`, `aria-label="Workbook toolbar"`): `Undo`,
  `Redo`, `Copy`, `Cut`, `Paste`, `Export CSV`, then the `Data` menu (`components/DataMenu.tsx`, trigger
  `Data` with `aria-haspopup="menu"`, `menuitem`s `Sort range`, `Create filter`, `Clear filter`,
  `Data validation`, `Create pivot table`). Commands keep their DOM node and become `disabled` in flight;
  `Undo`/`Redo` also while their history is empty.
- `Sort range` dialog (`components/SortRangeDialog.tsx`): the combo boxes `Sort by` (one option per
  column of the selected rectangle, named after its header text) and `Order` (`Ascending` / `Descending`),
  the checkbox `Data has header row` (pre-checked when the first row is text) and `Sort`; a refusal keeps
  the grid order and shows a `role="alert"` inside the dialog.
- Filter view: `Create filter` covers the used region of the active worksheet; every header cell of that
  region carries a button `Filter <header text>`, whose dialog offers checkboxes named after the distinct
  source values, `Clear selection`, a `Condition` combo box (`None`, `Text contains`, `Greater than`,
  `Before`, `Is empty`, `Is not empty`), a `Value` text box (disabled for the two empty conditions) and
  `Apply`; checking every value of a column removes that constraint and `Clear filter` shows every row.
- Data validation: the `Data validation` dialog has a `Rule type` combo box (`Dropdown` / `Number range`),
  a text box `Allowed values` or `Minimum`/`Maximum`, and `Save`; reopening the exact rectangle prefills
  the stored rule and offers `Delete rule`, a failure showing a `role="alert"` with the dialog open. A
  dropdown cell renders `Open dropdown for <cell coordinate>` opening a `role="listbox"`
  (`Options for <coordinate>`) of `role="option"` entries named after the trimmed values.
- Pivot table editor (`components/PivotTableEditor.tsx`): the active pivot-result worksheet renders a
  region named `Pivot table editor` with the combo boxes `Rows`, `Columns` (plus `None`), `Values` and
  `Summarize by` (`SUM`/`COUNT`/`AVERAGE`, options = source header texts), plus `Apply` and
  `Refresh pivot table`; a refused apply/refresh shows a `role="alert"` and keeps the last summary.
  `Create pivot table` opens the dialog `Create pivot table` (visible `Source range: <cell range>`,
  `New worksheet` radio, `Create`).
- Range paste: one request applies the whole transfer; a refusal shows the server message in the cell
  `role="alert"`, and Ctrl+V moves the copied range when the browser offers that same text or none.
  Undo/redo restore the snapshot each successful edit, paste, move or structure change replaced.
- CSV: home-page button `Import CSV` opens the dialog `Import CSV` (file input `CSV file`, submit
  `Confirm import`); parse failures show an alert beside the file control and the dialog stays open.

## Seed data

`backend/src/domain/workbooks.mjs#createSeedState` seeds one workbook (written on the first read of an
empty store, then persisted; user edits survive restarts):

- workbook id `wb-q3-sales`, name `Q3 Sales`, `updatedAt` `2026-03-14T09:32:00.000Z`.
- `Sheet1` (`wb-q3-sales-sheet-1`, active): the data region `A1:C4` shared by the editing, structure,
  filter, validation and pivot requirements: headers `A1 Region`/`B1 Sales`/`C1 Status` with the rows
  `A2 East B2 1200 C2 Open`, `A3 North B3 800 C3 Closed`, `A4 South B4 700 C4 Open`.
- `Sheet2` (`wb-q3-sales-sheet-2`): the formula sample `A1 = 2`, `B1 = 3`, `C1 = =A1+B1` (result 5),
  `D1 = =C1*2` (result 10) - the "other worksheet". The seed ships no filter, no validation rule and no
  pivot worksheet; `D1:E2` stays empty as the usual target of the entry, paste and range-transfer
  scenarios.

Conflicting family seeds are reached through public operations, never parallel records: REQ-3-2-1's
`A1:B2` = `Item/Qty` / `Pen/4`; a persisted 0-to-100 rule comes from the `Data validation` dialog
(`Minimum` 0, `Maximum` 100 → `Please enter a number from 0 to 100`); `Pivot1` from `Create pivot table`.

## Testing

- `backend/test/*.test.mjs` (node:test) spin a real HTTP server on an ephemeral port with a per-test temp
  `SHALLOW_DATA_DIR`; `frontend/src/**/*.test.tsx?` (Vitest + Testing Library, jsdom) cover the editor
  pages and domain modules. `frontend/src/test/fake-workbook-api.ts` is the shared in-memory API
  stand-in; its `recalculated`, `translateFormula`, `adjustFormulaForStructure`, `hiddenRowsOf`,
  `compareSortKeys` and `computePivotCells` mirror only the flows under test. jsdom lacks
  `Blob/File.text` and `URL.createObjectURL`, so use `lib/file-io.ts` helpers and stub it.
