# Architecture

Online spreadsheet workspace (Google Sheets-like): `frontend` (React + Vite + TypeScript, hash routing) and `backend`
(zero-dependency Node `http`).

## Platform contract

- `backend/src/server.mjs` reads `PORT` (default 3000) and creates one `http.createServer(handler)` per port on
  `0.0.0.0`; extra ports come from `backend/src/platform-ports.json` (3301), skipped only when `ARC_EXTRA_PORTS=0`.
- `GET /health` and `GET /api/health` answer `{ ok: true }`; `/` and existing `frontend/dist` files are served from a
  path relative to the server file, and any other path or unknown `/api/*` route answers a JSON 404 without stopping the
  process.
- Persistence uses `SHALLOW_DATA_DIR` (default `<repo>/.data`): the atomic `workbooks.json` of `json-store.mjs`
  (serialized updates, temp file + rename).

## Domain state

`createWorkbookRepository(dataDir)` (`backend/src/lib/workbook-store.mjs`) owns the state document:

```
{ workbooks: [ { id, name, createdAt, updatedAt, activeWorksheetId, worksheets: [ { id, name, rowCount, columnCount,
      cells: { "A1": { value: "=B2+B3", display: "2300" } }, selection: { anchor, focus },
      validations: [ { id, type, range, min?, max?, allowedValues?, message? } ], filter: { region, columns } | null,
      pivot: { sourceWorksheetId, sourceRange, rows, columns, values, summarizeBy } | null } ] } ] }
```

`filter.condition` is `textContains`, `greaterThan`, `before`, `isEmpty` or `isNotEmpty` (labels `Text contains`,
`Greater than`, `Before`, `Is empty`, `Is not empty`); only comparing conditions carry a `value`. A filter only hides
rows of its region; row/column limits default to 50 x 26 and grow on writes.

A worksheet with `pivot` is a pivot *result* worksheet whose summary lives in its own cells (`pivot.mjs`), so a read
never writes the source: `rows`/`values` (plus `columns`) name source header texts of `sourceRange` on
`sourceWorksheetId`, `summarizeBy` is `SUM`/`COUNT`/`AVERAGE`, `COUNT` counts records with a non-empty value field, and
`SUM`/`AVERAGE` answer `Value field requires numeric values` without a parseable number (a vanished header answers
`Pivot field is no longer available. Select a new field.`); both keep the last result.

A cell keeps the submitted text as `value` (an ordinary value or the original formula) and the shown text as `display`,
which `formula.mjs` recalculates after each write and on every store read. Supported: numbers, text, booleans, dates,
parentheses, arithmetic/comparison/`&`, A1 references (`$` allowed), ranges and SUM/AVERAGE/COUNT/MIN/MAX/IF/ROUND/ABS
(aggregates ignore blanks and text); errors `#DIV/0!`, `#REF!` (invalid/circular), `#NAME?`, `#ERROR!`.
`translateFormulaReferences(text, rowOffset, columnOffset)` rewrites a copied formula (relative row/column follows, `$`
parts stay, off-sheet → the whole formula `=#REF!`); `remapFormulaReferences(text, mapReference)` rewrites one through a
structure change (`null` → `#REF!`).

`updatedAt` changes on create, import, cell writes, pastes, sorts, structure changes, pivot create/apply/refresh,
undo/redo and worksheet create/delete; switching the active worksheet, storing a selection and saving a filter or
validation rule leave it alone.

### Worksheet lifecycle

`repository.deleteWorksheet` drops a worksheet with everything it holds, keeping at least one worksheet and any
worksheet a pivot result still reads (refusals `A workbook must contain at least one worksheet` / `Please delete or
rebuild dependent pivot tables first`, also in `frontend/src/workbooks/worksheet-messages.ts`); the adjacent worksheet
(next, else previous) becomes active when the deleted one was, and its history entries are dropped.

### Row and column structure (`structure.mjs`)

`applyStructureChange(worksheet, { axis, op, index, side })` (`op` `insert`/`delete`) moves one worksheet as a whole
(cells, formula references — a removed row/column becomes `#REF!` — validation rules, filter view, selection and a pivot
source range until `Refresh pivot table`). `insert` places the blank line before/after `index` and grows the counts,
`delete` keeps them; an index outside 1..count or an unknown axis/op answers 400.

