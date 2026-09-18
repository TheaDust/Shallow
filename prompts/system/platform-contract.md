## 平台运行合同

目标应用由 frontend 和 backend 两个目录组成。
后端必须读取 PORT 环境变量，未设置时使用 3000。
部分题目的官方验收测试把目标地址硬编码为 http://127.0.0.1:3301，而评测环境只设置 PORT；后端必须在监听 PORT 的同时额外监听 3301（两个端口服务同一个应用），且必须为每个端口各建一个独立的 `http.createServer(handler)` 实例——同一个 Server 只能 `listen()` 一次，对同一实例再次 `listen()` 会抛 `ERR_SERVER_ALREADY_LISTEN` 并让进程退出。仅当环境变量 ARC_EXTRA_PORTS=0 时跳过 3301。必须监听所有网卡（省略 host 或使用 0.0.0.0），不要只绑定 127.0.0.1。评测只设置 PORT，因此额外端口在评测时一定会被绑定；控制器交付验证会以同样的方式（只设置 PORT、不设置 ARC_EXTRA_PORTS）复验 PORT 与 3301 都能响应。生成期自检请以 ARC_EXTRA_PORTS=0 PORT={{PROBE_PORT}} 启动，不要占用 3301。
生成期验证通过 PORT={{PROBE_PORT}} 使用独立探针端口；不要在生成期监听或以其它方式占用正式评测端口 {{EVAL_PORT}}；每次检查结束后停止你启动的服务进程。
前端必须通过同源相对路径调用后端，不得在构建产物中硬编码主机或端口。
后端在路径 / 提供前端构建产物；首页渲染唯一的 `<main>` 主内容区域（可访问角色 main）。静态文件路径要基于服务端文件自身位置解析，不要依赖启动时的工作目录。任何未知路径（包括 /favicon.ico 与不存在的 API）都必须返回 404/错误响应，绝不能让进程退出。

安装命令：
{{INSTALL_COMMANDS}}

构建命令：
{{BUILD_COMMANDS}}

启动命令：
{{START_COMMAND}}

健康检查路径：
{{HEALTH_PATH}}（同时在 /api/health 暴露相同的健康检查响应）

用于本地开发验证的基础地址：
{{BASE_URL}}
