# ARCHITECTURE

Online spreadsheet workspace (React + Vite frontend, zero-dependency Node HTTP backend).

## Entry points & runtime contract

- `frontend/src/main.tsx` → `App` (hash router): `#/` workbook home (`New blank workbook`,
  `Import CSV`), `#/workbooks/new` (`Workbook name`, `Create`), `#/workbooks/<workbookId>` editor
  (title, `Last updated:`, `Formula bar`, worksheet tabs, `Worksheet grid`); else "Page not found".
- `backend/src/server.mjs`: reads `PORT` (default 3000) and listens on it plus every port in
  `backend/src/platform-ports.json` on `0.0.0.0`, each via its own `http.createServer` instance
  (`ARC_EXTRA_PORTS=0` skips them). Persistence: `SHALLOW_DATA_DIR` (default `<repo>/.data`),
  `workbooks.json` written atomically. Static hosting: `frontend/dist` resolved from `app.mjs`'s own
  location; `/` serves `index.html`, unknown paths/APIs 404, `/health` and `/api/health` `{ ok: true }`.

## Data model

```jsonc
{ "workbooks": [{ "id": "wb-…", "name": "…", "createdAt": "…", "updatedAt": "…",
  "activeWorksheetId": "ws-…", "worksheets": [{
    "id": "ws-…", "name": "Sheet1", "rowCount": 30, "columnCount": 26, "cells": { "A1": "Region" },
    "selection": { "anchor": "A1", "focus": "B2" },
    "validations": [{ "id": "dv-…", "type": "dropdown", "range": { "start": "A2", "end": "A4" }, "values": ["East", "North"] }],
    "filters": [{ "id": "filter-…", "range": { "start": "A1", "end": "C4" }, "conditions": [{ "column": "A", "kind": "values", "values": ["East"] }] }],
    "pivot": { "source": { "worksheetId": "ws-…", "range": { "start": "A1", "end": "C4" } },
               "rows": "Region", "columns": null, "values": "Sales", "summarizeBy": "SUM" } }] }] }
```

Conventions: `cells` is a sparse map of raw input text (a formula starts with `=`); `selection.anchor`
is the current cell, `selection.focus` the opposite corner. `updatedAt` (ISO-8601) changes on content
mutations (create/rename workbook, worksheet add/rename/delete, cell edit, paste, range transfer,
row/column structure, filter/validation/sort change, pivot create/apply/refresh, undo/redo); tab
switching and selection do not. Grid default 30×26; writing outside grows `rowCount`/`columnCount`.
`validations`/`filters`/`pivot` are region-bearing records: a structure change moves their `range` and
keeps every other field (`structure.mjs`); a pivot worksheet keeps its result cells until refreshed.

