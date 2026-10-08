# ARCHITECTURE

在线电子表格应用(React + Vite + TS 前端,零依赖 Node 后端)。只给定位入口与跨模块约束;字段、载荷与用例见源码及测试。

## 修改入口

- `backend/src/app.mjs` - `createRequestHandler({ dataDir, staticRoot })`:健康检查、静态资源与 `/api/workbooks` REST。worksheet 子路由:`cells`(含 `batch`/`updates`)、`notes`、`selection`、`freeze`、`structure`、`range-transfer`、`state`、`validation-rule`、`conditional-formats`、`filter(-views)`、`sort`、`pivot`;workbook 级 `named-ranges`。`ValidationError`/`NotFoundError`→400/404,未知路径 404。
- `backend/src/lib/` - `errors.mjs`(`status` 即响应码);`json-store.mjs` 的 `createJsonStore(filePath, initialValue, { upgrade })` 单队列原子读写。
- `backend/src/store/workbooks.mjs` - 权威状态、种子与消息常量:`createSeedState()`、`upgradeSeedState()`(按 id 幂等补充)、`createWorkbookStore({ dataDir })`(每写操作单次原子 update)。A1 辅助在 `domain/grid.mjs`。
- `backend/src/domain/` - 按领域分文件的纯函数与消息常量(`grid`/`structure`/`sort`/`validation`/`filter`/`pivot`/`named-ranges`/`formatting`);`structure.mjs` 含 `shiftArea`/`shiftRuleRanges`/`shiftFilter`/`shiftPivot`/`shiftAnnotations` 与公式引用重写。
- `backend/src/server.mjs` - PORT(默认 3000)与 `platform-ports.json` 额外端口(`ARC_EXTRA_PORTS=0` 跳过),每端口独立 `createServer`;`SHALLOW_DATA_DIR` 覆盖数据目录。
- `frontend/src/App.tsx` - hash 路由与唯一 `<main>`:`#/`、`#/workbooks/new`、`#/workbooks/:id`。
- `frontend/src/pages/WorkbookEditorPage.tsx` - 编辑器编排与服务端写路径/乐观更新收口;工具栏菜单 `Edit`/`Insert`/`View`/`Data`/`Format`;历史栈在 `pages/useWorksheetHistory.ts`。
- `frontend/src/components/WorksheetGrid.tsx` - 网格 ARIA 与交互:`gridcell` 名=坐标 + `aria-selected`、内联 `Edit <坐标>`、`Filter <表头>`、`Open dropdown for <坐标>`、`Open note for <坐标>`(有批注的格内)、条件格式填充与 named range 显示值。
- `frontend/src/domain/` - 前端纯函数与领域类型(按领域分文件);公式显示值经 `formula.ts` 的 `computeDisplayValues(cells, names?)`。
- `frontend/src/components/` - 对话框与面板目录:`NamedRangesDialog`、`ConditionalFormattingDialog`、`CellNoteDialog`(`Note for <坐标>`)、`FindReplaceDialog`、Sort/Validation/Filter/Pivot、workbook/worksheet 重命名与删除、`FormulaBar`、`WorksheetTabs`、filter view 面板。
- `frontend/src/lib/workbook-api.ts` - 同源 REST 客户端;`src/lib/api.ts` 是通用 JSON 请求。
- 测试:`backend/test/*.test.mjs`、`frontend/src/*.test.tsx`;`src/test/fake-api.ts` 是 fetch double(不重写公式、不位移规则/过滤/条件格式),结构+公式/规则/批注端到端走真实后端。

## 关键约束

