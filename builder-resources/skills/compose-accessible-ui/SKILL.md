---
name: compose-accessible-ui
description: Compose reusable, accessible React interactions from the controller-approved UI capability. Use when implementing or repairing dialogs, menus, tabs, form fields, native comboboxes, notifications, focus behavior, keyboard navigation, or repeated buttons and controls.
---

# 组合可访问 UI

## 工作流

1. 先检查 `frontend/src/ui`。若缺少通用控件，调用 `list_capabilities`，再按返回的批准 ID 调用 `install_capability`；不得传入任意 npm、git 或文件路径。
2. 从 `frontend/src/ui` 导入现有 primitive，并在前端入口或全局样式中只导入一次 `ui/primitives.css`。
3. 把需求指定的可见文本、role、label、placeholder、状态属性原样传给 primitive。不要让组件默认文案覆盖需求合同。
4. 业务组件负责数据、权限和持久化；UI primitive 只负责通用交互与呈现。不要把领域对象或 API 请求写入 `frontend/src/ui`。
5. 使用传统 DOM 测试验证角色、可访问名、状态切换和错误呈现；只有焦点、原生 dialog 或点击外部行为仍不确定时才使用 browser。

## 选择规则

- 普通导航使用带 `href` 的 link，不用 Button 模拟。
- 二次操作列表使用 `Menu`；需求只要求普通按钮列表时不要擅自增加 menu 角色。
- 模态交互使用 `Dialog`，标题就是可访问名；关闭后确认焦点回到触发器。
- 少量固定选项优先使用原生 `Combobox`（select）；需要可输入过滤时再在业务层实现完整 listbox/combobox 键盘合同。
- 标签页使用 `Tabs` 并由业务层持有 active id；路由型标签仍使用 link。
- 校验使用 `FormField` 的可见错误，并把输入的 `aria-describedby` 连接到说明和错误。
- 保存结果或后台反馈使用 `ToastRegion`/页面内 status；阻止继续操作的错误使用 alert。

保留原生语义，不为复用而包装掉需求要求的 DOM 角色。现有同名文件与批准 capability 冲突时不得覆盖；沿用项目实现或显式重构后再安装。
