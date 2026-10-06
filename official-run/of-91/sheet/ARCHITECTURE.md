# ARCHITECTURE

在线电子表格应用（React + Vite + TS 前端，零依赖 Node HTTP 后端）。只给定位入口与跨模块约束；字段、控件文案与用例见源码及测试。

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })`：健康检查、`/api/workbooks` REST（workbook/import 与 worksheets 的 add/rename/delete、cells/batch/selection/structure/range-transfer/state/validation-rule/filter/sort/pivot）与静态资源；`ValidationError`/`NotFoundError`→400/404，未知路径 404。
- `backend/src/lib/errors.mjs` — `ValidationError`/`NotFoundError`（`status` 即响应码）；HTTP 层从 `store/workbooks.mjs` 重新导出处导入。
- `backend/src/store/workbooks.mjs` — 权威状态与种子：`createSeedState()`、`createWorkbookStore({ dataDir })`（单元格/选区/结构/规则/过滤/排序/工作表/透视 + 错误常量），A1 辅助在 `domain/grid.mjs`。
- `backend/src/domain/structure.mjs` — `insertRow`/`deleteRow`/`insertColumn`/`deleteColumn`（cells 键位移 + 公式引用重写）、`shiftArea`/`shiftRuleRanges`/`shiftFilter`/`shiftPivot`。
- `backend/src/domain/pivot.mjs` — 透视派生纯函数：`buildPivotCells`、`defaultPivotConfig`、`nextPivotName`、`normalizePivotConfig`，以及全部用户可见消息常量。
- `backend/src/domain/sort.mjs` — 区域排序纯函数：`sortRangeCells`、`compareSortValues`、`shiftFormulaRows`、`SORT_ORDERS`；无效载荷常量 `INVALID_SORT_MESSAGE` 在 store。
- `backend/src/domain/validation.mjs` — `firstValidationError` 与对话框消息；`FILTER_CONDITIONS` 在 `domain/filter.mjs`。
- `backend/src/server.mjs` — 仅端口：PORT（默认 3000）、`platform-ports.json` 额外端口（`ARC_EXTRA_PORTS=0` 跳过）、每端口独立 `createServer`；`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` — hash 路由与唯一 `<main>`：`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` — 编辑器编排（加载/切换/新增/重命名/删除工作表、编辑/粘贴/复制/撤销/CSV/结构）：`Data` 菜单含 `Create filter`/`Clear filter`/`Sort range`/`Data validation`/`Create pivot table`；`openSort`/`applySort`、过滤、透视与历史栈见 `pages/useWorksheetHistory.ts`。
- `frontend/src/components/WorksheetGrid.tsx` — 网格 ARIA 与交互：`gridcell` 名=坐标 + `aria-selected`、行/列头右键菜单（`ROW_COMMANDS`/`COLUMN_COMMANDS`）、内联 `Edit <坐标>`、拖选、剪贴板快捷键、`Filter <表头>` 按钮（被过滤行整行不渲染）、`Open dropdown for <坐标>` 选项。
- `frontend/src/domain/formula.ts` — `computeDisplayValues(cells)`（`=` 显示计算结果与各类 `#...` 错误）；`domain/clipboard.ts` — 剪贴板解析/区域读取/`areaOfRegion`/`adjustRows`（相对引用随移动、越界 `#REF!`）。
- `frontend/src/domain/` — `validation.ts`（`findRuleForRegion`/`dropdownValues`/`RULE_TYPE_OPTIONS`）、`filter.ts`（`hiddenRows`/`emptyFilter`/`dataRegionAround`/`CONDITION_OPTIONS`）、`sort.ts`（`sortColumns`：`Sort by` 取首行表头、空则列名）、`pivot.ts`（`SUMMARIZE_OPTIONS`/`pivotFieldOptions`/`pivotFieldError`/`pivotConfigOf`）。
- `frontend/src/components/` — `WorksheetTabs.tsx`（tablist + 每表 `Worksheet options for <名>` 菜单 Rename/Delete + `Add worksheet`）、`DeleteWorksheetDialog.tsx`（`Delete worksheet` 确认，正文含目标表名与同名确认按钮）、`FormulaBar.tsx`（`Formula bar`）及 Sort/Validation/Filter/Pivot 对话框与 `PivotTableEditor.tsx`（region `Pivot table editor` + `Apply`/`Refresh pivot table`）。
- `frontend/src/lib/workbook-api.ts` — 同源 REST 客户端（含排序/透视/刷新）；`src/lib/api.ts` 是通用 JSON 请求。
- 测试：`backend/test/*.test.mjs`（按域拆分）；`frontend/src/*.test.tsx`；`src/test/fake-api.ts` 是 fetch double（不重写公式、不位移规则/过滤），结构+公式/规则端到端走真实后端。

