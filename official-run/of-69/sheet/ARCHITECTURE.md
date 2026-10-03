# ARCHITECTURE

在线电子表格应用（React+Vite+TS + 零依赖 node:http 后端）。本文件只记录定位入口与跨模块约束。

## 修改入口

- `backend/src/lib/workbooks.mjs` — 工作簿领域与 `SEED_DATA`：`createWorkbookService`（工作簿/工作表增删/结构/单元格/选区/区域/还原/筛选/验证/排序/透视）、`buildValidationRule`、`deleteWorksheet` 相关文案（`LAST_WORKSHEET_MESSAGE`/`PIVOT_DEPENDENT_MESSAGE`）、`WorkbookError`；HTTP 路由与校验在 `backend/src/handler.mjs`（worksheets 的 POST/PATCH/DELETE 与 filter|validations|sort|pivot 子资源），启动在 `server.mjs`。
- `backend/src/lib/filter.mjs` — 筛选视图模型：`FILTER_CONDITIONS`、`filterBounds`/`rangeName`、`rowMatchesFilterRule`、`hiddenRowsOf`、`distinctColumnValues`、`filterColumnsOf`、`normalizeFilter`、`shiftFilter`。
- `backend/src/lib/pivot.mjs` — 透视表：`PIVOT_METHODS`、`pivotFieldOptions`（字段=源表头文本，空表头回退列字母）、`computePivotCells`（行/列按首现排序、末行与末列 `Grand Total`；SUM/AVERAGE 只取可解析数字，COUNT 计非空）、错误文案；`createPivotTable`/`applyPivotTable`/`refreshPivotTable`/`nextPivotWorksheetName` 在 `workbooks.mjs`，路由 `POST .../pivots`、`.../worksheets/:wsId/pivot`、`.../pivot/refresh` 在 `handler.mjs`。
- `backend/src/lib/sort.mjs` — 排序模型：`SORT_ORDERS`、`sortKey`/`compareSortKeys`、`sortRangeCells(worksheet, {bounds, column, order, hasHeader})`。
- `backend/src/lib/formula.mjs` 公式引擎 `recalculateCells` + 错误常量；`transfer.mjs` 区域复制/剪切；`validation.mjs` `validateCellValue` 与文案；`structure.mjs` `applyAxisChange`/`shiftFormula`/`shiftValidationRange`；`csv.mjs` CSV 读写与文件名；坐标助手在 `cells.mjs`。
- `frontend/src/pages/EditorPage.tsx` — 编辑器页：工具栏（`role="toolbar"` 内 `Data`/`Copy`/`Cut`/`Paste`/`Undo`/`Redo`/`Export CSV`）、公式栏、工作表标签、标签菜单（`Rename`/`Delete`）、Data 命令与对话框接线；hash 路由在 `frontend/src/App.tsx`。
- `frontend/src/editor/DeleteWorksheetDialog.tsx` — 工作表删除确认对话框 `Delete worksheet` 与 `LAST_WORKSHEET_MESSAGE`；删除调用 `deleteWorksheet` 在 `frontend/src/domain/workbook-api.ts`（`DELETE .../worksheets/:wsId`）。
- `frontend/src/editor/FilterDialog.tsx`/`DataValidationDialog.tsx`/`SortDialog.tsx` — 数据对话框 `Filter <header text>`、`Data validation`、`Sort range`。
- `frontend/src/editor/WorksheetGrid.tsx` — ARIA 网格：选区、内联编辑、Ctrl+C/X/V、右键菜单；另渲染筛选隐藏行、`Filter <header text>` 表头按钮与 `Open dropdown for <坐标>` 列表。
- `frontend/src/domain/pivot.ts` + `editor/CreatePivotTableDialog.tsx`/`PivotTableEditor.tsx` — 透视表前端镜像与 `Pivot table editor` 区域（Rows/Columns/Values/Summarize by、Apply、Refresh pivot table）；`Data` 菜单 `Create pivot table` 与接线在 `pages/EditorPage.tsx`。
- `frontend/src/editor/useWorksheetEditing.ts` — 编辑编排（`CellDraft`、`RangeClipboard`、`commit`/`select`/`paste`/`pasteRangeInternal`/`setValue`）；`useWorkbookHistory.ts` 是会话级撤销/重做。
- `frontend/src/domain/filter.ts` — 筛选模型前端镜像：`hiddenRowSet`、`filterColumns`、`distinctColumnValues`、`withColumnRule`、`filterRegionFor`、`FILTER_CONDITION_LABELS`；`validation.ts` — `ruleCoveringRange`/`ruleForRange`/`listRuleForCell`/`allowedValuesOf`；`sort.ts` — `SORT_ORDER_OPTIONS`、`sortColumnOptions`。
- 其余：`domain/types.ts`（类型/坐标/选区）、`clipboard.ts`、`workbook-api.ts`、`ui/Combobox.tsx`（原生 select，option 文本=可访问名）。

