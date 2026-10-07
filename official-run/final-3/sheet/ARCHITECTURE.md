# ARCHITECTURE

在线电子表格应用（React + Vite + TS 前端，零依赖 Node HTTP 后端）。只给定位入口与跨模块约束；字段、控件文案与用例见源码及测试。

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })`：健康检查、`/api/workbooks` REST（工作表/单元格/清空/选区/结构/区域转移/规则/过滤视图/排序/透视/冻结/替换/命名范围/条件格式/单元格备注）与静态资源；`ValidationError`/`NotFoundError`→400/404，未知路径 404。
- `backend/src/lib/errors.mjs` — `ValidationError`/`NotFoundError`（`status` 即响应码）。
- `backend/src/store/workbooks.mjs` — 权威状态与种子：`createSeedState()`、`createWorkbookStore({ dataDir })`（各域变更 + 错误常量 + `ensureSeeds()` 初始化升级）；命名校验见 `normalizeName`/`normalizeWorksheetName`，A1 辅助在 `domain/grid.mjs`。
- `backend/src/store/evolution-seed.mjs` — 本轮预置簿 `EVOLUTION_WORKBOOK_SEEDS`（`EVO-*`，id=name），`mergeEvolutionSeeds`/`hasEvolutionSeeds`；新预置只追加条目。簿名/工作表名与初值以模块内容为准（`EVO-N01-*`=`ScrollLedger`、`EVO-N02-*`=`Narrative`、`EVO-N03-*`=`ForecastModel`、`EVO-N04-*`=`Signals`、`EVO-N05-NOTE-*`=`ReviewQueue`）。
- `backend/src/domain/named-ranges.mjs` — 命名范围纯校验：`namedRangeNameError`（须以字母开头，文案 `NAMED_RANGE_NAME_MESSAGE`）、`canonicalArea`（规范 `A1`/`A1:B2`）；`domain/formatting.mjs` — 条件格式规则校验 `normalizeFormatRule`（condition/style 白名单、Value 必填）。
- `backend/src/domain/find.mjs` — 整格文本匹配纯函数：`cellMatches`、`matchCoordinates`/`replacementUpdates`（行优先）；前端 `frontend/src/domain/find.ts` 是同一规则的镜像，供 “Find next” 与计数使用。
- `backend/src/domain/structure.mjs` — `insertRow`/`deleteRow`/`insertColumn`/`deleteColumn`（cells 键位移 + 公式引用重写）、`shiftArea`/`shiftRuleRanges`（校验规则与条件格式规则共用）/`shiftNamedRanges`/`shiftNotes`/`shiftFilter`/`shiftFilterViews`/`shiftPivot`。
- `backend/src/domain/pivot.mjs` — 透视派生纯函数与用户可见消息常量（`buildPivotCells`、`defaultPivotConfig`、`nextPivotName`、`normalizePivotConfig`）。
- `backend/src/domain/sort.mjs` — 区域排序纯函数：`sortRangeCells`、`compareSortValues`、`shiftFormulaRows`、`SORT_ORDERS`；无效载荷常量 `INVALID_SORT_MESSAGE` 在 store。
- `backend/src/domain/validation.mjs` — `firstValidationError` 与对话框消息；规则的 `errorMessage`（trim 后非空则替换标准措辞，见 `ruleErrorMessage`）。`FILTER_CONDITIONS` 在 `domain/filter.mjs`。
- `backend/src/server.mjs` — 仅端口：PORT（默认 3000）、`platform-ports.json` 额外端口（`ARC_EXTRA_PORTS=0` 跳过）、每端口独立 `createServer`；`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` — hash 路由与唯一 `<main>`：`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` — 编辑器编排（加载/切换/新增/重命名/删除工作表、编辑/粘贴/复制/撤销/CSV/结构/清空选区/冻结/替换/命名范围/条件格式）；`Edit`/`Insert`（“Add note”）/`View`（三项冻结，按当前选区生成）/“Data”（含 “Named ranges”）/“Format”（“Conditional formatting”）菜单、`Frozen rows: <count>; columns: <count>` 按钮、`openSort`、过滤、透视、`namedRangeResolver` 与历史栈见源码与 `pages/useWorksheetHistory.ts`。
- `frontend/src/components/FindReplaceDialog.tsx` — “Find and replace” 对话框（Find / Replace with / Match case / Find next / Replace all；消息 `Match <current> of <total>`、`Replaced <count> cells`）。
- `frontend/src/components/WorksheetGrid.tsx` — 网格 ARIA 与交互：`gridcell` 名=坐标 + `aria-selected`、行/列头右键菜单、内联 `Edit <坐标>`、拖选、剪贴板快捷键、Delete 清空当前选区矩形（`onClear`）、`Filter <表头>` 按钮（被过滤行整行不渲染）、`Open dropdown for <坐标>` 选项；`namedRanges` 传入公式查找，条件格式填充以内联 `backgroundColor` 写到匹配格。
- `frontend/src/domain/formula.ts` — `computeDisplayValues(cells, lookup?)`（`=` 显示计算结果与各类 `#...` 错误；`lookup`（`NamedRangeLookup`）把裸名称解析为命名范围坐标+所在表 cells，可跨表）；`domain/namedRanges.ts` — `namedRangeNameError`/`parseNamedRangeRange`/`namedRangeText`/`namedRangeLookup`；`domain/formatting.ts` — `FILL_STYLE_OPTIONS`（Red/Yellow/Green fill）/`FORMAT_CONDITION_OPTIONS`/`formatRuleMatches`/`conditionalFills`；`domain/clipboard.ts` — 剪贴板解析/区域读取/`areaOfRegion`/`adjustRows`/`clearRegionCells`（相对引用随移动、越界 `#REF!`）。
- `frontend/src/domain/` — 前端纯函数与选项常量：`validation.ts`（`findRuleForRegion`/`dropdownValues`）、`filter.ts`（`hiddenRows`/`dataRegionAround`）、`sort.ts`（`sortColumns`）、`pivot.ts`（`SUMMARIZE_OPTIONS`/`pivotFieldOptions`/`pivotFieldError`）。
- `frontend/src/components/` — 工作表页签、`FormulaBar`、工作表重命名/删除、Sort/Validation/Filter/Pivot 对话框、`SaveFilterViewDialog.tsx`（“Save filter view”）与 `FilterViewsDialog.tsx`（“Filter views”）及 `PivotTableEditor.tsx`；`NamedRangesDialog.tsx`（“Named ranges”/“Add named range”/Name/Range/Save/“Edit <name>”）与 `ConditionalFormattingDialog.tsx`（“Conditional formatting”/Condition/Value/Style/“Edit rule N”/“Delete rule N”）；`NoteDialog.tsx` 是单元格备注对话框（标题 `Note for <坐标>`、`Note` 文本框（真实 textarea，值即备注原文）、`Save note`，已有备注时额外 `Edit note`/`Delete note`；关闭时整体不渲染）；控件文案见源码与测试。
- `frontend/src/lib/workbook-api.ts` — 同源 REST 客户端（含排序/透视/刷新/`saveNamedRange`/`saveFormatRule`/`deleteFormatRule`）；`src/lib/api.ts` 是通用 JSON 请求。
- 测试：`backend/test/*.test.mjs`（按域拆分）；`frontend/src/*.test.tsx` + `src/domain/*.test.ts`；`src/test/fake-api.ts` 是 fetch double（不重写公式、不位移规则/过滤，但镜像命名范围与条件格式端点），结构+公式/规则端到端走真实后端。

