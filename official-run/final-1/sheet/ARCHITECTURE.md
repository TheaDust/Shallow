# ARCHITECTURE

在线电子表格应用（React + Vite + TS 前端，零依赖 Node HTTP 后端）。只给定位入口与跨模块约束；字段、控件文案与用例见源码及测试。

## 修改入口

- `backend/src/app.mjs` — `createRequestHandler({ dataDir, staticRoot })`：健康检查、`/api/workbooks` REST（写入端点与路径见源码）与静态资源；`ValidationError`/`NotFoundError` 的 `status` 即响应码。
- `backend/src/store/workbooks.mjs` — 权威状态、种子与全部写端点：`createSeedState()`、`createWorkbookStore({ dataDir })`、`saveNote`/`deleteNote` 等（见源码）；A1 辅助在 `domain/grid.mjs`。
- `backend/src/store/evo-seeds.mjs` — 演化场景预置 `EVO-` 工作簿；`createEvolutionSeedWorkbooks()` 按模块分组追加（N01–N05，见源码）。
- `backend/src/domain/` — `structure.mjs`（行列位移 + `shiftArea`/`shiftRuleRanges`/`shiftNotes`/`shiftFilter`/`shiftPivot` 等辅助）、`pivot.mjs`、`sort.mjs`、`validation.mjs`、`filter.mjs`、`named-ranges.mjs`、`conditional-format.mjs`。
- `backend/src/server.mjs` — 端口：PORT（默认 3000）+ `platform-ports.json` 额外端口（`ARC_EXTRA_PORTS=0` 跳过），每端口独立 `createServer`；`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` — hash 路由与唯一 `<main>`：`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` — 编辑器编排（编辑/粘贴/撤销/CSV/结构/查找替换/命名区域/条件格式/备注接线）、选区派生值与 `formulaContext`。
- `frontend/src/components/EditorToolbar.tsx` — 命令栏：Undo/Redo/Copy/Cut/Paste/Export CSV、`Edit`/`Insert`（`Add note`）/`View`/`Data`/`Format` 菜单与 `Frozen rows: <n>; columns: <n>` 按钮。
- `frontend/src/components/WorksheetTabsPanel.tsx` — 工作表标签与增删改名（切表失败回滚、重命名/删除对话框、`role=alert`）；导出 `GRID_PANEL_ID`。
- `frontend/src/components/NamedRangesDialog.tsx` / `ConditionalFormattingDialog.tsx` — 命名区域与条件格式对话框（每项 `Edit … N`）；成功后关闭，失败保留表单并 `role=alert`。
- `frontend/src/components/WorksheetGrid.tsx` — `gridcell` 名=坐标 + `aria-selected`、行/列头右键菜单、内联 `Edit <坐标>`、`Filter <表头>`、`Open dropdown for <坐标>`、`Open note for <坐标>`（仅该格有备注时）；shift 点击扩展矩形，条件格式命中时行内 `backgroundColor`；冻结两个 `role=rowgroup`，尺寸取 `usedExtent` 与默认值较大者。
- `frontend/src/components/CellNoteDialog.tsx` — `Note for <坐标>` 对话框：`Note` 文本框载备注原文、`Save note`、已有备注时的 `Edit note`/`Delete note`；`WorkbookEditorPage` 接线 `saveNote`/`deleteNote`。
- `frontend/src/domain/` — `formula.ts`（`computeDisplayValues`）、`find.ts`、`grid.ts`、`clipboard.ts`、`validation.ts`/`filter.ts`/`sort.ts`/`pivot.ts`、`named-ranges.ts`、`conditional.ts`（`conditionalFill`）、`types.ts`。
- 测试：`backend/test/*.test.mjs`、`frontend/src/*.test.tsx`；`frontend/src/test/` 镜像 EVO 预置与 API 校验。

## 关键约束