## 关键约束

- 权威状态在后端 JSON（`SHALLOW_DATA_DIR/workbooks.json`），前端只拉取；种子仅文件缺失时生效，重启保留用户修改（`json-store.mjs`）。
- 单元格模型：`{value}`=普通文本或公式结果，`{formula, value}`=公式原文+结果；网格/CSV 用 `value`，公式栏用 `formula ?? value`。所有写操作都在同一次 `store.update` mutator 内先校验后应用，抛错不落盘；写入后先 `recalculateCells`，再按结果值跑 `validateCellValue`。
- 筛选视图 `worksheet.filter={range, rules:[{column, mode:"values"|"condition", values|condition+value}]}`：`range` 含表头、`column` 为绝对列号；只隐藏区域内不匹配数据行，表头与区域外不动（不删除不重排），CSV 导出含全部行；多列 AND；`clearFilter` 即恢复原顺序；后端 `hiddenRowsOf` 与前端 `hiddenRowSet` 须同规则；筛选行用 DOM `hidden` 隐藏，必须保留 `.sheet-grid__row[hidden]{display:none}`（作者 `display:flex` 会盖过 UA 规则）。
- 排序 `POST .../sort`（`{range, column, order, hasHeader}`）：`sortRange` 在 mutator 内先校验后用 `sortRangeCells` 重排整条数据记录，被移动公式经 `translateFormula` 重写后 `recalculateCells`；类型感知稳定比较（数字/可解析日期/文本，同键保序），表头行与区域外不动，filter/validation 的 range 不改，失败不落盘；前端 `Sort range` 用当前选区、单格时同 `Create filter` 扩展到连续数据块，成功后记入撤销快照。
- 透视表：`worksheet.pivot={sourceWorksheetId, sourceRange, rowField, columnField, valueField, summarizeBy}`，结果只写该表 `cells`（最近一次成功摘要），源表只读；字段按源表头文本解析，源列移动只改 `sourceRange`（`structure()` 内 `shiftValidationRange`），表头被删或无数字时 Apply/Refresh 报 `Pivot field is no longer available. Select a new field.`/`Value field requires numeric values` 并保留旧结果；先算后写、失败不落盘；范围内的全空数据行不参与分组。
- 结构变更只能在后端：先校验 action/index，再在 mutator 内移位单元格、选区、`validations.range`、`filter.range`/`filter.rules.column`（列被删则该规则消失），最后重算写盘；失败不落盘，前端不做乐观更新。
- 验证规则 `{range, type:"list", values}`/`{range, type:"number", min, max}`：`Allowed values` 按逗号切分去空格；number 含边界，文案由 `numberRuleMessage`/`listRuleMessage` 生成（0–100 有专文案）；`setValidation` 覆盖同 range 或新 range 内旧规则、`deleteValidation` 按 range 精确删除，都不改单元格值；网格/公式栏/粘贴/区域搬移共用同一校验，批量任一目标不合法则整次拒绝。
- 选区按工作表持久化（`{anchor, focus}` 两角）；`setSelection` 不改 `updatedAt`，切表互不覆盖；区域操作只读两角，不扩张到相邻数据。编辑器入口稳定：`#/workbooks/<id>` 直接打开/刷新都按 id 重新 GET。
- 网格 ARIA：名 `Worksheet grid`、`aria-multiselectable="true"`；`gridcell` 名=坐标，选区内 `aria-selected="true"`、外 `"false"`；首行 `columnheader`=列字母、首列 `rowheader`=行号，`aria-rowcount`/`aria-colcount`=行列数+1。表头筛选/下拉按钮箭头用 CSS `::before`（避免污染单元格文本）。
- 编辑/提交语义：内联输入框与公式栏共用同一 draft；Enter 提交，Escape 丢弃，点击另一格提交并把新选区放进同一次写入；写失败显示 `role="alert"` 且保持上次成功值。工作表标签见 `ui/Tabs.tsx`。
- CSV：`importCsv` 先 `parseCsv`（失败 `Invalid CSV file format. Import failed.`）再建表，工作簿名=文件名去末尾 `.csv`；`exportCsv` 只读已用区域、公式写 `value`；导出文件名前后端各一份（`csv.mjs`/`csv-export.ts`）须同步。
- 区域复制/剪切只支持同表：内部 `RangeClipboard`（`POST .../range`）优先，否则用 `text/plain`/`navigator.clipboard.readText()`（失败 `Unable to read the clipboard.`）聚成一次 `writeCells`；`cut` 只在目标写入成功时清源。
- 撤销/重做是整表快照（`WorksheetSnapshot`=行列数/单元格/选区/`validations`），先校验后替换并重算，栈按工作簿隔离、刷新清空；筛选不在快照内。
- 工作表删除 `DELETE .../worksheets/:wsId`（`deleteWorksheet`）：删除前先校验（至少保留一张表、不能是其他透视表的源表），失败不落盘；成功后原位相邻表（末位取前一张）变为活动表，被删表的数据/公式/筛选/验证/透视结果一并移除，源表只读不变。前端只剩一张表时不弹确认框，直接显示 `A workbook must contain at least one worksheet`；透视依赖拒绝文案 `Please delete or rebuild dependent pivot tables first`，对话框关闭、两表均不变。

