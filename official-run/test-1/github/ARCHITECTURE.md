# 项目架构笔记

## 技术选型与理由

- 前端：React 18 + Vite 5 + TypeScript（精确版本钉在 frontend/package-lock.json），hash 路由（`#/signin`、`#/register`、`#/forgot`、`#/`），不引入组件库/状态库。
- 后端：零依赖原生 node:http（backend/src/server.js），JSON 文件持久化，密码用 crypto.scryptSync 加盐哈希存储，会话用 HttpOnly cookie（`session_id`）+ sessions 记录。
- 前端测试：Vitest + @testing-library/react（jsdom）；后端测试：node:test。`run_tests` 以 `--maxWorkers=1` 运行前端测试，vite.config.ts 的 test 配置必须保留 `minWorkers: 1`，否则 vitest 2.1.9 会因 minThreads 缺省冲突退出。

## 模块与入口

- 前端入口 frontend/src/main.tsx → App.tsx：启动时 GET /api/me 恢复会话；已登录显示顶栏（品牌 + 右上角账户菜单），未登录按 hash 渲染 Home/SignIn/Register/Forgot。
- 页面：HomePage（未登录落地页含 Sign up/Sign in/Forgot password 链接；已登录显示 Your workspace）、SignInPage、RegisterPage、ForgotPage。ForgotPage 两步流程：Email 步骤（Send reset link）→ 重置步骤（固定码 `123456` 以独立可见文本值显示 + Verification code/New password/Confirm password + Reset password）；已登录会话访问 `#/forgot` 仍渲染 ForgotPage（保留顶栏账户菜单）。
- 页面：SettingsPage（`#/settings`，账户菜单内 Settings 链接进入，含 "Password and authentication" 链接）、PasswordSettingsPage（`#/settings/password`，heading "Password and authentication"，表单 Current password/New password/Confirm password + Update password，仅登录可见）。
- 页面：SearchPage（`#/search?q=…`，顶栏搜索框 role=searchbox 名 "Search"，Enter 直达结果；结果链接可访问名=仓库名，附带 owner/name、描述、可见性、更新时间；类型过滤器 All/Repositories/Code/Issues/Pull requests，无匹配显示 "No results"）、RepositoryOverviewPage（`#/:owner/:name` 与 `/code`，h1 "owner/name"、Public/Private 标记、描述、默认分支、文件列表、Code/Issues/Pull requests/Settings 入口）、FileContentPage（`#/:owner/:name/blob/:branch/:path`）、TreePage（`#/:owner/:name/tree/:branch/:path`）、RepositoryTabPage（pulls/settings/general 最小页）、IssuesListPage（`#/:owner/:name/issues`，行含编号链接 #N、标题链接（可访问名=标题）、Open/Closed 文本、作者、标签徽章、更新时间；`Open`/`Closed` 为链接，搜索框 "Search issues" 键入即过滤，Labels 过滤按钮含 role=option 选项；过滤条件写入 URL query `state/q/labels`，刷新保留）、IssueDetailPage（`#/:owner/:name/issues/:number`，h1=完整标题不含编号、#编号、Open/Closed 状态文本、描述、Comments/Activity 分区（article/时间线按时间正序）、右侧 Assignees/Labels/Milestone 顺序；仅 canEditContent 角色显示 "Edit issue title"/"Edit issue description" 按钮（表单 label "Issue title"/"Issue description" + 按钮 "Save issue title"/"Save issue description"）；仅 manageMetadata 角色显示 Labels/Milestone 按钮与 "Close issue"/"Reopen issue"，点击 option 即保存并关闭）、NotFoundPage。
- 组件：AccountMenu（按钮可访问名 "Account menu"，面板显示当前账号、组织列表、"Sign out" 链接）、SignOutDialog（可访问名 "Sign out"，含 Confirm sign out/Cancel）、GlobalSearch（顶栏，搜索框名 "Search"）、RepositoryLayout（仓库页头：标题、可见性标记、描述、默认分支、四个标签页）。
- 校验逻辑前后端各一份且语义一致：frontend/src/validation.ts 与 backend/src/validation.js（用户名、邮箱、密码规则及字段错误文案）。
- 后端：src/server.js（路由/静态/健康检查）、src/store.js（持久化与种子）、src/validation.js。API：POST /api/register、/api/signin、/api/signout、/api/forgot-password、/api/reset-password、/api/change-password；GET /api/me、/api/search?q=、/api/repositories/:owner/:name、/api/repositories/:owner/:name/file?path=、/api/repositories/:owner/:name/tree?path=、/api/repositories/:owner/:name/issues、/api/repositories/:owner/:name/issues/:number；PUT /api/repositories/:owner/:name/issues/:number/labels（body { labels: string[] }）、PUT .../issues/:number/milestone（body { milestone: string|null }）、POST .../issues/:number/status（body { status: 'open'|'closed' }）、PATCH .../issues/:number（body { title?|description? }）；健康检查 /health 与 /api/health。仓库视图访问规则集中在 canViewRepository：public 任何人可读，private 仅 owner 或显式 collaborator 可读，未授权一律 404。仓库角色 getRepoRole：owner→admin，其余取 collaborators 授权；议题权限：canManageIssueMetadata=admin/maintain/triage（Labels/Milestone/Close/Reopen，Read/Write/匿名一律 403），canEditIssueContent=admin/maintain/write（标题/描述编辑，Read/Triage/匿名 403）。

