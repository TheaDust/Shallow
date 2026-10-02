# ARCHITECTURE

Stack: React + Vite + TS + 零依赖 Node HTTP。
Scope: 工作簿/CSV（REQ-1）、工作表与行列（REQ-2）、单元格与区域（REQ-3）、公式（REQ-4）、筛选/校验/排序（REQ-5-1/5-2）、透视（REQ-5-3）。

## 修改入口

- `backend/src/domain/workbooks.mjs` — `createSeedState()`/`createWorkbookService(store)`（`DomainError` 见 `errors.mjs`）；`updateCells`/`replaceWorksheet`/`replaceValidations`/`setFilter`/`sortRange`/`createPivot`/`configurePivot`/`refreshPivot`/`changeStructure`/`deleteWorksheet` 均整批校验后落盘。
- `backend/src/domain/validation.mjs` — `parseRange`（共用 A1 区间解析）、`checkValidationError`/`validationMessage`/`normalizeValidationRules`；类型 `list`/`number-between`/`number`，文案见源码，空值放行。
- `backend/src/domain/filter.mjs`、`sort.mjs` — `normalizeFilter`→`{range,rules[]}`（规则按表头文本归属列，条件名见 `FILTER_CONDITIONS`）；`normalizeSortRequest`/`sortWorksheetCells`。
- `backend/src/domain/pivot.mjs` — 透视（REQ-5-3-1）：`pivotHeaderColumns`、`normalizePivotFields`、`computePivotResult`→`{cells,usedRows,usedCols}`（只读源表；SUM/AVERAGE 只算可解析数字，COUNT 计非空；组序=首次出现，末行/列为 `Grand Total`）；`MISSING_FIELD_MESSAGE` 等文案常量在此。
- `backend/src/domain/structure.mjs` — `shiftWorksheetStructure`（平移 cells/网格尺寸/`validations[].range`/`filter.range`）与 `shiftPivotSourceRange`。
- `backend/src/domain/grid.mjs` — A1 坐标权威定义 `parseCellName`/`columnName`/`toCellName`/`contentExtent`。
- `backend/src/app.mjs` — 路由与静态资源：`/health`、`/api/health`、`/api/workbooks[...]`（worksheets 的 cells/rows/columns/validations/filter/sort 与 `DELETE` 删表；透视 `POST/PUT .../pivot` 与 `POST .../pivot/refresh`）；未知路径 404；多端口见 `server.mjs`。
- `frontend/src/domain/workbook.ts` — 共享类型（`ValidationRule`/`FilterRule`/`WorksheetFilter`/`PivotTable`/`PivotFields`）与坐标/选区/路由纯函数；`domain/filter.ts` 的 `dataRegionFor`（单格→已用矩形，筛选/排序/透视共用）与 `hiddenRows`；`domain/pivot.ts` 的 `pivotHeaderOptions`/`pivotMissingFields`/`defaultPivotFields`。
- `frontend/src/domain/` 其余模块 — `sort.ts`/`validation-rules.ts`/`formula.ts`/`range-transfer.ts`/`clipboard.ts`/`history.ts`/`csv.ts`：对话框选项、规则合并、显示值、区域传输、撤销、CSV。
- `frontend/src/components/WorksheetGrid.tsx` — 网格（显示值、表头/单元格右键菜单、内联框、`Filter <header>`/`Open dropdown for <坐标>` 按钮、隐藏行不渲染）；`WorksheetTabs.tsx` 标签栏（`role="tab"`+`aria-selected`、`Add worksheet`、每标签菜单 `Rename`/`Delete`）；同名对话框 `FilterDialog`/`DataValidationDialog`/`SortRangeDialog`/`DeleteWorksheetDialog`/`CreatePivotDialog`/`PivotTableEditor`、`CellOptionsList`/`EditorToolbar`（`Data` 菜单）为其余控件。- `frontend/src/pages/WorkbookEditorPage.tsx` — 编排：加载、活动表与选区、公式栏、草稿、结构变更、各对话框与 `Data` 菜单接线；剪贴板/历史委托 `pages/useRangeClipboard.ts`、`pages/useWorkbookHistory.ts`（必须在加载分支前调用，hook 顺序稳定）。
- `frontend/src/lib/workbook-api.ts` — 同源 JSON 客户端（cells/validations/filter/sort/worksheet 快照/删表/`createPivotTable`/`configurePivotTable`/`refreshPivotTable`）；`lib/api.ts` 抛 `ApiError` 与 `messageOf`。测试桩 `test/fake-backend.ts` 必须与后端同步（含删表与透视规则）。

## 关键约束

