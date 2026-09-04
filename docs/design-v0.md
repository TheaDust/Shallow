有时间约束后，我会把方案压成一个 **“四模块、一个核心原则”** 的架构，而且我觉得它比常见的 Planner/Coder/Tester 多 Agent 更有比赛味。

## 推荐架构：Coverage-First Black-Box Loop

核心原则：

> **OpenCode 负责写，ShallowCode 负责决定“写什么、怎么验、失败后值不值得继续修”。**

```text
Requirements
     │
     ▼
┌───────────────┐
│ 1. ReqLedger  │
│ 原子需求账本   │
└───────┬───────┘
        │ next best requirement
        ▼
┌───────────────┐
│ 2. OpenCode   │
│ Builder       │
└───────┬───────┘
        │ runnable app
        ▼
┌───────────────┐
│ 3. ShadowJudge│
│ 黑盒验收       │
└───────┬───────┘
        │ failure
        ▼
┌───────────────┐
│ 4. RepairGate │
│ 修 / 回滚 / 跳过│
└───────┬───────┘
        │
        └────────────→ OpenCode
```

我会把项目创新点集中在 **2 个地方**。

------

# 1. ReqLedger：不要做大 Planner，做“需求账本”

不要让 OpenCode 自己记：

> “我还有哪些需求没实现？”

Harness 把 requirements 一次性转成：

```json
{
  "R17": {
    "goal": "创建笔记",
    "depends_on": ["R03"],
    "status": "verified",
    "cost": "low"
  },

  "R18": {
    "goal": "刷新后笔记仍然存在",
    "depends_on": ["R17"],
    "status": "failed",
    "cost": "medium"
  }
}
```

只维护四种状态：

```text
TODO
IMPLEMENTED
VERIFIED
FAILED
```

然后每次不是问模型：

> 下一步应该做什么？

而是 Harness 自己选：

$Priority = \frac{Expected\ Test\ Gain} {Estimated\ Cost}$

简单实现甚至不用复杂数学：

```text
依赖满足
+
未覆盖
+
核心 happy path
+
低成本
+
可能影响多个 requirement

优先
```

这会形成一个非常重要的比赛策略：

> **先把 100 个需求做到 70~80 个能过，而不是把前 40 个做到极致。**

这很适合 E2E 按 requirement/test 计分的环境。

------

# 2. 最有特色的地方：Blind Shadow Judge

这是我最推荐你做出差异化的地方。

很多 Harness 都是：

```text
Agent 写代码
↓
Agent 自己写测试
↓
Agent 自己说测试过了
```

问题非常大：

> **运动员自己出题。**

ShallowCode 可以故意设计成**非对称结构**。

### Builder

能看到：

```text
requirements
源码
日志
已有测试
```

负责实现。

### ShadowJudge

只能看到：

```text
requirements
运行中的网站
```

**不看源码。**

然后根据 requirement 产生少量 Playwright 黑盒验收：

```text
Requirement:
创建商品后刷新页面仍存在

ShadowJudge:

1. 打开页面
2. 创建商品 Test123
3. 刷新
4. 搜索 Test123
5. assert visible
```

这样：

```text
Requirement
       │
   ┌───┴────┐
   ▼        ▼
Builder   Judge
   │        │
源码实现    黑盒验收
   └───┬────┘
       ▼
    Result
```

这个设计**很简单，但不俗套**。

因为它模拟的恰好就是：

> **真正的隐藏 E2E 测试。**

你甚至可以把它作为 ShallowCode 的核心理念：

> **Never let the builder grade itself.**

------

# 3. RepairGate：只允许“有价值的修复”

别做无限：

```text
FAIL
↓
请修
↓
FAIL
↓
请继续修
↓
FAIL
...
```

定义一个很简单的策略。

第一次失败：

```text
FAIL
↓
提取：
- failing step
- expected
- actual
- browser console
- server error

↓
OpenCode repair
```

第二次还是同类错误：

```text
same failure
↓
禁止继续盲 patch
↓
要求重新定位 root cause
```

第三次仍失败：

```text
SKIP
```