## 关键约束

- 工作簿状态以服务端存储为唯一权威，前端只渲染返回值并经 API 修改；深链 `#/workbooks/<id>` 稳定标识同一工作簿；种子只在 `workbooks.json` 不存在时生效。
- 共享种子 `createSeedState()` 是唯一初态（`Q3 Sales`/`Sheet1` 的 `Region/Sales/Status` 与 `East/1200`、`North/800`、`South/700`，加空 `Sheet2`），增量只新增相容对象；与种子互斥的 GIVEN 片段不改种子。
- 显示名与 URL 标识符分离：id 稳定，重命名只改 `name`；非空校验在服务端。
- 单元格写入以服务端为权威、单次原子写（PATCH `/cells`、POST `/cells/batch`）；编辑先乐观更新再按最新响应收敛（`pendingCellWrites`），失败回退上次成功值并报错；公式栏与内联编辑 Enter/失焦提交、Escape 丢弃，网格显示结果而编辑器保留原始 `=` 文本。
- 选区是每工作表的视图状态（`worksheet.selection`，缺省 A1），点选/拖拽结束 PATCH `/selection`；`grid` `aria-multiselectable`，矩形内外 `gridcell` 的 `aria-selected` 为 true/false。
- 验证与过滤是每工作表状态，原子改写且不改单元格：写前按 `worksheet.validationRules` 校验，任一目标被拒即整次写失败（400、消息原样显示）；`worksheet.filter = { range, columns }` 只影响渲染（多列 AND），绝不改动或重排单元格，故 CSV 导出与透视仍读到全部记录。
- 透视表：配置存 `worksheet.pivot`（见 `domain/types.ts`），结果只写结果表 `cells`（`range` 首行表头，`Grand Total` 收尾）；创建/应用/刷新均原子写；字段失效、SUM/AVERAGE 无数值各自报错并保留上次成功结果；源表行列变更经 `shiftPivot` 移动 `range`。
- 区域转移以服务端为唯一权威、单次原子写（POST `/worksheets/:id/range-transfer`）：先校验再写目标，cut 成功后清除与目标不重叠的源格，失败则源与目标均不变；内部剪贴板仅同表可粘贴，复制公式改写只在前端。
- 排序：POST `/worksheets/:id/sort` 单次原子写、服务端权威；只重排矩形内整行记录（范围外/其他表不变，`hasHeaderRow` 首行不动），公式相对行引用随记录平移（`$` 锚定）；失败 400 网格保持原顺序；前端多格选区精确使用、单格扩为 `dataRegionAround`。
- undo/redo 栈仅会话内、按工作簿 id 隔离，恢复经 PUT `/worksheets/:id/state` 写回服务端故刷新后保持；每次成功修改后压入操作前快照并清空 redo；栈空时 `Undo`/`Redo` 原生 `disabled`。
- 行列结构以服务端为唯一权威：不做乐观位移，POST `/worksheets/:id/structure` 成功后用返回工作簿替换本地状态，失败 `role="alert"` 并保留操作前网格；公式引用随之重写，校验规则/过滤视图/读取该表的透视 `range` 也随单元格位移。
- 工作表结构：种子 `Sheet1`(有数据)/`Sheet2`(空) id 稳定；新增取首个未占用 `SheetN` 并成为 active；重命名 trim 后非空且本簿唯一；透视结果表取首个未占用 `PivotN` 并成为 active。删除（`store.deleteWorksheet`，DELETE `/worksheets/:id`）为单次原子写：至少保留一张（否则 400 `A workbook must contain at least one worksheet`），仍被其他表 pivot 引用的源表拒绝（400 `Please delete or rebuild dependent pivot tables first`，依赖由现存 pivot 的 `sourceWorksheetId` 推导，故删掉结果表即解绑）；删当前 active 时取左邻否则新首张为 active。
- `ui/Menu` 的 `aria-label=triggerLabel` 提供稳定可访问名，`triggerContent` 只作可见内容。`ui/Combobox` 以原生 select 存值：`<option>` 文本=label（`toContainText`/`selectOption` 可用），`aria-hidden` 使其不进 role 查询；展开才渲染唯一 `role=listbox`/`option`。
- CSV 导入在前端 `parseCsv` 后 POST `/api/workbooks/import`（原子写），名称=文件名去 `.csv`（空回退 `Untitled workbook`）；导出纯前端，公式导出计算结果。