- 创建流程刷新安全：`#/new` 提交只改 hash，创建请求由编辑器发（`{id,name}` 幂等），成功后去掉 `?new=1`。
- 持久化：`$SHALLOW_DATA_DIR/workbooks.json` 经 `lib/json-store.mjs` 原子写；种子仅在文件不存在时生效，重启保留用户修改。
- 单元格权威状态（REQ-3/4）：`worksheet.cells` 只存用户输入原文（值/`=` 公式）；结果与错误由 `domain/formula.ts` 派生。
- 编辑草稿：`CellDraft.source` 区分内联框与公式栏；提交失败不改本地 workbook，网格与公式栏回落上次成功值。
- 选区：每工作表存完整矩形 `{anchor,focus}`；每手势只 PATCH 一次 `/state`；切换工作表只写 `activeWorksheetId`。
- 粘贴与区域传输：一次 `PATCH .../cells` 从选区左上角铺整矩形，空字段写 `null`；应用内剪贴板存源矩形**原文**与 `worksheetId`，`transferCells` 按偏移翻译公式。
- 撤销/重做：每次成功变更前 `recordHistory` 存 `before`/`after` 快照，撤销=PUT `before`；快照无 `validations`/`filter` 值时省略 key，故 PUT 不会误清后来创建的规则或筛选。
- 筛选（REQ-5-1-2）：只持久化 `{range, rules}`；隐藏行由 `hiddenRows` 从 `cells` 派生，不移动/删除/改写源数据，故 CSV 导出含隐藏行、`Clear filter` 恢复原值与顺序；规则随表头文本绑定、随结构变更平移。
- 校验（REQ-5-2-1）：规则只在服务端写盘前批量检查，网格/公式栏/粘贴/区域移动/排序共用同一条写路径，任一目标非法即整批拒绝；已有值不追溯失效。
- 排序（REQ-5-1-1）：`POST .../sort` 只重排所选矩形内的行（声明表头时首行不动），矩形外坐标与 `usedRows/Cols`/`validations`/`filter` 不变；按列类型（全数字/日期/文本）比较且相等键稳定；公式随记录搬移并在新坐标重算。
- 行/列结构语义：插入把落点及其后坐标平移 1（`insert-below`/`insert-right` 落点=index+1），删除丢目标并把后面拉回；`usedRows`/`usedCols` 同步增减；只改当前工作表；`=` 值改写引用（不可保留写 `#REF!`）；规则/筛选范围同批平移。
- 透视（REQ-5-3-1）：配置存于**结果工作表**的 `worksheet.pivot`（源表/源区与四个字段），结果即该表 `cells`；重算只读源表并整表替换（`usedRows/Cols` 随之刷新），错误写盘前抛出故旧结果与两表不变。字段按源区表头文本解析，缺失→400 `Pivot field is no longer available. Select a new field.`；源区结构变更同批平移 `pivot.sourceRange`，结果不变到 `Refresh pivot table`。
- 工作表身份与生命周期：名只在其工作簿内唯一；新增用最小未占用 `SheetN`（透视 `PivotN`）；`usedRows/usedCols` 只增不减（CSV 依它保留行尾空字段）；`updatedAt` 只随内容变更；前端以响应 workbook 为权威。`deleteWorksheet`（REQ-2-1-4）写盘前检查“至少保留一张表”与“无透视表仍读取本表”（`LAST_WORKSHEET_MESSAGE`/`PIVOT_DEPENDENCY_MESSAGE`），成功后同批删该表 `selections`、活动表被删时激活同位（否则末位）邻表；前端只剩一张表时不开确认框，删除失败也关确认框，均经页面 `role="alert"` 提示错误。
- ARIA 合同：网格 `role="grid"`（名 `Worksheet grid`、`aria-multiselectable="true"`），`gridcell` 名=坐标且总带 `aria-selected`，内联编辑器名 `Edit <坐标>`，表头是 `tabIndex=0` 的 div；`Data` 与标签菜单命令用 `menuitem`、下拉用 `listbox`/`option`；筛选/下拉按钮只带 aria-label；对话框内不得有与字段 label 同名的容器名；透视对话框名 `Create pivot table`，`Pivot table editor` 用具名 `<section>`、字段原生 `select`+`label`（选项名=表头文本/`SUM`/`COUNT`/`AVERAGE`）。
- `frontend/vitest.config.ts` 必须保留 `minWorkers: 1, maxWorkers: 1`。

## 必要准备

- 种子 `createSeedState()`：`Q3 Sales` 的 Sheet1 = `A1:C4`（表头 `Region/Sales/Status`，行 `East/1200/Open`、`North/800/Closed`、`South/700/Open`）；Sheet2 = 公式种子 `A1=2`/`B1=3`/`C1==A1+B1`/`D1==C1*2`。种子**不含**校验/筛选/排序/透视：均经 `Data` 菜单在选中区域创建。`frontend/src/test/fake-backend.ts` 的 `seedWorkbook()` 必须与后端同步。
- 自检：`npm --prefix frontend run build`；`ARC_EXTRA_PORTS=0 PORT=38323 npm --prefix backend run start`。