先去拿别的分。

这点非常重要。

比赛目标不是：

> 把 R53 修到天荒地老。

而是：

$\max Score$

如果一个 requirement 已经花掉大量 token：

```text
R53 ❌
R54 TODO
R55 TODO
R56 TODO
R57 TODO
```

正确策略很可能是：

```text
跳过 R53
↓
拿 R54~R57
```

很多普通 Coding Agent **完全不会主动这样做**。

这就是 Harness 的价值。

------

# 4. Score Frontier：只接受不退步的版本

这个我也强烈建议加，因为实现特别便宜。

维护：

```text
best_passed = 43
best_commit = abc123
```

修改后：

```text
47 passed
```

保存：

```text
best_passed = 47
best_commit = def456
```

如果下一轮：

```text
45 passed
```

直接：

```text
rollback
```

所以整个开发轨迹形成：

```text
31
↓
38
↓
42
↓
47
↓
45  ← reject
↓
49
↓
53
```

实际上就是一个：

# Monotonic Score Search

最终 repo 尽量沿着：

$Score_{t+1} \ge Score_t$

移动。

非常简单，但非常比赛导向。

------

# 最终 ShallowCode 可以只有这些

```text
shallowcode/
│
├── runner.py
│
├── requirements.py
│   └── ReqLedger
│
├── opencode.py
│   └── session / prompt
│
├── judge/
│   ├── generator.py
│   └── playwright_runner.py
│
├── repair.py
│
├── score.py
│
└── state.json
```

不需要：

```text
❌ Vector DB
❌ RAG 系统
❌ 7 个 Subagents
❌ Planner Agent
❌ Architect Agent
❌ Reviewer Agent
❌ 长期 Memory
❌ RL
❌ Tree Search
```

------

# 甚至不要一开始生成所有 Shadow Tests

125 个 requirements：

不要：

```text
125 requirements
↓
一次生成 125 Playwright tests
```

太贵，也容易产生垃圾测试。

采用 **Just-in-time Judge**：

```text
准备实现 R17
↓
生成 R17 的 Shadow Test
↓
OpenCode 实现
↓
运行 Test
↓
记录
```

或者一批：

```text
R17~R21
↓
5 个 shadow tests
```

这样还能根据实际情况不断调整。

------

# OpenCode Session 也不要搞太复杂

我建议：

```text
一个主要 Builder Session
```

保持项目上下文。

Judge 则：

```text
短 session / stateless
```

因为 Judge 只需要：

```text
Requirement
+
browser state
```

如果某个 requirement 卡死，再创建：

```text
Investigator Session
```

专门看：

```text
failure
+
相关文件
```

所以最多：

```text
Builder       长生命周期
Judge         短生命周期
Investigator  按需
```

而不是传统 multi-agent orchestration。

------

# 我会把 ShallowCode 的理念定义成

名字现在反而很好解释：

> **ShallowCode does not make the reasoning tree deeper.
> It makes the feedback loop shorter.**

也就是：

```text
少规划
少角色
少协调

更多：

实现
↓
真实执行
↓
黑盒验证
↓
快速修复
```

甚至 slogan 可以是：

> **Shallow reasoning. Tight feedback.**

这个定位其实挺有辨识度。

------

## 如果只有不到半个月，我认为 V1 只应该有 5 个能力

1. **Requirement Ledger**
2. **OpenCode Builder**
3. **Blind Shadow Playwright Judge**
4. **最多 2 次 Repair + Skip**
5. **Best-score Git Checkpoint**

然后 benchmark：

```text
Vanilla OpenCode
        VS
ShallowCode
```

只记录：

```text
E2E pass rate
token
time
```

如果这五个机制已经能让：

```text
Vanilla      58%
ShallowCode  70%
```

那你就已经有一个非常好的比赛方案了。

之后所有功能都只问一个问题：

> **它能不能提高隐藏测试通过率？**

不能证明提高，就不加。

我认为这比堆各种 Agent 技术更符合你当前的时间条件，而且 **Blind Judge + Score Frontier + Coverage-first scheduling** 三者组合也足够形成自己的特色。