## API (relative, same-origin)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/workbooks` | – | `{ workbooks: [{ id, name, updatedAt, worksheetCount, activeWorksheetName }] }` |
| POST | `/api/workbooks` | `{ name }` | `201 { workbook }` |
| POST | `/api/workbooks/import` | `{ fileName, content }` | `201 { workbook }`; bad CSV → `400 "Invalid CSV file format. Import failed."` |
| GET / PATCH | `/api/workbooks/:id` | `{ name }` on PATCH | `{ workbook }` |
| PUT | `/api/workbooks/:id/cells` | `{ worksheetId, cell, value }` | `{ workbook }`; a rule refusing the value → `400`, no write |
| PUT | `/api/workbooks/:id/paste` | `{ worksheetId, start, text }` | `{ workbook }`; `400 "Nothing to paste"`, refused rectangle → rule message, no write |
| POST | `/api/workbooks/:id/worksheets/:wsId/range-transfer` | `{ source, target, mode: "copy"\|"cut" }` | `{ workbook }`; `400 "Invalid range"`, unknown mode `400 "Unsupported range operation"` |
| POST | `/api/workbooks/:id/undo` \| `/redo` | – | `{ workbook }` (`400 "Nothing to undo" \| "Nothing to redo"`) |
| PUT | `/api/workbooks/:id/active-worksheet` | `{ worksheetId }` | `{ workbook }` |
| PUT | `/api/workbooks/:id/worksheets/:wsId/selection` | `{ anchor, focus }` | `{ worksheetId, selection }` |
| POST | `/api/workbooks/:id/worksheets` | – | `201 { workbook }`; blank `SheetN` appended, active, A1 |
| PATCH | `/api/workbooks/:id/worksheets/:wsId` | `{ name }` | `{ workbook }`; `400 "Worksheet name cannot be empty" \| "Worksheet name already exists"`, no write |
| DELETE | `/api/workbooks/:id/worksheets/:wsId` | – | `{ workbook }`; `400 "A workbook must contain at least one worksheet"` (last worksheet) \| `"Please delete or rebuild dependent pivot tables first"` (a pivot result still reads it), no write |
| POST | `/api/workbooks/:id/worksheets/:wsId/rows` \| `/columns` | `{ action, row }` / `{ action, column }` | `{ workbook }`; actions above, `400 "Invalid row number"` |
| POST | `/api/workbooks/:id/worksheets/:wsId/sort-range` | `{ range, column, order: "ascending"\|"descending", hasHeaderRow }` | `{ workbook }`; `400 "Invalid range" \| "Invalid sort column" \| "Unsupported sort order"`, no write |
| POST / DELETE | `/api/workbooks/:id/worksheets/:wsId/filters` | `{ range }` | `{ workbook }`; POST creates the one filter view, DELETE is `Clear filter` |
| PUT | `.../filters/:filterId/columns/:column` | `{ condition }` | `{ workbook }`; column condition or `null` clears it |
| POST / DELETE | `.../validations[/:ruleId]` | `{ ruleId?, type, range, values? \| min?, max? }` | `{ workbook }`; saves/updates, DELETE removes (`404 "Validation rule not found"`) |
| POST | `.../worksheets/:wsId/pivot` | `{ range }` (source worksheet) | `201 { workbook }`; new `PivotN` worksheet with the default summary, active |
| PUT | `.../worksheets/:wsId/pivot` | `{ rows?, columns?, values?, summarizeBy? }` (pivot worksheet) | `{ workbook }`; `Apply` recomputes, absent keys keep the stored setting |
| POST | `.../worksheets/:wsId/pivot/refresh` | – | `{ workbook }`; recomputes the stored configuration |

Errors are `{ error: "<message>" }` with 400/404; invalid row/column answer `400 "Invalid row
number" \| "Invalid column"`, an unknown worksheet or pivot `404`.

## Worksheet operations

- `lib/structure.mjs` — pure insert/delete over one normalized worksheet: cells (with their formulas),
  `selection`, `validations[].range`, `filters[].range` and pivot source ranges move together;
  `shiftPivotSources` moves another worksheet's pivot source range and keeps its result cells.
- `lib/formulas.mjs` — A1-reference rewriting (`adjustFormulaText` for structure changes,
  `adjustFormulaOffset` for a copied range); a removed reference becomes `#REF!`.
- `lib/range-transfer.mjs` — pure plan/apply of a copy or cut inside one worksheet: the plan comes
  from the current state, so a refused operation writes nothing.
- `lib/validation.mjs` — rules (`dropdown` / `number-range`) and `validationRejection(validations,
  updates)`, the shared check of *every* write path. Messages: `Please select one of the following
  values: <values>`, `Please enter a number between <min> and <max>`, `Please enter a number from 0
  to 100` for a 0-to-100 rule. Clearing a cell is always allowed; a rule covers its own range only.
- `lib/sort-range.mjs` — `planRangeSort` re-orders the records of one selection by one column
  (`cellSortKey`/`compareSortKeys`: numbers, dates, text, empty last ascending, stable ties).
## Seed (shared initial state, seeded on empty storage)

Workbook `Q3 Sales` (`wb-q3-sales`): `Sheet1` (`ws-q3-sales-sheet1`) with `A1:C4` — headers
`Region`/`Sales`/`Status`, records `East/1200/Open`, `North/800/Closed`, `South/700/Open` — plus a
blank `Sheet2` (`ws-q3-sales-sheet2`); `updatedAt = 2026-01-15T09:30:00.000Z`, selection `A1`, no
filter/validation/pivot. Scenario states are built through the public UI/API operations (mutually
exclusive GIVENs, e.g. REQ-3's `Item/Qty`, REQ-4's `A1=2`,`B1=3`, collide with `A1=Region`, so they
are typed through the grid or `Formula bar`); a pivot worksheet is created by `Create pivot table`.
## Filtering, validation and sorting (REQ-5-1 / REQ-5-2)

- `src/lib/filter-view.ts` — pure filter view (`activeFilter`, `filterBounds`, `filterColumns`,
  `filterHeaderText`, `distinctColumnValues`, `columnCondition`, `conditionMatches`,
  `hiddenRowIndexes`, `detectDataRegion`); operators `text-contains`, `greater-than`, `before`,
  `is-empty`, `is-not-empty` shown as `Text contains`/`Greater than`/`Before`/`Is empty`/`Is not empty`.