## 关键约束

- 工作簿状态以服务端存储为唯一权威，前端只渲染返回值并经 API 修改；深链 `#/workbooks/<id>` 稳定标识同一工作簿。
- 共享种子 `createSeedState()`（`Q3 Sales` + EVO 簿）是唯一初态，增量只新增相容对象；与种子互斥的 GIVEN 片段不改种子。基线仅在 `workbooks.json` 不存在时写入，EVO 簿经 `ensureSeeds()` 按 id 幂等补种，保留旧记录/用户修改。
- 显示名与 URL 标识符分离：id 稳定，重命名只改 `name`；服务端 trim 后要求非空、≤80 字符、跨簿不区分大小写唯一，否则 400，前端保留上次成功名。
- 单元格写入以服务端为权威、单次原子写（PATCH `/cells`、POST `/cells/batch`）；编辑先乐观更新再按最新响应收敛（`pendingCellWrites`），失败回退上次成功值并报错；公式栏与内联编辑 Enter/失焦提交、Escape 丢弃，网格显示结果而编辑器保留原始 `=` 文本。
- Delete 清空当前选区矩形：POST `/worksheets/:id/cells/clear`（`{range}`）单次原子写，删除格内原始文本（公式连同表达式），依赖结果按空值重算；不写 `selection` 故选区保持，失败回滚最近一次成功值并报错。
- 选区与冻结都是每工作表的视图状态（`worksheet.selection` 缺省 A1；`worksheet.freeze = { rows, columns }` 缺省未冻结、0/0 时删除），分别经 PATCH `/selection` 与 `/freeze` 单次原子写；`grid` `aria-multiselectable`，矩形内外 `gridcell` 的 `aria-selected` 为 true/false。View 菜单三项由当前选区生成、各自只改一个轴（“Freeze panes at Xn” 即 rows-1/columns-1），顶部 `Frozen rows: <count>; columns: <count>` 按钮只展示存储值（刷新后由服务端读回）；网格按已用范围渲染行列（`usedExtent`），冻结行列 sticky 在网格滚动视口内。
- Find and replace 以“整格存储文本相等”为匹配规则（`Match case` 定大小写，公式格按提交原文，故 `Cobalt-7` 不匹配 `Cobalt`）：`Find next` 在前端按行优先选中下一匹配并持久化选区；`Replace all` 走 POST `/replace` 单次原子写（先按该表校验规则校验，任一被拒则整次不变）并返回 `replaced`；前后端同一规则故显示计数与存储改动一致。
- 验证与过滤是每工作表状态，原子改写且不改单元格：写前按 `worksheet.validationRules` 校验，任一目标被拒即整次写失败（400、消息原样显示；规则带 `errorMessage` 时用它替换标准措辞，清空即恢复）；`worksheet.filter = { range, columns }` 只影响渲染（多列 AND），不改动也不重排单元格，故 CSV 导出与透视仍读到全部记录。
- 已存过滤视图存于 `worksheet.filterViews`（`{ name, filter }[]`，criteria 独立于当前 `filter`）：PUT/DELETE `/worksheets/:id/filter-views`（DELETE 同时清空 `worksheet.filter` 恢复全部记录），名称 trim 后非空且**整簿**不区分大小写唯一（重名 400 `Filter view name already exists`）；应用视图＝以其 `filter` 调 PUT `/filter`；结构变更时视图的 `range`/列号一同位移。
- 透视表：配置存 `worksheet.pivot`，结果只写结果表 `cells`；创建/应用/刷新均原子写；字段失效、SUM/AVERAGE 无数值各自报错并保留上次成功结果；源表行列变更经 `shiftPivot` 移动 `range`。
- 区域转移以服务端为唯一权威、单次原子写（POST `/worksheets/:id/range-transfer`）：先校验再写目标，cut 成功后清除与目标不重叠的源格，失败则源与目标均不变；内部剪贴板仅同表可粘贴，复制公式改写只在前端。
- 排序：POST `/worksheets/:id/sort` 单次原子写、服务端权威；只重排矩形内整行记录（范围外/其他表不变，`hasHeaderRow` 首行不动），公式相对行引用随记录平移（`$` 锚定）；失败 400 网格保持原顺序；前端多格选区精确使用（不扩到邻接数据）。
- undo/redo 栈仅会话内、按工作簿 id 隔离，恢复经 PUT `/worksheets/:id/state` 写回服务端故刷新后保持；每次成功修改后压入操作前快照并清空 redo；栈空时 `Undo`/`Redo` 原生 `disabled`。
- 行列结构以服务端为唯一权威：不做乐观位移，POST `/worksheets/:id/structure` 成功后用返回工作簿替换本地状态，失败 `role="alert"` 并保留操作前网格；公式引用随之重写，校验规则/过滤视图/读取该表的透视 `range` 也随单元格位移。
- 工作表结构：种子 `Sheet1`(有数据)/`Sheet2`(空) id 稳定；新增取首个未占用 `SheetN` 并成为 active；重命名 trim 后非空、≤50 字符且本簿内不区分大小写唯一，失败 400 且保留旧名；透视结果表取首个未占用 `PivotN` 并成为 active。删除（`store.deleteWorksheet`，DELETE `/worksheets/:id`）为单次原子写：至少保留一张（否则 400），仍被其他表 pivot 引用的源表拒绝（400）；删当前 active 时取左邻否则新首张为 active。
- `ui/Menu` 的 `aria-label=triggerLabel` 提供稳定可访问名，`triggerContent` 只作可见内容。`ui/Combobox` 以原生 select 存值：`<option>` 文本=label（`toContainText`/`selectOption` 可用），`aria-hidden` 使其不进 role 查询；展开才渲染唯一 `role=listbox`/`option`。对话框/表单容器不要用含内部字段 label 的 `aria-label`（`getByLabel` 子串匹配会算上容器：`aria-label="Named range"` 会遮蔽 “Name”），本包两个新对话框的 `<form>` 无名称。
- 命名范围是工作簿级 `workbook.namedRanges = [{ name, worksheetId, range }]`：PUT `/api/workbooks/:id/named-ranges` 按名称（忽略大小写）upsert，重命名时随 `previousName` 一并替换；名称须以字母开头（服务端 400 与对话框同一文案），Range 存本地 A1 区、显示为 `<当前表名>!A1:B2`（worksheetId 稳定，故重命名工作表不影响公式）。公式引擎按名解析：未知名 `#NAME?`、多格名进算术 `#VALUE!`、单格名可直接参与运算。
- 条件格式规则是工作表级 `worksheet.formatRules = [{ range, condition, value, style }]`：PUT/DELETE `/api/workbooks/:id/worksheets/:id/format-rule`（带 0 基 `index` 即替换/删除，界面文案 “Edit rule N”/“Delete rule N”）；规则只派生填充、绝不写单元格，匹配格用内联 `background-color`（Red `#fee2e2`/Yellow `#fef9c3`/Green `#dcfce7`，故选中态 CSS 不覆盖）；`Greater than` 只比较可解析数字，`Text contains` 忽略大小写子串；编辑保留原 `range`，新建用打开时选区。两个新对话框保存成功后关闭，使模态期间的网格重新可操作。
- 单元格备注是工作表级 `worksheet.notes = { <坐标>: 原文 }`：PUT（`{ coordinate, text }`，空文本等于删除）/DELETE（`{ coordinate }`）`/api/workbooks/:id/worksheets/:id/note` 单次原子写，只改备注不动 `cells`，所以刷新后单元格值与备注都保持；坐标必须是合法 A1（否则 400 `Unknown cell reference`）。行列结构变更时 `shiftNotes` 让备注跟随其单元格，被删除行覆盖的备注一并消失。备注入口在网格格子内的 `Open note for <坐标>` 按钮（`aria-label` 即该名）与 `WorkbookEditorPage` 的 `Insert` → `Add note`（注解当前选区锚点，`noteTarget` 状态）。
- CSV 导入：前端 `parseCsv` 后 POST `/api/workbooks/import`（原子写），名称=文件名去 `.csv`（空回退 `Untitled workbook`）；导出纯前端、导计算结果。