## 数据与接口约定

- 持久化：SHALLOW_DATA_DIR 指向的 store.json（未设置时用 backend/data）。空库时播种账号 `alice-dev`（email `alice.dev@example.test`，密码 `Valid-password-123!`，emailVerified=true，status=active）、`bob-reviewer`（Read 授权）、`cara-writer`（Write 授权，均同密码 `Valid-password-123!`）与两个仓库：`alice-dev/acme-docs`（public，描述、defaultBranch=main，文件 README.md 与 docs/guide.md，labels `bug`/`documentation`，milestone `Q3 launch`，collaborators bob-reviewer=read、cara-writer=write）、`alice-dev/secret-research`（private，文件 notes.md，labels `bug`，milestone `Q4 planning`，issue `Private planning`）；store.json 已存在时绝不重播种子，保留用户修改；旧库缺 repositories 数组时回填种子仓库，缺 labels/milestones/collaborators/issues 的种子仓库按种子回填对应字段。
- 种子议题（acme-docs，编号仓库内唯一）：#1 `Improve onboarding`（Open，labels [bug]，assignees [alice-dev]，milestone `Q3 launch`，description `Describe the onboarding improvement.`，comment 作者 cara-writer，activity=created+comment）；#2 `Legacy welcome text`（Closed，labels [bug]，description 含 "onboarding" 使 Closed+关键字+标签过滤仍命中）；#3 `Update contribution guidelines`（Open，无任何 label，作为 REQ-5-3-2 标签变更的独立目标，与 #1/#2 的 bug 标签初始态互斥、分场景保留）；#4 `Original issue title`（Open，REQ-5-2-2 无效标题编辑独立目标，三空格标题必须报 "Title is required" 且保留原标题）。acme-docs milestones=`Q3 launch`+`v1.0`（REQ-5-3-3 用 v1.0 做可选项、`Q4 planning` 属 secret-research 不可选）；backfill 仅补缺项（旧库追加 v1.0 与 #4）。
- 注册：校验失败返回 422 { fieldErrors }，逐字段文案：Username is required / Username format is invalid / Username already exists / Email is required / Email format is invalid / Email already exists / Password is required / Password requirements are not satisfied / Confirm password is required / Passwords do not match / Agree to terms is required。成功 201，email 直接标记 verified，不提供邮箱验证页。
- 登录：成功创建 session（唯一 id、accountId、active）并设置 HttpOnly cookie（`session_id`）；失败统一返回 401 "Invalid credentials"（不区分未知账号/错误密码/不可用账号，且不创建 session）。密码恢复：forgot-password 对已注册/未知邮箱返回相同响应；reset-password 校验固定码 `123456`、密码规则与确认，未知邮箱返回 fieldErrors.email='Email is not registered'（前端在重置步骤顶部以 role=alert 可见渲染），成功显示 "Password updated"。
- 改密：POST /api/change-password 需有效会话，仅改当前账户密码记录（不登出、不动其他账户/资源）；失败 422 fieldErrors 逐字段文案：Current password is required / Current password is incorrect / New password is required / Password requirements are not satisfied / Confirm password is required / Password confirmation does not match，且不改凭据；成功 200 { ok, message: 'Password updated' }，新密码立即用于登录、旧密码失效。前端 validateChangePasswordForm 同步这些规则（当前密码正确性仅服务端可判）。
- 登出：POST /api/signout 将对应 session 置为 inactive 并清 cookie；前端仅 "Confirm sign out" 提交登出，"Cancel"/关闭对话框保留会话；登出后刷新或重开受保护页面均为未认证态并显示 "Sign in" 入口。
- 任何 API 与页面响应都不得回显密码或密码哈希。失败后前端保留用户名/邮箱输入，清空密码与确认密码字段。
- 端口合同：后端同时监听 PORT（缺省 3000）与固定额外端口 3301，各自独立 http.createServer 实例，监听 0.0.0.0；`ARC_EXTRA_PORTS=0` 时跳过 3301。`/` 提供 frontend/dist（路径相对 server 文件解析），未知路径 404。
- 议题过滤是纯前端行为：列表一次拉取仓库全部 issues，过滤只改变当前展示行（state 链接切换、"Search issues" 关键字匹配 title/description、Labels 选项多选），不写/删议题；过滤上下文编码在 URL query，刷新保留。快速连续变更时 updateFilters 从当前 location.hash 读现有过滤条件再合并，避免基于过期渲染丢失 state。

