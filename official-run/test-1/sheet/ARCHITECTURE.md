# 项目架构笔记

## 技术选型与理由

- 前端：React 18.3.1 + Vite 5.4.19 + TypeScript 5.6.3，精确钉版本并提交 package-lock。路由为手写 hash 路由（`#/`、`#/new`、`#/workbook/:id`），不引入路由库；前端通过同源相对路径 `/api/...` 调用后端。
- 后端：零依赖原生 `node:http`（ESM），JSON 文件持久化；静态服务 `backend/../frontend/dist`（基于服务端文件位置解析，不依赖工作目录）。
- 测试：前端 Vitest 2.1.9 + @testing-library/react（jsdom，`--maxWorkers=1` 下需 `poolOptions.forks.minForks: 1`）；后端 node:test。

## 模块与入口

- `frontend/src/main.tsx` → `App.tsx`：hash 路由分发（`parseHash`）。
- `frontend/src/pages/HomePage.tsx`：工作簿列表（记录 = 名称为可访问名的 `<a>` + `Last updated: <值>`）+ `New blank workbook` 按钮 + `Import CSV` 按钮（打开 `ImportCsvDialog`）。
- `frontend/src/components/ImportCsvDialog.tsx`：对话框（`aria-label="Import CSV"`），含 label `CSV file` 的文件控件与 `Confirm import` 按钮；成功导入后跳转 `#/workbook/:id`。
- `frontend/src/pages/CreatePage.tsx`：创建页，提交按钮 `Create`，成功后进入 `#/workbook/:id`。
- `frontend/src/pages/EditorPage.tsx`：编辑器（标题 + `Rename workbook`/`Export CSV` 按钮 + `Last updated:` + tab 栏 + `Formula bar` 文本框 + 网格）。URL `#/workbook/:id` 可直接访问，刷新恢复同一工作簿。工作表增删/重命名状态由服务端返回的完整 workbook 驱动。公式栏可编辑：Enter/点击另一格提交，Escape 取消，失焦提交（pendingRef 记录目标格，避免 blur/click 重复提交）；提交失败显示 alert 并保持上次成功值。每个工作表的矩形选区（REQ-3-1-3）由本地 selection 状态 + 服务端 `sheet.selection` 持久化，切换工作表恢复各自选区。REQ-3-2-1 内部剪贴板为会话级 ref（`{operation: copy|cut, sourceSheetId, source:{current,end}}`）：Ctrl+C/Ctrl+X（焦点不在 input/textarea 时）与右键菜单 `Copy`/`Cut` 写入，Ctrl+V/右键 `Paste` 优先走同表 `transferCells` API（跨表剪贴板不生效，即仅同表操作），cut 成功后清空剪贴板，copy 可重复粘贴；失败保持源与目标原值。
- `frontend/src/components/WorkbookGrid.tsx`：ARIA grid（可访问名 `Worksheet grid`，`aria-multiselectable=true`）；gridcell 以坐标命名（A1…），选中矩形区域内 `aria-selected=true`、区域外 `false`；`columnLabel`/`isInRegion` 为纯函数（见 `coords.ts`）。默认网格 20 列（A–T）× 50 行，按工作表声明的 `rowCount/columnCount` 扩展。左键 mousedown 起始、mouseover 扩展、mouseup 提交的拖拽选区；拖拽后抑制随后的 click；双击格渲染行内文本框（`aria-label="Edit <坐标>"`，Enter 提交/Escape 取消/失焦提交）。行号 `role=rowheader`+十进制数字可访问名，列头 `role=columnheader`+列字母；右键行号打开含 `Insert 1 row above`/`Insert 1 row below`/`Delete row` 三个 menuitem 的菜单，右键列头打开含 `Insert 1 column left`/`Insert 1 column right`/`Delete column` 三个 menuitem 的菜单（均复用 `WorksheetMenu`，`.row-header-cell`/`.column-header-cell` 为 sticky 锚点）；右键 gridcell 打开含 `Cut`/`Copy`/`Paste` 三个 menuitem 的单元格上下文菜单（REQ-3-1-2 Paste / REQ-3-2-1 Copy/Cut，`.cell-menu-anchor` 绝对定位于 `.grid-scroll` 内，滚动偏移已计入）。右键点击位于当前选区内的格时保持完整选区作为复制/剪切源，选区外的格则先选中该格。
- `frontend/src/components/SheetTabs.tsx`：`role=tab` 的 worksheet 标签（活动页 `aria-selected=true`）；每个 tab 附带 `Worksheet options for <name>` 按钮（aria-haspopup/expanded，打开含 `Rename` menuitem 的 `role=menu`，键盘方向键/Escape 导航）；tab 栏末尾 `Add worksheet` 按钮（aria-label，图标 +）。
- `frontend/src/components/WorksheetMenu.tsx`：tab 选项下拉菜单（`role=menu` + `role=menuitem`，含点击遮罩与键盘行为）。
- `frontend/src/components/RenameSheetDialog.tsx`：对话框（aria-label/h2 `Rename worksheet`），label `Worksheet name` 预填当前名，`Save`/`Cancel`；400 错误显示服务端消息并保持原名。
- `frontend/src/components/RenameDialog.tsx`：对话框（`aria-label="Rename workbook"`），含 label `Workbook name` 输入与 `Save`。
- `frontend/src/api.ts`（fetch 封装，错误带服务端 message）、`frontend/src/types.ts`（领域类型）、`frontend/src/format.ts`（`formatLastUpdated`）。
- `frontend/src/coords.ts`：坐标助手（`columnLabel`/`columnNumber`/`cellCoordinate`/`isInRegion`），WorkbookGrid 重导出；后端镜像 `backend/src/coords.js`。
- `frontend/src/structure.ts`（后端镜像 `backend/src/structure.js`）：行结构纯函数——`shiftRowNumber`（insert-above 行≥目标下移 1、insert-below 行>目标下移 1、delete 目标行移除且行>目标上移 1，指向被删行的引用得 `#REF!`）、`adjustCellRefs`（公式文本中 A1 式引用随行移位）、`shiftCells`→`{cells,maxRow}`、`shiftCoordinateRow`（activeCell 随行移位，被删行坐标保留）；列结构纯函数（REQ-2-2-2）——`COLUMN_ACTIONS`（insert-left/insert-right/delete，目标为 1 基列号）、`shiftColumnNumber`/`shiftColumnLabel`（insert-left 列≥目标右移 1、insert-right 列>目标右移 1、delete 目标列移除且列>目标左移 1，指向被删列的引用得 `#REF!`）、`adjustCellRefsColumn`、`shiftCellsColumn`→`{cells,maxCol}`、`shiftCoordinateColumn`（activeCell 随列移位，被删列坐标保留）。
- `frontend/src/csv.ts`：CSV 纯函数——`parseCsv`（与后端语义一致，供 apiMock 复用）、`usedRange`/`sheetToCsv`/`toCsvText`（导出当前活动工作表）、`downloadCsv`（Blob + `<a download>` 触发浏览器下载，文件名以 `.csv` 结尾）。`sheetToCsv` 通过 `formula.displayValue` 导出显示值（公式格导出计算结果）。
- `frontend/src/formula.ts`：公式求值（REQ-3-1-1 公式格 / REQ-4-1-1 语言）——数字常量、括号、`+ - * /`（含一元）、A1 引用、`SUM/AVERAGE/COUNT/MIN/MAX`（大小写不敏感，范围 `A1:B2` 或值列表；聚合忽略空白/文本，COUNT 仅数字，SUM/AVERAGE/MIN/MAX 仅数字不把空当 0）；直接引用文本格原样返回；算术遇文本 `#ERROR!`、除零 `#DIV/0!`、循环引用 `#ERROR!`、错误字面量（`#REF!` 等）透传、聚合范围含错误格则传播。`displayValue`/`computeDisplayCells` 由 EditorPage 的 useMemo（依赖 workbook/activeSheet）计算，网格渲染显示值、公式栏显示原始文本。
- `frontend/src/paste.ts`（后端镜像 `backend/src/paste.js`）：`parsePasteText`（Tab 列 + 换行行、保留空字段、忽略结尾换行的空行）+ `pasteStartCoord(selection)`（取当前选区左上角为粘贴起点）。EditorPage 注册 document 级 `paste` 监听（目标在 input/textarea/contenteditable 内时放行原生粘贴）；Ctrl+V 与网格右键菜单 `Paste` menuitem（ARIA menuitem，可访问名 `Paste`，右键格同时选中该格）走同一 `pasteCells` API；菜单 Paste 优先 `navigator.clipboard.readText()`，回退到最近一次 paste 事件捕获的文本，空剪贴板报错。
- `frontend/src/transfer.ts`（后端镜像 `backend/src/transfer.js`）：REQ-3-2-1 范围转移纯函数——`normalizeRect`（{current,end}→1 基矩形 bounds + topLeft/bottomRight，非法返回 null）、`adjustFormulaRefs`（公式文本按 (deltaCol,deltaRow) 调整 A1 引用：相对部分随偏移、`$A$1` 绝对部分不变、越界引用变 `#REF!`）、`applyRangeTransfer`（copy 保持源、cut 先写目标再清源、目标与源重叠时保留已写入的源坐标、粘贴到自身为 no-op）→`{cells,end}`。apiMock 复用该模块模拟后端。
- `frontend/src/test/apiMock.ts`：前端测试用的内存 API 桩（与后端语义一致）。
- `backend/src/server.js`：路由/静态服务/双端口监听；`backend/src/store.js`：持久化、播种、工作簿操作；`backend/src/transfer.js`：范围转移纯函数（REQ-3-2-1）。

