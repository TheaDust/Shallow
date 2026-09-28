---
name: structure-react-features
description: Structure growing React features into stable view, state, domain, and API boundaries. Use when a page accumulates several dialogs or menus, repeated interaction logic, unrelated state transitions, large effects, or changes that risk breaking existing paths.
---

# 拆分 React 功能

## 工作流

1. 先读调用链、现有测试与 `ARCHITECTURE.md`，列出本包新增的状态、事件、持久化和可观察结果。
2. 保留页面作为编排层，把纯领域变换放入独立 `.ts` 模块，把重复交互放入组件，把请求集中到 API 模块。
3. 以稳定的显式 props 连接组件；不要让子组件直接读取全局可变状态，也不要复制一份领域状态。
4. 对共享 primitive、纯函数和 API 合同分别补传统测试，再验证一个端到端关键路径。
5. 更新 `ARCHITECTURE.md` 时只记录稳定边界，合并旧条目并保持不超过 16 KiB。

## 拆分信号

- 页面同时管理三个以上互不相关的弹窗、菜单或表单。
- 单文件混合路由解析、网络请求、领域算法、可访问交互和大量 JSX。
- 同一个保存、权限或选择规则在两个位置出现。
- 修改一条需求需要在一个文件中触碰多个遥远区域。

不要仅为降低行数制造无语义的小文件。每个模块应拥有明确职责、输入输出和独立验证面。
