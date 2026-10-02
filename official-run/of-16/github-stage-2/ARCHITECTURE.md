# ShallowCode ARCHITECTURE

简化 GitHub 协作平台。范围：REQ-1 账户、REQ-2 组织/团队/仓库授权、REQ-3 仓库创建与搜索、REQ-4 代码页/提交/分支/文件管理。前端 React + Vite（hash 路由），后端零依赖 `node:http`。

## 修改入口

- `frontend/src/App.tsx` — `renderRoute`：`matchRepositoryRoute` 先于组织/账户页。
- `frontend/src/repositories/` — `routes.ts`（地址拼装/匹配）、`api.ts`（仓库端点封装）、`types.ts`（`RepositoryView` 含 `branch`/`branches`/`canWrite`）、`RepositoryCode.tsx`（Code 区，`canWrite` 时渲染 `AddFileMenu`）、`AddFileMenu.tsx`（`Add file`→`Create new file`）、`RepositoryFileList.tsx`、`RepositoryBranchSelector.tsx`、`RepositoryBranchesSettings.tsx`、`RepositorySettings.tsx`、`CodeClonePopover.tsx`、`branchName.ts`。
- `frontend/src/pages/` — `RepositoryOverviewPage`（h1 `owner/name`、Code 区 + 分支选择器 + 页签链接）、`RepositoryTreePage`、`RepositoryBlobPage`、`RepositoryNewFilePage`（`File name`/`File contents`/`Commit message`/`Commit changes`）、`RepositoryCommitsPage`、`RepositoryCommitPage`、`RepositoryCodeSearchPage`、`RepositorySettingsPage`、`RepositorySectionPage`、`SearchResultsPage`、`WorkspacePage`、`HomePage`。
- `backend/src/domain/repository-content.mjs` — 分支/提交/文件模型：`diffLines`、`initializeRepositoryHistory`/`initializeRepositoryContent`、`copyDefaultBranchContent`、`listDirectoryEntries`、`listBranchHistory`/`readCommit`/`commitRecordView`/`commitDetailView`、`searchRepositoryContent`、`createFileCommit`；分支读写 `branchNames`/`createBranch`/`appendCommit`/`changeDefaultBranch`。
- `backend/src/domain/repositories.mjs` — `canReadRepository`（唯一读取判定）、`canCreateRepositoryIn`、`canManageRepository`、`canWriteRepository`、`changeRepositoryVisibility`、`repositoryView`/`repositorySummary`、`searchRepositories`、`createRepository`/`forkRepository`、`resolveRepositoryOwner`；`repository-access.mjs` 的 `effectiveRepositoryRole` 是授予角色的唯一读取点。
- `backend/src/routes/repositories.mjs` — 仓库 API：只读端点共用 `readTarget`（可见性判定），变更端点共用 `resolveMutationTarget`；端点清单以源码为准。
- `frontend/src/layout/SearchBox.tsx`（`AppTopBar` 内）— 顶栏 `searchbox` 可访问名 `Search`，回车提交：仓库地址内搜本仓库，否则全局仓库搜索；输入值跟随地址 `q`。
- 测试：`backend/test/*.test.mjs`、`frontend/src/**/*.test.tsx` 按领域分文件；`test-utils/fake-*.ts` 为共用 API 桩（多分支与 `appendRepositoryFile` 在 `fake-repository-content.ts`，新建文件的 POST 桩在 `fake-api.ts`）。其余沿用 `frontend/src/{organizations,auth,layout,ui}/`、`backend/src/routes/{organizations,repository-access,teams}.mjs`、`lib/{router,session,state}.mjs`。

## 关键约束