## 数据与接口约定

- 领域模型（`frontend/src/types.ts` 与后端一致）：Workbook{id,name,createdAt,updatedAt,activeSheetId,sheets:[Sheet{id,name,activeCell,selection?,cells:{坐标→原始文本},rowCount?,columnCount?}]}；单元格值为原始文本（公式文本原样存储，计算结果由前端 `formula.ts` 派生）。`selection={current,end}` 为该表最近一次成功选择的完整矩形（REQ-3-1-3，缺省回退 activeCell）。`rowCount/columnCount` 为导入工作表的声明尺寸（导出时用于保留空单元格），普通工作表缺省。
- 种子（仅空数据存储时播种，重启保留用户修改）：工作簿 `Q3 Sales`（id `wb-q3-sales`）、活动表 `Sheet1`：`A1=Item`、`B1=Qty`、`A2=Pen`、`B2=4`（即 range `A1:B2` = `Item/Qty` 与 `Pen/4`），目标区 `D1:E2` 留空；`Sheet2` 空白。两表 `selection={current:"A1",end:"A1"}`。工作表顺序 [Sheet1, Sheet2]，活动表 Sheet1。
- 持久化：`SHALLOW_DATA_DIR`（未设置时缺省 `backend/data/workbooks.json`），原子写（tmp+rename）。工作表增删/重命名、活动表变更与行列结构操作写入同一数据文件，服务端为真值来源。
- 行操作（REQ-2-2-1）与列操作（REQ-2-2-2）：仅作用于当前活动工作表，其他表 cells 不变。`sheet.rowCount = max(原 rowCount, 移位后 maxRow)`、`sheet.columnCount = max(原 columnCount, 移位后 maxCol)`；被删行列单元格删除、后续行列反向移位；移位单元格中 `=` 开头文本的 A1 式引用同步调整，指向被删行列的引用变 `#REF!`；`sheet.selection` 的 current/end 与 activeCell 一起随行列移位。失败（非法 action/行列号、未知表）返回错误且不落盘，网格立即与刷新后均保持原结构。
- API：`GET/POST /api/workbooks`（列表按 updatedAt 降序；创建空工作簿，名缺省 `Untitled workbook`，Sheet1 空白、A1 选中）；`GET/PATCH /api/workbooks/:id`（PATCH 重命名：trim 后为空返回 400 `Workbook name cannot be empty`，成功更新 name+updatedAt）；`POST /api/workbooks/:id/sheets`（新增空白工作表：首个未用 `SheetN` 正整数序命名、成为活动表、A1 选中、更新 updatedAt）；`PATCH /api/workbooks/:id/sheets/:sheetId`（重命名：trim 后为空返回 400 `Worksheet name cannot be empty`，与同工作簿其他表大小写不敏感重名返回 400 `Worksheet name already exists`，成功更新 name+updatedAt）；`POST /api/workbooks/:id/sheets/:sheetId/rows`（body `{action,row}`，action ∈ insert-above/insert-below/delete，行号须为正整数否则 400；成功更新目标表 cells+activeCell+selection+rowCount 并持久化，返回 `{workbook}`）；`POST /api/workbooks/:id/sheets/:sheetId/columns`（body `{action,column}`，action ∈ insert-left/insert-right/delete，列号为 1 基正整数否则 400；成功更新目标表 cells+activeCell+selection+columnCount 并持久化，返回 `{workbook}`）；`POST /api/workbooks/:id/sheets/:sheetId/paste`（REQ-3-1-2，body `{start,text}`：服务端 `pasteCells` 解析 Tab/换行文本，整个矩形一次性写入——空字段清格、公式原样存储、选区变为粘贴矩形 start..end、仅覆盖目标矩形；坐标/文本非法 400 且不落盘，原子失败保持原值）；`POST /api/workbooks/:id/sheets/:sheetId/transfer`（REQ-3-2-1，body `{operation: copy|cut, source:{current,end}, target}`：服务端 `transferCells` 快照源矩形、公式按目标偏移调整、整个目标矩形一次性写入，cut 再清除不在目标矩形内的源格；选区变为目标矩形 current..end；非法操作/源/目标 400 且不落盘，原子失败保持原值）；`PATCH /api/workbooks/:id/sheets/:sheetId/cells/:coord`（body `{value}`：设单格值，空串清格；更新 activeCell+selection={coord,coord}+updatedAt；非法坐标/值 400、未知表 404）；`PATCH /api/workbooks/:id/sheets/:sheetId/selection`（body `{current,end}`：持久化完整矩形并更新 activeCell=current，不更新 updatedAt；非法坐标 400）；`POST /api/import-csv`（body `{fileName,csv}`：服务端解析，成功 201 返回新工作簿，名 = 文件名去掉末尾 `.csv`、Sheet1 完整行/列/原文、首行普通数据；无效 CSV 返回 400 `Invalid CSV file format. Import failed.` 且不产生任何记录）。
- 导出为前端生成：`sheetToCsv` 按声明尺寸或非空包围盒导出 used range，空单元格保留，逗号/引号/换行转义（RFC 4180）；普通单元格导出显示值，公式格导出当前计算结果（REQ-1-3-2）。
- 端口：监听 `PORT`（缺省 3000），同时用独立 server 实例监听 3301（`ARC_EXTRA_PORTS=0` 时跳过），均监听所有网卡；`/health` 与 `/api/health` 返回 `{status:"ok"}`；未知路径（含 /favicon.ico、不存在 API）返回 404 且进程不退出。

