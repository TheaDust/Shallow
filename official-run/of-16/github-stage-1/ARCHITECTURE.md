# ShallowCode ARCHITECTURE

增量式简化 GitHub 协作平台。当前范围：REQ-1 身份/账户访问 + REQ-2-1 组织身份与发现 + REQ-2-2 团队与成员管理 + REQ-2-3 仓库访问授权（仓库 Settings → Manage access）。前端 React + Vite（hash 路由，单一 `<main>`），后端零依赖 `node:http`，状态存 JSON 文件。

## 修改入口

- `frontend/src/App.tsx` — `renderRoute()` 路由表与 `Protected`；顺序：团队路由 → 仓库 settings/manage-access → 仓库 → 组织页签 → 账户页。
- `frontend/src/auth/SessionContext.tsx` — 会话权威状态 `useSession()`；`auth/api.ts` 的 `fieldErrorsOf`/`errorMessageOf` 与 `auth/types.ts` 的 `FieldErrors`。
- `frontend/src/layout/AppTopBar.tsx` — 账户菜单（可访问名 `Account menu`，以链接触发）与 `Sign out` 确认对话框。
- `frontend/src/ui/Menu.tsx` — 传 `triggerHref` 时触发器是 `<a>`（role link，点击仍展开菜单）；不传时保持 button（如 `Member menu <username>`）。
- `frontend/src/organizations/api.ts` / `types.ts` — 组织/仓库/团队/成员/父团队/仓库访问授权的 API 与领域类型（`RepositoryRole`、`RepositoryAccessGrant`、`RepositoryAccessOverview`）。
- `frontend/src/organizations/` 片段：`OrganizationRepositories.tsx`（`Find a repository` 过滤）、`OrganizationLists.tsx`（`OrganizationTeams` + `New team`）、`TeamMembers.tsx`/`TeamSettings.tsx`、`OrganizationPeople.tsx`（`Add member`、`Member menu <username>`、`Remove` 确认）、`RepositoryManageAccess.tsx`（`Add people or teams` 对话框 + 访问表）。
- `frontend/src/pages/` — `OrganizationOverviewPage`、`TeamPage`、`NewTeamPage`、`OrganizationListPage`（每个所属组织下同时列出当前账号可读的仓库链接）、`NewOrganizationPage`、`RepositoryOverviewPage`（`canManageAccess` 时显示 `Settings`）、`RepositorySettingsPage`（`Manage access`）、`RepositoryManageAccessPage`。
- `backend/src/routes/organizations.mjs` — 组织/仓库端点、成员写操作（要求组织 Owner）；仓库 GET 附带 `canManageAccess`。
- `backend/src/routes/repository-access.mjs` — `GET/POST /api/organizations/:slug/repositories/:name/access`、`PATCH .../access/:grantId`；`resolveAdminTarget`（组织 Owner 或仓库 Admin）。
- `backend/src/routes/teams.mjs` — 团队端点；写操作 `resolveTarget(..., {requireOwner:true})`。
- `backend/src/domain/`：`organizations.mjs`（模型/成员/`createOrganization`）、`teams.mjs`（`createTeam`/`setParentTeam`/`addTeamMember`）、`repositories.mjs`（`canReadRepository` 读取唯一判定点）、`repository-access.mjs`（`canManageRepositoryAccess`/`listRepositoryAccess`/`addTeamAccessGrant`/`updateAccessGrantRole`）、`validation.mjs`（字段规则 + 全部消息 + `REPOSITORY_ROLES`/`normalizeRepositoryRole`）、`seed.mjs`（`SEED_ACCOUNTS`/`SEED_ORGANIZATIONS`/`ensureSeedData`）。
- `backend/src/lib/` — `router.mjs` 参数化路由；`session.mjs` 的 `resolveSessionAccount`；`state.mjs` 的 `createStateStore()`（`SHALLOW_DATA_DIR/state.json`，首次读取播种）。
- 测试：`backend/test/{teams,members,organizations,repository-access,auth,validation}.test.mjs`；前端 `organizations/{teams,members,organizations,repositoryAccess}.test.tsx` 与 `auth/*.test.tsx`。

## 关键约束