### Undo history (`backend/src/lib/history.mjs`)

One undo/redo stack per workbook id (50 entries) of the worksheet state before and after one operation. Recorded are
the operations that change cell data - cell write, paste, range transfer, sort and row/column change; a rejected
operation records nothing and a new one drops the redo branch. Undo writes `before` (redo `after`) over that worksheet,
so values, formulas, structure, rules, filter view and selection come back with recalculated dependents;
`dropWorksheet` forgets a deleted worksheet. The log is memory only (an empty log answers 409).

### Seed (`seed.mjs`)

Shared initial state, written when the store file is missing: workbook `wb_q3_sales` "Q3 Sales" with the active
worksheet `ws_q3_sales_sheet1` "Sheet1" holding the seed range `A1:C4` (headers `Region/Sales/Status` over
`East/1200/Open`, `North/800/Closed`, `South/700/Open`; selection `A1`, no rule, no filter) and the blank
`ws_q3_sales_sheet2` "Sheet2". No accounts/roles exist; the conflicting states of other packets (`A1:B2`
`Item/Qty`/`Pen/4`, `A1=2`/`B1=3`/`=A1+B1`/`=C1*2`, a 0-to-100 rule) are readied through the API and the `Formula
bar`.

## Backend API (all JSON, same origin)

Every workbook response is `{ workbook, canUndo, canRedo }`, the session-history flags.

- `GET /api/workbooks` → `{ workbooks: [{ id, name, updatedAt }] }` (newest first)
- `POST /api/workbooks` `{ name }` → 201; blank name becomes `Untitled workbook`; one blank active `Sheet1`
- `GET /api/workbooks/:id` → the payload | 404
- `PATCH /api/workbooks/:id` `{ name?, activeWorksheetId? }` → the trimmed name (blank → 400
  `Workbook name cannot be empty`); the worksheet id must exist
- `POST /api/workbooks/:id/undo` and `.../redo` → the restored workbook, or 409 `There is nothing to undo` /
  `There is nothing to redo`; 404 for an unknown workbook
- `PUT .../worksheets/:worksheetId/cells/:cellId` `{ value }` → `""` clears the cell; a value a rule rejects answers
  400 with the exact rule message and nothing is written
- `POST .../worksheets/:worksheetId/paste` `{ cell, values: string[][] }` → writes the whole rectangle (empty fields
  clear their target) or rejects it with 400 for the first violating target
- `POST .../worksheets/:worksheetId/transfer` `{ mode: "copy"|"cut", source, target }` → the internal range clipboard:
  `copy` writes the rectangle at `target` with translated copied formulas (off-sheet → `=#REF!`), `cut` writes it and
  clears the uncovered source cells; a rejection touches neither range
- `POST .../worksheets/:worksheetId/structure` `{ axis, op, index, side? }` → the checked row/column change (`index` =
  the row number or column index of the right-clicked header)
- `POST .../worksheets/:worksheetId/sort` `{ range, column, order, hasHeader }` → `sort.mjs` reorders the rows of the
  range (`order` `ascending`/`descending`, `column` an index inside the range); a malformed range, a column outside it
  or an unknown order answers 400 and stores nothing
- `PATCH .../worksheets/:worksheetId` `{ selection }` or `{ name }` → `selection` stores the rectangle without touching
  `updatedAt`; `name` must be non-empty and unique, else 400 `Worksheet name cannot be empty` /
  `Worksheet name already exists`
- `DELETE .../worksheets/:worksheetId` → the lifecycle rules above (200, the two 400 refusals, 404)
- `POST /api/workbooks/:id/worksheets` → 201; a blank worksheet named with the first unused `SheetN` (a freed name is
  reused), active with the selection `A1`
- `PUT .../worksheets/:worksheetId/validations` `{ range, type, min?, max?, allowedValues?, message? }` → replaces the
  rule of the same type and range (`allowedValues` trimmed and de-duplicated; without a `message` the default text of
  the type); `DELETE .../validations/:ruleId` removes a rule, keeping values
- `PUT .../worksheets/:worksheetId/filter` `{ region, columns }` → `filters.mjs` normalizes it (a column outside the
  region, an unknown `kind` or condition is a 400); `DELETE` stores `filter: null`