## 已确认的注意事项

- 网格、tab、公式栏的 ARIA 合同来自 REQ-1 父级，后续包不得改变角色与可访问名；tab 仍为 `role=tab`+aria-selected，选项/添加按钮是其相邻兄弟，不嵌套在 tab 内。
- 行号菜单（REQ-2-2-1）与列头菜单（REQ-2-2-2）只在提供对应操作回调时启用；菜单命令均用 `role=menuitem`，复用 `WorksheetMenu`。
- 校验规则、筛选与透视结果尚未建模（REQ-5 后续包）；REQ-2-2-1/REQ-2-2-2 中"校验规则随行列移位、超出 0-100 提示 `Please enter a number from 0 to 100`、透视源范围重叠时需 `Refresh pivot table` 后重算、透视选中列被删后编辑器报错要求重选"等行为在这些字段出现时由后续包接入，行列移位纯函数已就绪；REQ-3-1-2/REQ-3-2-1 的 0-100 校验错误文案（`Please enter a number from 0 to 100`）同样在规则建模后由 paste/transfer 的校验钩子返回（两条路径均已原子化：校验失败不写任何格）。
- 重命名成功同时更新编辑器标题与首页记录；创建/重命名后回首页会重新拉取列表。工作表重命名/新增同样更新 updatedAt（首页 Last updated 与列表顺序随之变化）。
- 工作表 tab 菜单目前仅含 `Rename` menuitem；`Delete` 由 REQ-2-1-4 后续包加入，菜单组件已支持多条目。工作表切换持久化（activeSheetId 持久化已随新增/重命名写入；普通切换仍为前端本地状态）；单元格编辑（REQ-3-1-1）已实现：公式栏 Enter/Escape/失焦提交、双击行内编辑器、提交失败 alert 且保持上次成功状态，单元格与选区持久化由 `PATCH cells/:coord`、`PATCH selection` 写入。
- 选择区域模型为 {current, end} 矩形：单击选单格、拖拽选完整矩形（REQ-3-1-3），每表 `sheet.selection` 持久化完整矩形；刷新/切换工作表后恢复。粘贴（REQ-3-1-2）起点取当前选区左上角，成功后选区变为粘贴矩形并持久化。复制/剪切（REQ-3-2-1）同样以当前完整矩形为源、以粘贴时选区左上角为目标，成功后选区变为目标矩形并持久化；复制/剪切源矩形在公式文本层面按目标偏移调整（`$` 绝对引用保持不变），公式栏显示调整后的原始公式。
- 尚未实现（后续工作包）：工作表切换持久化、删除工作表、筛选、校验、透视表、撤销/重做（REQ-3-2-2）、公式求值器对 `$` 绝对引用的求值（REQ-4-1-2；本包已按偏移调整并原样存储/显示 `$` 公式文本，求值显示待 REQ-4-1-2 接入）。