- `src/lib/data-validation.ts` — pure rules: `parseValidationRules`, `dropdownRuleAt`, `ruleAt`,
  `parseAllowedValues`, `dropdownMessage`, `numberRangeMessage`.
- Filtering hides rows only: non-matching `role="row"` divs carry `hidden`, so every record keeps its
  value and place (CSV export and pivot sources still read them); `Clear filter` removes the record.
- `src/editor/DataMenu.tsx` — toolbar button `Data`; menu order `Sort range`, `Create filter`,
  `Clear filter`, `Data validation`, `Create pivot table`; `Create filter`/`Create pivot table` use the
  selected rectangle, or the data block around the active cell (first row = header) for one cell.
- Dialogs: `FilterDialog` `Filter <header text>` (`Condition` combo (`None` plus the five operators),
  `Value` text box, a checkbox per distinct source value, `Clear selection`, `Apply`);
  `DataValidationDialog` `Data validation` (`Rule type` `Dropdown`/`Number range`, `Allowed values` or
  `Minimum`/`Maximum`, `Save`, plus `Delete rule` when the selection is covered); `SortRangeDialog`
  `Sort range` (`Sort by`, `Order`, `Data has header row` declared by default, `Sort`); `CellDropdown` —
  a cell covered by a dropdown rule exposes `Open dropdown for <coordinate>` whose `option`s are its values.

## Pivot tables (REQ-5-3-1)

- `backend/src/lib/pivot.mjs` — pure: `sourceFields` (header texts of the range's first row),
  `defaultPivotSettings`, `normalizePivotSettings`, `computePivotCells`, `nextPivotWorksheetName`,
  `summaryHeader`; `PivotError` carries the refusals below.
- Layout: without a column field `A1` = row field, `B1` = `<method> of <value field>`, one row per row
  group in order of first appearance and a final `Grand Total` row; with a column field `A1` = row
  field, column values from `B1` in order of first appearance, final column `Grand Total`, and likewise
  a final `Grand Total` row. A qualifying record is a data row with any value; an empty combination
  summarizes to `0`. Fields are stored as header texts, so a moved column keeps its field.
- Methods: `SUM`/`AVERAGE` aggregate parseable numbers only, `COUNT` counts records with a non-empty
  value field (never fails on text). Refusals keep the last result and both worksheets: `Pivot field is
  no longer available. Select a new field.`, `Value field requires numeric values`,
  `Select a row field and a value field`, `Invalid pivot source range`; the create default is the first
  header as row field and the first field with numbers as SUM value (else `COUNT`).
- `src/lib/pivot.ts` — types (`PivotConfig`, `PivotSettings`, `SUMMARIZE_METHODS`), the `None` column
  option, `pivotSourceFields` and `pivotFieldProblem` (the derived missing-field message the editor
  shows without a request).
- `src/editor/CreatePivotTableDialog.tsx` — dialog `Create pivot table` with the visible text
  `Source range: <cell range>`, the `New worksheet` radio and `Create`.
- `src/editor/PivotTableEditor.tsx` — `<section>` named `Pivot table editor` with the combos `Rows`,
  `Columns` (`None` + headers), `Values` (`Summarize by`: SUM/COUNT/AVERAGE), `Apply` and
  `Refresh pivot table`; it starts from the stored configuration and is keyed by worksheet id, and
  `useWorkbook`'s `createPivot`/`applyPivot`/`refreshPivot` report through `pivotError` (shown inside
  the editor region) instead of the editor-wide banner.

## Worksheet lifecycle (REQ-2-1)

- `addWorksheet` appends a blank tab named with the first unused `SheetN`, active with A1 selected and
  no filter/rule/pivot copied elsewhere; `renameWorksheet` trims the name and rejects an empty or
  already used one. `deleteWorksheet` removes the worksheet (its cells, formulas, rules, filters and
  pivot result go with it), refuses the last remaining worksheet and one a pivot result still reads
  (`Please delete or rebuild dependent pivot tables first`), and activates the deleted tab's neighbor.
  None of them joins the undo history; switching tabs is `activeWorksheetId` alone, so grid, formula
  bar, filter buttons, validation entry points and pivot results all derive from the active worksheet.
- `src/editor/WorksheetTabs.tsx` — `role="tablist"` named `Worksheets`, one ARIA tab per worksheet in
  workbook order, each with a `Worksheet options for <name>` icon button (menu: `Rename`, `Delete`),
  plus the `Add worksheet` button; only the active worksheet's panel is rendered.