- 服务端存储唯一权威,前端只渲染返回值;深链 `#/workbooks/<id>` 稳定标识同一工作簿;空库写整份种子,已有文件经 `upgradeSeedState` 按稳定 id 补充缺失预置工作簿(保留旧记录/用户修改、重启幂等)。
- 共享种子 `createSeedState()`:基线 `Q3 Sales` + `evoSeedWorkbooks()`;后者给每个 EVO 场景一份独立 workbook(`EVO-M01`–`EVO-M05`,以及 `EVO-N01`–`EVO-N05`——表依次为 `ScrollLedger`/`Narrative`/`ForecastModel`/`Signals`/`ReviewQueue`,其中 `EVO-N05-NOTE-EDIT`/`-DELETE` 预置批注);工作表 id=`<workbook id>--<初始表名>`。完整 id/单元格见 store 源码,增量只新增相容对象。
- 工作簿名/工作表名由服务端校验(非空、长度上限、作用域内大小写不敏感唯一)并以 store 常量消息拒绝且不改存储;创建/导入不套用唯一性。显示名与 URL 标识分离(id 稳定,重命名只改 `name`)。
- 单元格写入服务端权威、单次原子写;`applyCellUpdates` 先整批校验再落盘(任一被拒即整批 400);编辑乐观更新后按最新响应收敛(`pendingCellWrites`),失败回退上次成功值;公式栏/内联编辑 Enter 或失焦提交、Escape 丢弃,网格显示结果而编辑器保留 `=` 原文。
- 查找替换在前端按 `computeDisplayValues` 匹配(整个显示值相等,`Match case` 关闭时忽略大小写):`Find next` 环绕取选区之后的匹配并显示 `Match <current> of <total>`;`Replace all` 一次 POST `/cells/updates`,失败不改单元格。对话框无容器 aria-label(避免遮蔽 `Find`)。
- 冻结窗格是每工作表视图状态(`frozenRows`/`frozenColumns`,0 时删键且不更新 `updatedAt`);`PATCH /freeze` 只接受非负整数;编辑器用 `Frozen rows: <count>; columns: <count>` 按钮暴露状态,网格以 sticky 行/列渲染,偏移契约由 `WorksheetGrid` 与 `styles.css` 同改;渲染 `max(默认 20×12, usedDimensions(cells))`。
- 选区是每工作表视图状态(缺省 A1),拖选结束 PATCH `/selection`,矩形内外 `aria-selected` 为 true/false;`Delete` 整块空串 POST `/cells/batch` 原子清空且不改选区,失败回退并 `role="alert"`。
- 验证规则可带可选 `message`(trim 后非空才存)取代标准文案。过滤 `worksheet.filter` 只影响渲染(多列 AND),绝不动单元格。
- 筛选视图 `worksheet.filterViews = [{ id, name, filter }]`:`Save filter view` 存当前 filter 快照(名字整本唯一);`Filter views` 面板逐视图同名按钮,点选即 PUT `/filter`(面板保持打开、`aria-pressed` 标记);`Delete filter view` 删视图并清 filter;两面板是内联 region。
- 透视表:配置存 `worksheet.pivot`,结果只写结果表 `cells`;创建/应用/刷新原子写;字段失效、SUM/AVERAGE 无数值各自报错并保留上次成功结果;源表行列变更经 `shiftPivot` 移动 `range`。
- 区域转移与排序均服务端权威、单次原子写:转移先校验再写目标,cut 成功后清除目标外的源格;排序整行重排、公式相对行引用随记录平移,失败保持原顺序。
- 行列结构变更不做乐观位移:成功后用返回工作簿替换本地状态,失败 `role="alert"`;公式引用、校验规则、条件格式、过滤视图与读取该表的透视 `range` 随之位移。工作表重命名不动表 id;删除至少保留一张、被现存 pivot 引用的源表拒绝,删 active 时取左邻否则新首张。
- undo/redo 栈仅会话内、按工作簿 id 隔离;恢复经 PUT `/state` 写回服务端故刷新后保持;成功修改压入操作前快照并清空 redo;栈空时按钮 `disabled`。
- `ui/Dialog` 仅在 `open` 时挂载 `<dialog>`(关闭即卸载说明/表单/操作),开启走 `showModal` 隔离背景,关闭把焦点还给开启元素;对话框常驻并保留预填状态(`wasOpen` ref)。`ui/Menu` 以 `aria-label=triggerLabel` 提供可访问名;`ui/Combobox` 以原生 select 存值、展开才渲染唯一 `role=listbox`/`option`。
- 命名区域是 workbook 级 `workbook.namedRanges = [{ name, range }]`:name 必须以字母开头(否则 400 `Named range must start with a letter`),range 归为 `[Sheet!]A1[:B2]`;`buildNamedRangeMap` 只把指向当前表(或无表名)的名字给公式引擎,改区域后依赖公式即时重算。
- 条件格式是 worksheet 级 `worksheet.conditionalFormats = [{ range, condition, value, style }]`:`FILL_COLORS` 三色精确 rgb 由网格 inline `backgroundColor` 绘制(覆盖选中底色),不匹配格与范围外格无该色。PUT 无 `index` 追加、带 `index` 原位替换(`Edit rule N`),DELETE 按 `index` 删,成功后均关闭对话框;该对话框表单不带容器 aria-label(避免遮蔽 `Name`/`Condition`)。
- 单元格批注是 worksheet 级 `worksheet.notes = { <A1 坐标>: 文本 }`,与 `cells` 分离:PUT/DELETE `/notes` 单次原子写(空文本即删键),写批注绝不动单元格值;结构变更经 `shiftAnnotations` 随单元格位移。打开路径:工具栏 `Insert`→`Add note` 或格内 `Open note for <坐标>`,两者打开 `Note for <坐标>`;批注文本只在 `Note` 多行框出现一次,避免与单元格值形成同名歧义。
- CSV 导入经前端 `parseCsv` 后 POST `/api/workbooks/import`(原子写),名称=文件名去 `.csv`;导出纯前端且公式导出计算结果。
