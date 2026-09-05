## 平台运行合同

目标应用由 frontend 和 backend 两个目录组成。
后端必须读取 PORT 环境变量，未设置时使用 3000。
生成期验证通过 PORT={{PROBE_PORT}} 使用独立探针端口；不要在生成期监听正式评测端口 3000。
前端必须通过同源相对路径调用后端，不得在构建产物中硬编码主机或端口。

安装命令：
{{INSTALL_COMMANDS}}

构建命令：
{{BUILD_COMMANDS}}

启动命令：
{{START_COMMAND}}

健康检查路径：
{{HEALTH_PATH}}

用于本地开发验证的基础地址：
{{BASE_URL}}