## 已确认的注意事项

- 账户菜单含账号显示、组织列表占位、Settings 链接（`#/settings`）与 Sign out 入口；后续工作包（组织、仓库等）扩展菜单内的组织列表。
- 议题详情返回 permissions.manageMetadata 与 permissions.canEditContent（服务端按会话+仓库角色计算）；Labels/Milestone 侧栏按钮与 Close/Reopen 仅 manageMetadata 角色可见，Edit issue title/Edit issue description 仅 canEditContent 角色可见，Read/Write/匿名前端隐藏、后端对应接口 403。标签必须已存在于当前仓库（选择器只列当前仓库 labels，跨仓库同名标签不会泄漏或关联），不存在的名字 PUT 返回 422 fieldErrors.labels='Label does not exist in this repository'；里程碑同理（选项=当前仓库 milestones+`None`，不存在的名字 422 fieldErrors.milestone='Milestone does not exist in this repository'）。
- 议题内容编辑原子校验：title trim 后 1–256 字符（空→'Title is required'，超长→'Title is too long'），description ≤65536（超长→'Description is too long'），任一字段无效整请求 422 且不落盘；成功追加活动 title_edited/description_edited（含 author/createdAt/value）、milestone_changed（含 milestone，null 即移除）、closed/reopened，均同步 issue.updatedAt。
- 标签变更原子持久化并追加活动记录（label_added/label_removed，含操作者与时间），更新 issue.updatedAt；Activity 按 createdAt 正序展示。
- 前端 fetch 一律同源相对路径（/api/...）+ credentials: 'same-origin'，构建产物不得硬编码主机端口。
- 密码/确认密码输入使用 type="password"；真实浏览器验证中 Playwright `fill()` 对部分密码框存在丢值现象，端到端脚本用 click+keyboard.type 交互。
- 前端测试注意：jsdom 中 hash 导航须通过用户交互（点击链接/表单提交）触发，或在 render 前设置 window.location.hash；render 后直接赋值 location.hash 不会可靠触发 React 重渲染，避免这种写法。
- 仓库路由解析（matchRoute）里判别字段用 name、仓库名用 repoName，避免对象字面量重复键把判别值覆盖成仓库名。