- `POST /api/workbooks/:id/pivots` `{ sourceWorksheetId, sourceRange }` → 201; appends the `PivotN` result worksheet,
  active with the stored source range and no field; a header-only, out-of-bounds or unknown range answers 400/404
- `PUT .../worksheets/:worksheetId/pivot` `{ rows, columns, values, summarizeBy }` and `.../pivot/refresh` → rewrite the
  summary of that result worksheet (the given fields, or the stored configuration); refusals preserve the result
- `POST /api/workbooks/import` `{ fileName, content }` → 201; name = file name without the final `.csv`; invalid CSV →
  400 `Invalid CSV file format. Import failed.`

`backend/src/lib/csv.mjs` parses CSV (quoted fields, CRLF/LF/CR, empty fields, UTF-8 BOM; `CsvFormatError` → 400).

## Frontend structure

- Hash routes: `#/` (workbook home), `#/workbooks/new`, `#/workbooks/<workbookId>` (editor, openable and refresh-safe;
  the active worksheet comes from the workbook, not the URL). `src/App.tsx` routes with `src/lib/hash-route.ts` (pages in
  `src/pages/`, editor pieces in `src/editor/`, API in `src/workbooks/`).
- Home page: heading `Workbooks`, buttons `New blank workbook` and `Import CSV`, one record per workbook (a link named
  by the workbook name plus `Last updated: <formatted value>`); the `Import CSV` dialog (`role=dialog`) has the `CSV
  file` control and `Confirm import`.
- Editor page: `<h1>` workbook name with the adjacent button `Rename workbook`, `Last updated: <same formatter as
  home>`, the toolbar (`role=toolbar` "Editor toolbar": `Undo`, `Redo`, the `Data` menu, `Cut`, `Copy`, `Paste`,
  `Export CSV`), the input `aria-label="Formula bar"` bound to the current cell (Enter or blur commits, Escape reverts),
  the tab bar and grid. `Undo`/`Redo` are native `disabled` while nothing can be stepped that way or a mutation runs.
- Worksheet tab bar (`src/editor/WorksheetTabs.tsx`): `role=tablist` "Worksheets" in stored order, one `role=tab` per
  worksheet (`aria-selected` marks the active one); each tab carries the icon button `Worksheet options for
  <worksheet name>` opening a `role=menu` "Options for <name>" whose `Rename` and `Delete` `menuitem`s open the rename
  dialog or the `Delete worksheet` confirmation (its button is `Delete worksheet`; the pivot refusal closes it into the
  page notice, the last worksheet opens nothing and reports the message). `Add worksheet` adds the next worksheet (both
  disabled while a mutation runs); the active `role=tabpanel` holds the pivot editor (if any) and the grid.
- `useSpreadsheetSession` (`src/editor/useSpreadsheetSession.ts`) owns the editor state of one workbook: the loaded
  workbook, its undo/redo flags, each worksheet's selection and the mutations, which share one serialized queue so a
  late response cannot replace the workbook with an older revision. Mutations: `createFilter`, `clearFilter`,
  `sortSourceRegion`/`sortRange`, `pivotSourceRegion`, `createPivotTable`, the rejecting `applyPivotFields`,
  `refreshPivotTable`, `saveColumnFilter`, `saveValidationRule`, `deleteValidationRule`, `writeCellValue`,
  `addWorksheet`, `deleteWorksheet`, `changeStructure`, `selectWorksheet`, `showNotice`, `undo`/`redo`.
- Switching (`selectWorksheet`): tab, grid, structure, selection, formula bar, filter buttons, validation entry points
  and pivot editor follow the click while the request only stores `activeWorksheetId`; a failure restores the previous
  active worksheet with the reason.
- Rename dialogs (`RenameWorkbookDialog.tsx`, `RenameWorksheetDialog.tsx`): `role=dialog` named `Rename workbook`/
  `Rename worksheet` with a prefilled `Workbook name`/`Worksheet name` box and `Save`; a blank name is rejected before
  any request, a failure keeps the name and shows the error in the dialog.