- 工作簿状态以服务端存储为唯一权威，前端只渲染返回值并经 API 修改；深链 `#/workbooks/<id>` 稳定标识工作簿；共享种子 `createSeedState()`（`Q3 Sales` 两张表）只在 `workbooks.json` 不存在时生效，演化场景各用独立预置 `EVO-` 工作簿（id/单元格见 `evo-seeds.mjs`）。
- 显示名与 URL 标识符分离：id 稳定，重命名只改 `name`；`updateWorkbook`/`renameWorksheet` trim 后要求非空、长度上限（80/50）且跨簿/簿内不区分大小写唯一，拒绝不写入，故标题/首页链接/预填保持上次成功名。
- 单元格写入为单次原子写（PATCH `/cells`、POST `/cells/batch`、`/cells/replace`）；编辑先乐观更新再按最新响应收敛（`pendingCellWrites`），失败回退上次成功值；网格显示公式结果而编辑器保留 `=` 原文。Delete 清空写等宽空矩形：只改单元格、不动选区，失败回退并保持依赖公式。
- 选区与冻结窗格是每工作表的视图状态（`worksheet.selection`、`worksheet.freeze`；缺省 A1 与 0+0，全 0 时删除 `freeze`，都不改 `updatedAt`）：点选/拖拽/shift 点击结束 PATCH `/selection`，`View` 菜单 PUT `/freeze`。
- 查找替换以显示值整格相等为准（`Cobalt` 不匹配 `Cobalt-7`），未勾 `Match case` 时忽略大小写；`Find next` 取选区之后第一个匹配（回绕）并只移动选区，`Replace all` 为一次 POST `/cells/replace` 原子写（任一被拒则整次不改）。
- 验证/过滤/保存的过滤视图：写前按 `worksheet.validationRules` 校验，任一目标被拒即整次写失败（400 原样显示消息，规则 `message` 非空时替换标准消息）；`worksheet.filter` 只影响渲染，CSV 导出与透视仍读到全部记录；`workbook.filterViews` 名簿内不区分大小写唯一，apply 替换该表 filter，delete 同一原子写删视图并清 filter，结构变更经 `shiftFilter` 同步。
- 透视表：配置存 `worksheet.pivot`，结果只写结果表 `cells`；创建/应用/刷新均原子写；字段失效或 SUM/AVERAGE 无数值时报错并保留上次成功结果；源表结构变更经 `shiftPivot` 移动。
- 区域转移（POST `/range-transfer`）单次原子写：先校验再写目标，cut 清除与目标不重叠的源格，失败不变；内部剪贴板仅同表可粘贴。
- 排序（POST `/sort`）单次原子写：只重排矩形内整行记录，公式相对行引用随记录平移（`$` 锚定）；失败 400 保持原顺序；单格选区扩为 `dataRegionAround`。
- undo/redo 栈仅会话内、按工作簿 id 隔离，恢复经 PUT `/worksheets/:id/state` 写回服务端故刷新后保持；每次成功修改压入操作前快照并清空 redo。
- 行列结构不做乐观位移：POST `/structure` 成功后用返回工作簿替换本地状态，失败 `role="alert"` 并保留操作前网格；公式引用/校验规则/条件格式/过滤视图/命名区域/备注/引用该表的透视随 `structure.mjs` 位移。工作表新增取首个未占用 `SheetN`，透视结果表取 `PivotN`；删除原子写且至少保留一张，仍被 pivot 引用的源表拒绝。
- 命名区域是每工作簿状态（`workbook.namedRanges` `{id,name,range}`）：名字 trim 后须以字母开头（否则 400），簿内不区分大小写唯一（同名且无 id 的保存更新该条，改到别的名字上 400）；range 规范成 `Sheet!A1:B2`（无前缀按当前表），带 `id` 保留身份。公式引擎经 `FormulaContext.namedRanges` 把名字当区域引用（`Sheet!` 查 `context.sheets`），改范围后依赖公式立即重算，原始 `=` 文本不变。
- 条件格式是每工作表状态（`worksheet.conditionalFormats` `{id,range,condition,value,style}`）：`style` 仅存 `Red fill`/`Yellow fill`/`Green fill`，颜色与匹配在前端 `domain/conditional.ts`（`Greater than` 只认可解析数字，`Text contains` 不区分大小写）；命中单元格的行内 `backgroundColor` 覆盖选中底色；PUT 带 `id` 替换该条，DELETE 按 `id` 删除，均原子写且不改单元格。
- 单元格备注是每工作表的标注状态（`worksheet.notes` 坐标→文本），与 `cells` 分开：保存/删除不改单元格值与公式结果，服务端单次原子写 upsert/删除（空文本 400），结构变更经 `shiftNotes` 随单元格移动、被删行的备注消失；`Open note for <坐标>` 按钮与对话框都读这份权威状态，刷新后保持。
- `ui/Menu` 的 `aria-label=triggerLabel` 是稳定可访问名；`ui/Combobox` 用原生 select 存值，展开才渲染唯一 `role=listbox`/`option`。新增对话框表单不带 aria-label：容器名含字段名会让 `getByLabel` 同时命中容器与字段；备注对话框不渲染与文本框同文的第二节点。
- CSV 导入 POST `/api/workbooks/import`（原子写，名称=文件名去 `.csv`）；导出纯前端、公式导出结果。
