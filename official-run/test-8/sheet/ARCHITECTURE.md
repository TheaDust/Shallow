# Architecture

React + Vite + TypeScript frontend (`frontend/`) and a zero-dependency Node HTTP backend
(`backend/`) serving `frontend/dist` plus the JSON workbook API.

## Entry points

- `backend/src/app.mjs` — `createApp({ dataDir })` builds the handler and store (health, `/api/*`,
  static files); `server.mjs` binds `PORT` plus `platform-ports.json` (skipped when `ARC_EXTRA_PORTS=0`).
- `backend/src/api/workbooks.mjs` — `createWorkbookApi(store)`: all workbook/worksheet routes (shapes
  in the source); grid writes are `.../worksheets/:id/{structure,cells,transfer,sort}`, `.../undo|redo`
  and `.../pivots` (pivot `create`/`apply`/`refresh`); mutations return `history: {canUndo, canRedo}`.
- `backend/src/domain/transfer.mjs` — `transferRange(worksheet, source, target, mode)` plans a whole
  range move; `lib/history.mjs` — `createHistory()`.
- `backend/src/domain/formula.mjs` — `shiftFormula`/`shiftFormulaByOffset`/`mapFormulaRows`; `csv.mjs` —
  RFC 4180 import parser; `lib/workbook-store.mjs` — JSON store under `SHALLOW_DATA_DIR` whose every
  read/write passes `normalizeState`.
- `backend/src/domain/validation.mjs` — `validateCellWrites`, rule save/delete helpers and messages;
  twin `domain/validation.ts` adds `dropdownValuesForCell`/`ruleCoveringBounds`.
- `backend/src/domain/filter.mjs` — row-filter shape (`{range, columns}`, kinds `values`/`condition`),
  `validateFilterPayload`, `normalizeFilter`; twin `domain/filter.ts` derives the view.
- `backend/src/domain/sort.mjs` — `sortRangeRecords(worksheet, {range, col, order, hasHeaderRow})`;
  twin `domain/sort.ts` adds `sortColumnOptions` (the `Sort by` options) and `SORT_ORDER_OPTIONS`.
- `backend/src/domain/structure.mjs` — `applyStructureOperation(worksheet, operation, index)` re-keys
  cells, shifts formulas and moves `validations`/`filter` immutably; `workbook-model.mjs` — `seedState`,
  `createWorksheet`, `normalizeState`, `removeWorksheet`.
- `backend/src/domain/pivot.mjs` — `computePivot(worksheet, pivot)` derives the result cell map (SUM/
  COUNT/AVERAGE, Grand Total layout, header-text lookup); twin `frontend/src/domain/pivot.ts` adds
  `pivotFieldOptions`, `rangeLabel` and the option constants.
- `frontend/src/App.tsx` — hash router (`/`, `/workbooks/new`, `/workbooks/:id`); `domain/formula.ts`
  (`evaluateCells`) maps raw text to displayed text; twins `domain/references.ts` (`mapFormulaRows`)
  and `domain/paste.ts`.
- `frontend/src/pages/WorkbookEditorPage.tsx` — editor page: the cell draft shared by grid and formula
  bar (`CellEditState.source`), the Data menu, the range clipboard (Copy/Cut/Paste) and the
  `pendingSelection` overlay.
- `frontend/src/features/editor/` — `useWorkbookSession.ts` (one promise queue plus the `history`
  flags) and the grid/dialog components: `WorksheetGrid.tsx` (ARIA grid, menus, filter/dropdown
  buttons), `FormulaBar.tsx`, `WorksheetTabs.tsx`, the dialogs, `DropdownOptions.tsx`.

## Key constraints

- The store is the single authority: the frontend sends renames, tab switches, selections, cell writes,
  filters, rules, sorts and pivots through `workbooks-api.ts` and replaces its copy with the returned
  aggregate; a failed write keeps the last successful value plus an alert message.
- Empty storage is seeded from `seedState()`: `Q3 Sales` with the shared `Region/Sales/Status` table
  and a blank `Sheet2`; every success rewrites atomically and later packages may only add compatible
  seed objects.
- Dialog and API validate names identically (trim, non-empty, unique per workbook); rejections answer
  422 without touching the store, and `Add worksheet` uses `nextWorksheetName`.