## 必要准备

- 种子：工作簿 `Q3 Sales`，`Sheet1` 数据区 `A1:C4`（表头 `Region/Sales/Status`，行 `East/1200/Open`、`North/800/Closed`、`South/700/Open`）与空白 `Sheet2`，两表选区 A1、`Sheet1` 活动、`updatedAt=2026-10-01T08:00:00.000Z`；种子无筛选、无验证规则、无公式（示例公式经编辑操作现场建立，见 `req4-*`）。
- 公开入口：单元格=内联编辑器/公式栏/Ctrl+V/右键 `Paste` 或 `PATCH .../cells`；选区=`PATCH .../selection`；结构=`POST .../rows|columns`；搬运=`POST .../range`；撤销重做=`POST .../restore`；筛选=`Data` 菜单 `Create filter`/`Clear filter` 或 `POST|DELETE .../filter`；验证=`Data` 菜单 `Data validation` 或 `POST .../validations` 与 `DELETE .../validations?range=`；排序=`Data` 菜单 `Sort range` 或 `POST .../sort`；透视=`Data` 菜单 `Create pivot table` 或 `POST .../pivots`、`POST .../pivot`、`POST .../pivot/refresh`。
- 自检启动 `ARC_EXTRA_PORTS=0 PORT=38633 npm --prefix backend run start`，数据用 `SHALLOW_DATA_DIR` 隔离。前端测试固定单 worker；Playwright role 查询对坐标名要用 `exact: true`；`navigator.clipboard` 桩须在 `userEvent.setup()` 之后定义。

## 当前限制

- 场景 GIVEN 的种子互斥（REQ-3-* 写 `A1:B2`=Item/Qty，REQ-5-* 写 `A1:C4`=Region/Sales/Status）：按 REQ-5 播种，「range `A1:C6`」按数据区理解，未播种多余空行。`Add worksheet` 的新表不继承筛选、验证或透视结果。