- **规则唯一来源**：字段规则与消息只在 `backend/src/domain/validation.mjs`；前端只渲染后端返回的 `errors`。
- **组织命名空间**：`name`/`displayName`/`slug` 分别存储但共用同一唯一命名空间（`isOrganizationNameTaken`），重名先于格式判定。
- **仓库访问**：`canReadRepository` 是唯一读取判定点——公共仓库人人可读；私有仓库仅组织 Owner、直接授权或已授权团队的直接成员可读，组织成员身份本身不授权；私有仓库直开访客 404、已登录未授权 403 `Access denied`。“Your organizations” 的仓库链接复用同一可见性，未授权仓库不出现。
- **仓库角色与 Manage access**：`repositoryGrants` 记录 `{repositoryId, accountId|teamId, role}`，存储值 `read/triage/write/maintain/admin` 不是继承阶梯；`canManageRepositoryAccess` 只认组织 Owner 或仓库 Admin，闸住 `/access` 全部读写；`addTeamAccessGrant` 对同一 (repository, team) 复用同一条记录，改角色不产生重复行（页面用 `aria-label`=主体名区分同名行）。
- **角色 Combobox 的值**：`RepositoryManageAccess` 的 “Role” 选项 `value` 用可见标签（`Write`/`Read`…），经 `organizations/format.ts` 的 `repositoryRoleLabel`/`repositoryRoleFromLabel` 转换，请求体仍发存储小写值；其余角色展示走同一 label 映射。
- **团队规则**：队名（1–50 小写 ASCII 字母/数字/连字符，首尾非连字符）仅组织内唯一；父团队须同组织且不得成环，拒绝时父团队不变。
- **团队关系与权限**：`organizationMembers`、`teamMembers`、`teams.parentTeamId` 三条独立持久化关系，层级不继承成员；创建团队、改父团队、增删团队成员一律要求组织 Owner。
- **`Add member` 单一名称**：团队 Members 页与组织 People 页的触发器与提交按钮不同时渲染。
- **成员增删**：`addOrganizationMember` 按用户名/邮箱匹配（未知 → `Account not found`，已存在 → `Account is already a member`）；`removeOrganizationMember` 单次 mutation 内删组织关系、该账号在本组织的团队关系与直接仓库授权（团队授权保留），删最后一名 Owner 被拒。
- **路由顺序**：后端挂载 auth → organizations → repository-access → teams；前端 `renderRoute` 先团队、再仓库 settings，最后组织页签/账户页。
- **失败保留**：注册/登录/恢复/改密失败保留非敏感输入，密码与确认密码一律清空；改密先判当前密码（`Current password is required`/`is incorrect`）再校验新密码。
- **会话**：`HttpOnly; SameSite=Lax` 的 `session` cookie；受保护处理器都用 `resolveSessionAccount` 重读状态；未知账号/口令错误/不可用账号一律 `401 Invalid credentials`，无会话 `401 Sign in required`。
- **单一用户名文本**：用户名只在账户菜单触发器内渲染一次（`aria-label` 固定可访问名）；触发器是链接（href `#/organizations`，preventDefault 后展开菜单）。
- **对话框**：`ui/Dialog` 用 `showModal()`（jsdom 回退 `open` 属性）；登出/移除成员对话框 `showClose={false}`，Esc/背景关闭不改变关系。
- **前端地址**：hash 路由；服务端只为 `/` 与 dist 静态资源返回内容，未知路径（含 `/api/*`、`/favicon.ico`）返回 404 且进程不退出。
- **端口**：`backend/src/server.mjs` 为每个端口单独 `createServer`（同实例不能二次 listen），`ARC_EXTRA_PORTS=0` 时只监听 `PORT`。
- **测试池**：`frontend/vitest.config.ts` 固定 `singleFork/minForks/maxForks`，避免 vitest 2.1 的 minThreads/maxThreads 冲突。

## 必要准备

- 种子账户（`seed.mjs`，均已验证、密码 `Valid-password-123!`）：`alice-dev`、`recovery-*`、`password-change-*`、`org-owner`、`team-maintainer`、`bob-reviewer`、`new-member`（非成员）、`existing-member`、`org-member`、`protected-member`、`repo-admin`（持 `acme-docs` 的 Admin）。
- 种子组织 `Acme Demo`（slug `acme-demo`）：Owner `org-owner`/`team-maintainer`，成员 `repo-admin`（同时持 `acme-docs` 的 Admin 直接授权，便于从 “Your organizations” 进入该仓库，但不会因此读到其他私有仓库）、`bob-reviewer`、`existing-member`、`org-member`、`protected-member`；团队 `platform-team`、`frontend-team`（父 platform-team）、`frontend-child`、`access-role-team`；仓库 `acme-docs`（公共，预置授权 `repo-admin`=admin、`access-role-team`=write，`frontend-team` 无授权）与 `secret-research`（私有）。成员关系只在新建组织时写入，`parentTeamId`/种子授权只在首次创建团队/仓库时写入，重启不覆盖用户修改。
- 恢复固定验证码 `123456`（`VERIFICATION_CODE`）；已注册与未知邮箱返回同一响应。
- 场景初始态一律通过公开流程建立（注册页、登录页、账户菜单 Settings、Your organizations → New organization 与组织 People/Teams 页），无私有准备接口。
