# ARCHITECTURE

在线电子表格（React + Vite + TS + 零依赖 Node HTTP）。只给定位入口与跨模块约束；细节见源码。

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })`：健康检查、`/api/workbooks` REST（子路由见正则，含 `named-ranges`、`worksheets/:id/conditional-formats` 与 `worksheets/:id/notes`）与静态资源；`ValidationError`/`NotFoundError`（`lib/errors.mjs`，`status` 即响应码）→400/404。
- `backend/src/store/workbooks.mjs` — 权威状态与种子：`createSeedState()`、`mergeSeedWorkbooks(state)`（按稳定 id 补种各轮 `EVO-M0*`/`EVO-N0*` 场景种子，含备注场景 `EVO-N05-NOTE-*`）、`createWorkbookStore({ dataDir })`（单元格/选区/结构/规则/过滤/过滤视图/排序/冻结/替换/工作表/透视/命名范围/条件格式/单元格备注：`saveNote`/`deleteNote` + 错误常量）。
- `backend/src/domain/` — `structure.mjs`（`insertRow`/`deleteRow`/`insertColumn`/`deleteColumn`、`shiftArea`/`shiftRuleRanges`/`shiftFilter`/`shiftPivot`）、`notes.mjs`（`normalizeNoteCoordinate`/`normalizeNoteText`/`shiftNotes`）、`named-range.mjs`（`normalizeNamedRangeName`/`normalizeNamedRangeReference`/`shiftNamedRanges`）、`conditional-format.mjs`（`normalizeConditionalFormat`/`shiftConditionalFormats`）、`pivot.mjs`（`buildPivotCells`/`defaultPivotConfig`/`nextPivotName`）、`sort.mjs`（`sortRangeCells`/`SORT_ORDERS`）、`validation.mjs`（`firstValidationError`、标准拒绝文案、`customErrorMessage`）、`filter.mjs`（`FILTER_CONDITIONS`）。
- `backend/src/server.mjs` — 端口：PORT（默认 3000）、`platform-ports.json` 额外端口（`ARC_EXTRA_PORTS=0` 跳过）、每端口独立 `createServer`；`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` — hash 路由与唯一 `<main>`：`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` — 编辑器编排（工作表增删改名、编辑/清除/粘贴/复制/撤销/CSV/结构、Edit/Insert/View/Data/Format 菜单功能，经 `components/EditorToolbar.tsx` 与 `components/ReferenceFormattingDialogs.tsx` 装配）：`clearSelection`、`createFilter`、`saveActiveFilterView`、`applySavedFilterView`、`removeSavedFilterView`、`openSort`、`applyFreeze`、`replaceAllInActiveWorksheet`、`saveCellNote`/`deleteCellNote`（`noteCoordinate` 决定备注对话框的单元格）、`displayValuesFor`（带命名范围）；历史栈见 `pages/useWorksheetHistory.ts`。
- `frontend/src/components/WorksheetGrid.tsx` — 网格 ARIA 与交互：`gridcell` 名=坐标 + `aria-selected`、条件格式填充（inline `backgroundColor`）、备注标记按钮 `Open note for <坐标>`（`aria-label`，无文字）、渲染范围随用量/规则区域/备注坐标扩展、行列头右键菜单、内联 `Edit <坐标>`、拖选与 `Delete`、`Filter <表头>`（过滤行不渲染）、`Open dropdown for <坐标>`、冻结标记 `paneClasses`。
- `frontend/src/domain/` — `formula.ts`（`computeDisplayValues`：结果与 `#...` 错误，`options.names` 解析命名范围）、`named-range.ts`（`parseNamedRangeReference`/`namedRangeBindings`）、`conditional-format.ts`（`STYLE_FILLS`/`conditionalFormatMatches`/`conditionalFormatFills`），以及 clipboard/csv/grid/validation/filter/sort/pivot/find（细节见源码）。
- `frontend/src/components/` — `WorksheetTabs.tsx`、重命名/删除与 Sort/Validation/Filter/Pivot 对话框、`NamedRangesDialog.tsx` + `ConditionalFormattingDialog.tsx`（既列表又表单，保存成功后关闭）、`NoteDialog.tsx`（名 `Note for <坐标>`：`Note` 文本框 + `Save note`，已有备注才多出 `Edit note`/`Delete note`；保存/删除成功关闭）、`SaveFilterViewDialog.tsx`/`FilterViewsDialog.tsx`、`FindReplaceDialog.tsx`（Edit 菜单）、`FormulaBar.tsx`、`PivotTableEditor.tsx`；`EditorToolbar.tsx` 的 `Insert` 菜单只有 `Add note`。
- `frontend/src/lib/workbook-api.ts` — 同源 REST 客户端（含 freeze/filter-views/replace/named-ranges/conditional-formats/notes）；`lib/api.ts` 通用 JSON 请求。
- 测试：`backend/test/*.test.mjs`、`frontend/src/*.test.tsx`；`src/test/fake-api.ts` 是 fetch double（镜像端点合同与文案），结构+公式/规则端到端走真实后端。