- `src/editor/DeleteWorksheetDialog.tsx` — dialog `Delete worksheet` naming the target worksheet
  (`<strong>` with the worksheet name) and a `Delete worksheet` button; the last-remaining worksheet
  never opens it (the editor shows `A workbook must contain at least one worksheet` on the alert
  banner instead), and any refusal closes the dialog and reports its message on the same banner.
## Frontend modules

- `src/lib/api.ts` — `apiRequest` (relative fetch, JSON, `ApiError`, `apiErrorMessage`).
- `src/lib/hash-route.ts` — hash parsing/`makeHash`/`navigate`/`useHashLocation`.
- `src/lib/spreadsheet.ts` — coordinate/rectangle helpers, `rangeLabel`, the `CellRange` type (pure).
- `src/lib/workbooks.ts` — typed workbook model (re-exporting the filter/validation/sort/pivot
  types) and the API client for the table above.
- `src/lib/formula.ts` — pure formula evaluation for the grid display: literals, strings,
  TRUE/FALSE, parentheses, unary/binary `+ - * /`, same-sheet A1 references, ranges in
  SUM/AVERAGE/COUNT/MIN/MAX (blanks and text ignored); a blank reference shows `0`. Grid errors:
  `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#ERROR!`.
- `src/lib/csv.ts` — pure worksheet→CSV serializer, file name, `downloadTextFile`; a formula cell
  exports the result the grid shows; export is client-side, read-only and ignores the filter view.
- `src/lib/clipboard.ts` / `range-clipboard.ts` — async clipboard access and the copied rectangle.
- `src/hooks/useWorkbook.ts` — editor state: load, busy guard, mutations, selection persistence,
  `canUndo`/`canRedo`, `actionError` for recoverable feedback.
- `src/editor/` — `WorksheetGrid` (ARIA grid, gridcells named by coordinate with
  `data-cell-coordinate`, inline editor `Edit <coordinate>`, drag selection, copy/cut/paste,
  right-click menus, filter/dropdown decoration), `GridContextMenu`, `FormulaBar` (text box
  `Formula bar`), `RenameWorkbookDialog`, `RenameWorksheetDialog`, `WorksheetTabs`,
  `DeleteWorksheetDialog`, `DataMenu`, `FilterDialog`, `DataValidationDialog`, `SortRangeDialog`,
  `CellDropdown`, `CreatePivotTableDialog`, `PivotTableEditor`.
- Toolbar buttons, in order: `Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `Export CSV`, `Data`, `Rename
  workbook`.
- Selecting: `mousedown` on a gridcell starts the rectangle (shift keeps the anchor), `mousemove`
  moves the focus, `mouseup` commits via `onSelect`; arrows move, shift+arrow extends; persisted per
  worksheet. Pasting writes the whole rectangle or nothing; refusals show in the editor's
  `role="alert"` banner. Undo/redo (`service.mjs` snapshots the workbook before every recorded
  mutation, limit 100) goes through the store, so it survives a refresh. Row/column header menus:
  `Insert 1 row above`, `Insert 1 row below`, `Delete row` / `Insert 1 column left`, `Insert 1
  column right`, `Delete column`; the header mirrors `aria-expanded`.

## Accessibility contracts

- Tabs: `role="tab"` in a `tablist` labeled `Worksheets`, active tab `aria-selected="true"`; grid:
  `role="grid"` named `Worksheet grid`, `aria-multiselectable="true"`, cells `role="gridcell"` named
  by coordinate with `aria-selected`, headers `rowheader`/`columnheader`.
- Pivot editor: region named `Pivot table editor` with combos `Rows`/`Columns`/`Values`/`Summarize
  by` (header-text options, SUM/COUNT/AVERAGE).

## Checks

- Install: `npm --prefix backend install`, `npm --prefix frontend install`; build: `npm --prefix
  frontend run build`.
- `run_tests frontend` (Vitest/jsdom; `src/test/fake-backend.ts` mirrors the API including the pivot
  endpoints and `DELETE …/worksheets/:wsId`; `data-flows` REQ-5-1-2/REQ-5-2, `sort-flows` REQ-5-1-1,
  `worksheet-tabs` REQ-2-1, `pivot-flows` REQ-5-3-1) and `run_tests backend` (node:test over the real
  handler and a temp state file: `filter-validation`, `sort-range`, `worksheet-lifecycle`, `pivot`).
