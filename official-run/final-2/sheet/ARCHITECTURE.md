# ARCHITECTURE

React + Vite + TS 前端 + 零依赖 Node HTTP 后端。定位入口与跨模块约束；字段与文案见源码。

## 修改入口
- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })`：健康检查、`/api/workbooks` REST（子路由与载荷见 `handleApi`）与静态资源；未知路径 404。
- `backend/src/store/workbooks.mjs` — 权威状态与种子：`createSeedState()`、`createWorkbookStore({ dataDir })`（各域原子操作与消息常量；错误类型见 `lib/errors.mjs`，A1 辅助见 `domain/grid.mjs`）。
- `backend/src/domain/` — 纯域函数与用户可见消息：`structure.mjs`（`shiftArea`/`shiftRuleRanges`/`shiftFilter`/`shiftPivot`/`shiftNotes` + 公式重写）、`validation.mjs`、`named-ranges.mjs`、`conditional.mjs`、`pivot.mjs`、`sort.mjs`、`filter.mjs`。
- `backend/src/server.mjs` — 仅端口：PORT（默认 3000）、`platform-ports.json` 额外端口（`ARC_EXTRA_PORTS=0` 跳过）、每端口独立 `createServer`；`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` — hash 路由与唯一 `<main>`：`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` — 编辑器编排与全部对话框开关（编辑/剪贴板/撤销/结构/冻结/查找替换/批注）；`formulaScope()`/`displayValues()` 供全页计算，历史栈见 `pages/useWorksheetHistory.ts`。
- `frontend/src/components/EditorToolbar.tsx` — 命令栏片段：Undo/Redo/Copy/Cut/Paste/Export CSV、`Frozen rows: n; columns: n` 与 `Edit`/`Insert`(`Add note`)/`View`/`Data`/`Format` 菜单。
- `frontend/src/components/WorkbookEditorDialogs.tsx` — 按功能分组 props（`rename`/`findReplace`/`pivot`/`validation`/`namedRanges`/`conditional`/`note`/`filter`/`saveFilterView`/`filterViews`/`sort`/`renameWorksheet`/`deleteWorksheet`）组合编辑器全部对话框。
- `frontend/src/components/CellNoteDialog.tsx` — 批注对话框（`Note for <坐标>`）；网格里的批注入口是 `WorksheetGrid.tsx` 的 `onOpenNote`。
- `frontend/src/components/WorksheetGrid.tsx` — 网格 ARIA 与交互：`gridcell` 名=坐标+`aria-selected`、行列头菜单、内联编辑、拖选/Shift 扩选、Delete/剪贴板快捷键、单元格内 `Filter <表头>`/`Open dropdown for <坐标>`/`Open note for <坐标>` 按钮、每行 `.worksheet-grid__record`；行列数取 `usedExtent` 与默认值较大者。
- `frontend/src/domain/` 与 `lib/workbook-api.ts` — 前端派生与同源 REST：`formula.ts` 的 `computeDisplayValues(cells, scope)`（`FormulaScope`=`sheetName`+`namedRanges`+`worksheetCells`）与 `conditional.ts`/`validation.ts`/`filter.ts`/`sort.ts`/`pivot.ts`/`freeze.ts`/`find.ts` 等各域派生模块；`lib/api.ts` 为通用 JSON 请求。
- `frontend/src/components/` 其余 — `WorksheetTabs.tsx`（`Worksheet options for <名>`/`Add worksheet`）、`FormulaBar.tsx`、`FindReplaceDialog.tsx`、`FilterViewsDialog.tsx`、`PivotTableEditor.tsx`、`NamedRangesDialog.tsx`、`ConditionalFormattingDialog.tsx`。
- 测试：`backend/test/*.test.mjs`、`frontend/src/*.test.tsx`；`src/test/fake-api.ts` 是 fetch double（不重写公式/位移），结构/公式端到端走真实后端。
## 关键约束

- 工作簿状态以服务端存储为唯一权威；深链 `#/workbooks/<id>` 稳定标识同一工作簿；种子仅在 `workbooks.json` 缺失时生效。
- 共享种子 `createSeedState()` 是唯一初态；`EVO-*` 各场景一张工作表、`updatedAt` 早于基线（首页先列 `Q3 Sales`）：`m01`~`m05`、`n01`~`n05` 共 31 张，表名与初值见源码（编辑类场景自带规则或批注），`fake-api.ts` 镜像同一批。
- 名称规则以服务端为准（`store.normalizeName`/`normalizeWorksheetName`）：trim 非空，工作簿 ≤80 且跨簿忽略大小写唯一、工作表 ≤50 且本簿唯一。
- 命名区域存工作簿级 `workbook.namedRanges=[{name,range}]`（`range`=`表名!A1:B2`）：PUT `/api/workbooks/:id/named-ranges` 按名 upsert，非法名/未知表/非法区域 400 且不改单元格；公式经 `FormulaScope` 当区域引用，故改区域即重算。
- 条件格式存每工作表 `worksheet.conditionalRules=[{range,condition,value,style}]`：POST 追加 / PUT `index`(0 基) 替换 / DELETE 按 index 删，单次原子写、不改单元格；填充为前端派生（先命中者胜，`conditionalFills` 写 `gridcell` 内联 `background-color`），行列变更经 `shiftRuleRanges` 随单元格位移。
- 批注存每工作表 `worksheet.notes`（A1→文本，缺省无）：PUT/DELETE `/api/workbooks/:id/worksheets/:id/notes`（body `coordinate`(+`text`)）单次原子写、从不改 `cells`，空文本 400；有批注的单元格画无文本的 `Open note for <坐标>` 按钮，原文只在 `Note for <坐标>` 对话框里显示；行列变更经 `shiftNotes` 随单元格移动。
- 单元格写入以服务端为权威、单次原子写（PATCH `/cells`、POST `/cells/batch`）：编辑乐观更新后按响应收敛（`pendingCellWrites`），失败回退并报错；公式栏与内联编辑 Enter/失焦提交、Escape 丢弃；网格显示计算结果、`=` 原文留在编辑器；Delete 清空选区矩形。
- 选区是每工作表的视图状态（`worksheet.selection`，缺省 A1），点选/拖拽结束 PATCH `/selection`；`grid` `aria-multiselectable`，矩形内外 `gridcell` 的 `aria-selected` = true/false。
- 冻结窗格是每工作表视图状态 `worksheet.freeze={rows,columns}`（全 0 删字段，不动 `updatedAt`）：PATCH `/worksheets/:id/freeze` 校验非负整数，乐观应用后按响应收敛、失败回退。
- 查找替换：前端按显示值整格相等匹配（公式格比计算结果）；命中后 POST `/worksheets/:id/replace` 以 `updates` 单次原子写（写前过校验规则，任一被拒即整批失败）。
- 验证与过滤是每工作表状态、原子写且不改单元格：写前按 `worksheet.validationRules` 校验，任一目标被拒即整次写失败（400），规则非空 `errorMessage` 替掉默认消息；`worksheet.filter` 只影响渲染（多列 AND），CSV 导出与透视仍读全部记录。
- 过滤视图存 `workbook.filterViews`（`{ name, filter }` 副本，`worksheet.filterViewName` 记来源）：POST/PUT/DELETE `/api/workbooks/:id/filter-views` 存取删，原子写、失败保留原状态，criteria 随行列位移。
- 透视表：配置存 `worksheet.pivot`，结果只写结果表 `cells`；创建/应用/刷新原子写；字段失效或无数值报错并保留上次结果；源表行列变更经 `shiftPivot` 移 `range`。
- 排序（POST `…/sort`）与区域转移（`…/range-transfer`）各为单次原子写：转移先校验再写目标、cut 额外清源，失败两边不变；排序只重排矩形内整行记录（`hasHeaderRow` 首行不动），公式行引用随平移（`$`）。
- undo/redo 栈仅会话内、按工作簿 id 隔离，恢复经 PUT `/worksheets/:id/state` 写回服务端故刷新后保持；每次成功修改压入操作前快照并清空 redo；空栈时 `Undo`/`Redo` disabled；命名区域、条件规则与批注不进快照。
- 行列结构以服务端为唯一权威：不做乐观位移，POST `/worksheets/:id/structure` 成功后用返回工作簿替换本地状态，失败 `role="alert"` 保留原网格；公式引用、校验与条件规则、批注、过滤视图与该表透视 `range` 随之位移。
- 工作表生命周期：种子 `Sheet1`/`Sheet2` id 稳定；新增取首个未占用 `SheetN`、透视结果表取 `PivotN` 并成为 active；删除（DELETE `/worksheets/:id`）原子写、至少留一张，被 pivot 引用的源表拒绝，删 active 取左邻否则新首张。
- `ui/Menu` 以 `aria-label=triggerLabel` 提供稳定可访问名；`ui/Combobox` 用原生 select 存值（`<option>` 文本=label 便于 `selectOption`，`aria-hidden` 不进 role 查询），展开才渲染唯一 `role=listbox`/`option`。
- CSV 导入：前端 `parseCsv` 后 POST `/api/workbooks/import`（原子写），名称=文件名去 `.csv`；导出纯前端、公式导结果。