## 关键约束

- 工作簿状态以服务端存储为唯一权威，前端只渲染返回值并经 API 修改；深链 `#/workbooks/<id>` 稳定标识同一工作簿（重命名不改 id，刷新仍可进入）。
- 共享种子 `createSeedState()` 是唯一初态（`Q3 Sales` 两表），增量只新增相容对象，互斥的 GIVEN 片段不改种子。空存储整体播种；已有 `workbooks.json` 每次建 store 由 `mergeSeedWorkbooks` 按 id 幂等补种，保留旧记录与用户改名，重复启动不重复。
- 重命名（PATCH `/api/workbooks/:id` → `normalizeName`）：trim 后非空、≤80 字符、跨全部工作簿大小写不敏感唯一（排除自身）；被拒后保持上次成功名称。
- 单元格写入单次原子写（PATCH `cells`、POST `cells/batch`）；编辑先乐观更新再按响应收敛（`pendingCellWrites`），失败回退上次成功值并报错；公式栏与内联编辑 Enter/失焦提交、Escape 丢弃，网格显示结果而编辑器保留原始 `=` 文本。
- 选区是每工作表视图状态（`worksheet.selection` 缺省 A1），点选/拖拽结束 PATCH `/selection`；`grid` `aria-multiselectable`，矩形内外 `gridcell` 的 `aria-selected` 为 true/false。
- 冻结窗格是每工作表视图状态 `worksheet.frozen = { rows, columns }`，经 PUT `/worksheets/:id/freeze` 原子写（0/0 删字段），不改单元格；`View` 菜单三项标签随当前选区（`Freeze rows through <行号>`/`Freeze columns through <列名>`/`Freeze panes at <坐标>`），`Frozen rows: <n>; columns: <n>` 按钮先乐观更新再按响应收敛，冻结区标记见 `styles.css` 的 `is-frozen-*`。
- 查找替换按活动工作表的**显示值**整体相等匹配（`domain/find.ts`；公式取计算结果，`Match case` 控制大小写）：`Find next` 从打开对话框时的选区起按行列顺序前进并回绕，选中结果经 `/selection` 持久化；`Replace all` 把匹配坐标与替换文本一次性 POST `/worksheets/:id/cells/replace`（复用 `firstValidationError`，任一目标被拒即整次 400 且单元格不变，计数只在成功后显示）。
- 验证与过滤是每工作表状态，原子改写且不改单元格：写前按 `worksheet.validationRules` 校验，任一目标被拒即整次写失败（400、消息原样显示）；规则 `errorMessage`（trim 后非空才存）替换各写入路径的标准文案。`worksheet.filter` 只影响渲染（多列 AND），不改动或重排单元格，CSV 导出与透视仍读到全部记录。
- 已保存过滤视图存 `worksheet.filterViews = [{ id, name, range, columns }]`（API 见 `app.mjs` 的 `filter-views` 路由）：名字 trim 后非空且跨全工作簿大小写不敏感唯一；`saveFilterView` 复制当前 `filter`（无过滤器 400），`applyFilterView` 覆盖当前 filter 而不改视图，`deleteFilterView` 删视图并清当前 filter；结构变更经 `shiftFilter` 移动视图，前端 `appliedFilterView` 由当前 filter 反查选中视图。
- 显示名与 URL 标识符分离：id 稳定（种子中即名称），重命名只改 `name`。
- 透视表：配置存 `worksheet.pivot`，结果只写结果表 `cells`；创建/应用/刷新均原子写；字段失效或无数值各自报错并保留上次成功结果；源表行列变更经 `shiftPivot` 移 `range`。
- 区域转移单次原子写（POST `/worksheets/:id/range-transfer`）：先校验再写目标，cut 成功后清除与目标不重叠的源格，失败两者均不变；内部剪贴板仅同表可粘贴。
- 排序：POST `/worksheets/:id/sort` 单次原子写；只重排矩形内整行记录（范围外/其他表与 `hasHeaderRow` 首行不动），公式相对行引用随记录平移（`$` 锚定）；失败 400 网格保持原顺序；单格选区扩为 `dataRegionAround`。
- undo/redo 栈仅会话内、按工作簿 id 隔离，经 PUT `/worksheets/:id/state` 写回服务端故刷新后保持；每次成功修改压入操作前快照并清空 redo；栈空时 `Undo`/`Redo` 原生 `disabled`。
- 行列结构不做乐观位移：POST `/worksheets/:id/structure` 成功后用返回工作簿替换本地状态，失败 `role="alert"` 并保留操作前网格；公式引用、校验规则、过滤视图、读取该表的透视 `range` 随单元格位移。
- 工作表结构（常量在 store）：种子表 id 稳定；新增工作表/透视结果表取首个未占用 `SheetN`/`PivotN` 并成为 active；重命名 trim 后非空、≤50 字符、本簿内大小写不敏感唯一；`deleteWorksheet` 单次原子写，至少留一张、仍被 pivot 引用作源的表拒绝，删 active 取左邻否则首张。
- `ui/Menu` 的 `aria-label=triggerLabel` 是稳定可访问名；`ui/Combobox` 以原生 select 存值（`<option>` 文本=label，展开才渲染 `role=listbox`/`option`）；`ui/Dialog` 关闭时卸载标题/内容/操作，各对话框在 open 时重置表单（`wasOpen`）。
- CSV 导入在前端 `parseCsv` 后 POST `/api/workbooks/import`（原子写），名称=文件名去 `.csv`；导出纯前端，公式导出计算结果。
- 命名范围是工作簿级 `workbook.namedRanges = [{ id, name, range }]`，`range` 保留 `Sheet!A1:B2` 限定（`domain/named-range.mjs` 规范化，`$` 去掉）：名字 trim 后须以字母开头（文案「Named range must start with a letter」），同名（忽略大小写）拒绝，PUT 按 id 原地替换。前端 `namedRangeBindings(workbook, worksheet)` 把名字解析为对应工作表 cells，交给 `computeDisplayValues(cells, { names })`；限定表不存在时名字不绑定（公式显示 `#NAME?`），不静默指向别的表。行列结构变更经 `shiftNamedRanges` 让指向该表的名字跟随（整段被删则删除）。
- 条件格式是每工作表 `worksheet.conditionalFormats = [{ id, range, condition, value, style }]`，只决定外观不写单元格：`Greater than` 比较可解析数值，`Text contains` 做不区分大小写包含；`STYLE_FILLS`（Red `#fee2e2`／Yellow `#fef9c3`／Green `#dcfce7`）经 `conditionalFormatFills(值, 规则)` 变 inline `backgroundColor`（同区多条后者覆盖）。PUT 按 id 原地替换、DELETE 删除；`shiftConditionalFormats` 随行列变更移动区域、被删行覆盖则删除。两对话框保存成功后关闭（失败保留表单与文案），管理列表在重开后重新读取。
- 单元格备注是每工作表 `worksheet.notes = { <坐标>: 文本 }`，与 `cells` 分开存储：保存/编辑/删除都不改单元格值与公式结果，文本原样保留（仅全空白拒绝）。API、坐标与文本规范化经 `domain/notes.mjs`（`Invalid cell note`/`Note text cannot be empty`），单次原子写；行列结构变更经 `shiftNotes` 让备注跟随其单元格、被删行覆盖则删除。前端 `Insert` 菜单的 `Add note` 与单元格按钮 `Open note for <坐标>` 走同一 `NoteDialog`（`Note` 文本框 + `Save note`），仅已有备注才出现 `Edit note`/`Delete note`；成功保存/删除后关闭对话框并由服务端返回值重绘按钮。