- Worksheet data is independent per worksheet: a tab switch or reload only changes the grid's source.
  Editor URL is `#/workbooks/<workbookId>`, so refresh/direct-open restores the workbook; only `/`
  serves `index.html` and unknown paths stay 404 (CSV import parses server-side).
- Worksheet deletion is `DELETE .../worksheets/:id` (tab menu `Delete` → `DeleteWorksheetDialog`,
  `removeWorksheet`): it drops the pivots whose result sheet it holds, and answers 422 without touching
  the store for the last worksheet (`A workbook must contain at least one worksheet`) or a pivot
  source (`Please delete or rebuild dependent pivot tables first`).
- Grid contract: `role="grid"` `aria-label="Worksheet grid"` `aria-multiselectable="true"`; cells are
  `role="gridcell"` named by A1; tabs are `role="tab"`. Only `selection.anchor`/`focus` are stored, so
  a refresh restores the full rectangle (outside cells render it false).
- Cells are raw text keyed by A1 while formulas keep their expression: grid, CSV export and formula bar
  read that map through `evaluateCells`, so results are derived and recomputed on every render;
  row/column changes shift formula text on the server, never locally.
- The toolbar's Data menu (`Menu` named `Data`, `menuitem` commands `Sort range`, `Create filter`,
  `Clear filter`, `Data validation`, `Create pivot table`) is the REQ-5 entry point. Filters and rules
  belong to one worksheet (`.../worksheets/:id/filter`, `.../worksheets/:id/validations`), survive a
  refresh and never touch other worksheets.
- A filter stores the covered region (first row = headers) plus one entry per column;
  `hiddenRowsForFilter` derives the hidden rows, so hidden records keep their values and place in CSV
  export, pivot sources and the sheet; `Create filter` covers the selection block.
- `Sort range` (`POST .../worksheets/:id/sort`) reorders the selected rectangle's records in one write,
  replacing only `worksheet.cells`, so filter/validation rectangles keep their range. Keys compare by
  type, equal keys keep order, moved formulas follow (`mapFormulaRows`) and an invalid rectangle,
  column or order answers 422.
- Rules are enforced only at the API boundary (`validateCellWrites`): grid edits, the formula bar,
  pastes and moves reject the whole operation with the rule message and keep the previous values. The
  dialog replaces the rule covering the selection; a rule saved there carries `style: "between"`.
- Pivot tables are workbook-level (`workbook.pivots`) and address fields by source header text, so a
  moved/deleted column is detected on refresh. `computePivot` reads only the source and writes the
  separate `PivotN` result worksheet; `POST .../pivots` rejects a missing field or a nonnumeric SUM/
  AVERAGE value with 422, keeping both worksheets. `Create pivot table` covers the selection's block;
  the `Pivot table editor` region (Apply, `Refresh pivot table`) shows on a result worksheet.
- `normalizeState` only fills what is missing, so a hand-planted `workbooks.json` still opens: cells
  become text, the grid grows to cover them and missing selection/`validations`/`filter`/`pivots`
  become A1 / `[]` / `null` / `[]`.
- Grid editing: a printable key or Enter/F2 opens the inline editor `Edit <coordinate>` (Enter
  commits, Escape cancels); a paste starts at the selection's top-left corner and applies wholly or
  rejects with the rule message; a session range copy/cut wins over clipboard text.
- `transfer.mjs` plans a whole transfer in one write (source, target and formulas change together or
  not at all); copies shift relative references by the corner offset and keep `$` parts; transfers
  never cross worksheets.
- Undo/redo is a session-only server stack of whole-workbook snapshots taken *before* each cell write,
  transfer, structure change and sort — never renames, selections, filters, pivot applies or rules;
  `history.record` drops the redo branch.

## Preparation

- `backend/test/*.test.mjs` each use a temporary `dataDir`; suites pre-seed `workbooks.json` to plant
  rules, a filter or a cells-only seed. `frontend/src/test/mock-backend.ts` mirrors the API (filter,
  sort, validations, pivot and delete routes) for the UI tests.
- Vitest suites: `domain/{formula,paste,csv,references,filter,sort}.test.ts` plus `features/editor/*`.
- REQ-4 scenarios describe a seed (`A1=2`, `B1=3`, `=A1+B1`, `=C1*2`) mutually exclusive with the
  shared seed; those states are reached through REQ-3-1-1 edits, not by seeding.