- **规则唯一来源**：规则与消息只在 `backend/src/domain/validation.mjs`（分支名、文件路径与 1–72 字提交消息规则）；前端只渲染后端 `errors`，失败保留输入并留在原页面；`branchName.ts` 只是展示用镜像。
- **仓库归属与地址**：`organizationId` 与 `ownerAccountId` 二选一标注归属，同名仓库可分别存在于不同归属；地址为 `/organizations/<slug>/repositories/<name>` 或 `/users/<username>/repositories/<name>`，前端只经 `repositoryPath` 拼装。
- **仓库访问**：`canReadRepository` 是唯一读取判定——公共仓库人人可读；私有仓库仅个人 owner、组织 Owner、直接授权主体或持授权团队的成员可读（团队授权只对有 `organizationId` 的仓库生效，组织成员身份本身不授权）；直开私有仓库访客 404、登录未授权 403 `Access denied`。
- **版本关系**：`branches`/`commits`/`repositoryFiles` 按仓库归属，提交不可变（parentId/作者/消息/时间/changes）；分支历史 = 从 `branch.headCommitId` 沿 `parentId` 回溯，故从既有修订建的分支共享该历史且不新增提交；`repositoryFiles` 是每分支的物化快照（建分支按 base 复制，提交只刷新该分支）。内容只在创建或首次播种时写入，重启不覆盖；fork 复制提交与 `changes`。
- **写操作（分支 / 新建文件 / 默认分支）**：`POST /api/repositories/{branches,files,default-branch}` 经 `resolveMutationTarget` 重读会话并判权限（分支/新建文件 `mustWrite`、默认分支 `mustManage`）；`createFileCommit` 先判分支、路径（空、`/` 开头、`..` 段、与既有文件/目录冲突 → `Invalid file path`）与消息（空 → `Commit message is required`，>72 过长），通过才 `appendCommit`，被拒提交不改文件/分支头/历史。
- **分支与默认分支**：`repository.defaultBranch` 仅是指针，Settings→Branches 只改它，不删写任何分支/提交/文件；Code 页用地址 `?branch=` 选快照（未知/缺省回落默认），视图、目录、文件、提交历史读同一分支。建分支先过名称规则与重名判定（见 `validation.mjs`）；只读端点（`tree`/`files`/`commits`/`commit`/`code-search`）不写状态。
- **创建/分叉原子性**：`createRepository`/`forkRepository` 先判权限、重名与格式，全部通过才写入；`canCreateRepositoryIn`：个人命名空间仅本人，组织命名空间要求组织 Owner；fork 需源仓库 Read+、目标可创建，私有源只能生成私有 fork。
- **Settings 与权限分离**：`repositoryView` 服务两种归属并给出 `canManage`/`canWrite`；`…/settings[/general|/branches|/manage-access]`、`Branches` 与 `Change visibility` 仅在 `canManage`（个人 owner / 组织 Owner / 仓库 Admin）时出现，否则 `Access denied`。写操作要求 `canWrite`，Read/Triage 只读；判定在后端重复执行，越权与非法值不写状态。
- **组织与授权**：组织 `name`/`displayName`/`slug` 共用唯一命名空间，队名仅组织内唯一且父团队须同组织不成环；成员、团队与父团队关系各自独立不继承；`repositoryGrants`（`{repositoryId, accountId|teamId, role}`）是 `read…admin` 非继承阶梯（同一 repository+team 一条，见 `routes/repository-access.mjs`）。
- **路由与命名唯一性**：挂载顺序见 `routes/*.mjs` 与 `renderRoute`。命名控件在活动页内唯一：页签 `Code`/`Commits` 与克隆按钮 `Code` 同名但角色不同；文件页 h1 内 self-link 名恰为文件名。确认对话框只在打开时挂载；切换分支时选择器立即更新，文件区以 `aria-busy` 标记重读期间。
- **会话与端口**：`HttpOnly; SameSite=Lax` 的 `session` cookie，受保护处理器用 `resolveSessionAccount` 重读状态（无会话 `401 Sign in required`）；`ui/Dialog` 用 `showModal()`，账户菜单触发器是 `Account menu` 链接；hash 未知路径 404，`server.mjs` 每端口单独 `createServer`，`ARC_EXTRA_PORTS=0` 只监听 `PORT`。

## 必要准备

- 种子（`seed.mjs` 的 `ensureSeedData`，首次读取时写入；密码均 `Valid-password-123!`）：组织 `Acme Demo`（`acme-demo`，Owner `org-owner`/`team-maintainer`）含 `acme-docs`（公共，`src/README.md` = `Document search flow`；授权 `repo-admin`(admin)/`access-role-team`(write)）、私有 `secret-research`、分支场景的 `branch-switch-demo`（`main` + `feature-search`，`main-only.md` 仅目标分支；`branch-contributor` 持 write）与 `default-branch-demo`（`main` + `release`，默认 `main`；`default-branch-admin` 持 admin、`default-branch-viewer` 无授予）；个人仓库见 `SEED_USER_REPOSITORIES`（其中 `file-contributor` 的公共 `file-management-demo` 以自身为 owner，故 `canWrite`）。`branches[{name, base?, message?, author?, changes?}]` 首次播种时经 `createBranch`/`appendCommit` 建立。
- 团队/授权/分支内容只写入一次，成员关系仅新建组织时写入，重启保留改动；只有 `acme-docs` 的历史相对当前时刻计算；恢复验证码 `123456`，场景初始态一律经公开流程建立，无私有准备接口。