- Grid contract (`src/editor/WorksheetGrid.tsx`): `role=grid` "Worksheet grid" with `aria-multiselectable="true"`, rows
  of `row` with `rowheader`/`columnheader` headers and a `gridcell` per coordinate (`A1`) showing `displayedCellText`
  and `aria-selected` per the selected rectangle. Click selects, drag/Shift-click/arrow keys extend, double-click (or a
  printable character) opens an inline `<input>` `Edit <cell coordinate>` (Enter or leaving commits, Escape cancels);
  right-clicking a header opens its `role=menu` "Row <n> menu"/"Column <letter> menu" of row/column `menuitem`s
  (`src/editor/structure.ts`).
- Range clipboard (`src/editor/clipboard.ts`): `Ctrl+C`/`Ctrl+X`, the toolbar `Cut`/`Copy`/`Paste` and the "Grid context
  menu" `menuitem`s carry the selection as `{ worksheetId, mode, region }` and paste it through `POST .../transfer`;
  `POST .../paste` writes external clipboard text, and another worksheet's rectangle is refused.
- CSV export (`src/workbooks/csv.ts` + `src/lib/download.ts`): `Export CSV` downloads the active worksheet as UTF-8
  `text/csv` `<workbook name> - <worksheet name>.csv` (non-empty bounding box, quoted fields).

## Data organization and validation (`src/editor/filters.ts`, `sort.ts`, `DataMenu.tsx`)

- The toolbar button `Data` opens a `role=menu` "Data" of `menuitem`s `Create filter`, `Sort range`,
  `Create pivot table`, `Clear filter`, `Data validation` (`DataMenu.tsx`); `Create filter` uses the selection (a clicked
  cell expands to its contiguous non-empty block, `dataBlockAt`), a header-only region is refused. `WorksheetGrid`
  renders a `Filter <header text>` button in the header cell of every filtered column and gives a cell under a dropdown
  rule the button `Open dropdown for <cell coordinate>` (`CellDropdown.tsx`, a `listbox`); filter-hidden rows stay in the
  DOM with `hidden`.
- `filters.ts` holds the pure filter logic; `FilterDialog` (`Filter <header>`) shows the distinct source values with
  `Clear selection` plus the `Condition`/`Value` pair behind one `Apply` (the condition wins once its select changed or
  its box is filled, else the checked values do). `DataValidationDialog` (`Data validation`) pre-fills the rule of the
  selection and offers `Delete rule`; both keep server errors inside.
- Sorting (REQ-5-1-1): `Sort range` uses the same range command region and opens `SortRangeDialog.tsx` ("Sort range"
  with the `Sort by`/`Order` combos, the `Data has header row` checkbox and `Sort`); `sort.ts` names the `Sort by`
  options with the range's header texts (the column letter when empty) and pre-checks the checkbox when the first row
  holds a text in every column. `sort.mjs` reorders whole records inside the same coordinates: keys compare as numbers,
  dates or text, blank keys follow in both directions, equal keys keep their order, the header row and outside cells
  stay, a formula moves with its row's references, and each sort is one undo step. The order lives in the cells, so it
  survives a refresh while the filter view, rules and selection keep their coordinates.
- Pivot tables: `Create pivot table` opens `CreatePivotTableDialog.tsx` (`role=dialog` "Create pivot table" with
  `Source range: <range>`, the `New worksheet` radio and `Create`) and activates the new `PivotN`; a pivot result
  renders `PivotTableEditor.tsx` (`role=region` "Pivot table editor") above its grid with the combos
  `Rows`/`Columns`/`Values` (source header texts plus `(none)`) and `Summarize by` (`SUM`/`COUNT`/`AVERAGE`), `Apply`,
  `Refresh pivot table` and the refusals (`src/editor/pivot.ts`).

## Commands

- install: `npm --prefix frontend install --no-audit --no-fund` (and `--prefix backend`); build: `npm --prefix frontend run build`; start: `npm --prefix backend run start`
- tests: `run_tests` (`frontend` = Vitest + @testing-library/react on `src/test/fakeApi.ts`; `backend` = `node --test`
  over the engines and the HTTP API on an ephemeral port with a temp data dir).
- `fakeApi.ts` mirrors the server: the worksheet routes (create, rename, select, delete), the 0-to-100 rule message,
  formula copy offsets and displays (`fakeFormula.ts`), the structure change (`fakeStructure.ts`), the sort
  (`fakeSort.ts`), the pivot endpoints (`fakePivot.ts`), the `A1:C4` seed with its blank `Sheet2` and the per-workbook
  undo/redo log.
