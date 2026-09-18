# 网关 SSE 截断问题报告（2026-09-18）

面向网关维护方；同时记录 ShallowCode 侧已落地的客户端缓解，供后续会话参考。

## 现象

网关在**长流式补全的末尾**偶发把一个 SSE 事件的 JSON 截断，并照常发出事件分隔空行，随后**不发送 `data: [DONE]`**。客户端（OpenAI 兼容）对每个 `data:` 负载做严格 `JSON.parse`，于截断事件处抛 `Unexpected end of JSON input`，整轮流式响应被 abort，之前已流出的全部 token 全部作废。

实测截断样本（`runs/13356-1789656894275/sse-capture/builder-51360-5.sse` 末尾；元数据 `.../builder-51360-5.meta.json`）：

```
data: {"choices":[{"delta":{"content":"","reasoning_content":" model","role":"assistant"},"index":0}],...,"usage":null}

data: {"created":1789657383,"usage":nu
```

最后一行即被截断的**终末 usage 事件**（`"usage":nu` 处断开，缺少 `ll}`）。该响应大小 556 KB、1964 个事件，是当次运行 8 个响应里最大的一个；另外 7 个均以 `data: [DONE]` 正常收尾、0 坏块。

## 影响

- 上一轮：同类报错 5 次，合计约 51.5 分钟，占 96 分钟运行的 54%。
- 本轮：命中一次即让功能组 1 的 14 分 47 秒作废，模块未形成可运行版本并恢复起点。
- 频率：本轮 8 个响应 1 个坏（12.5%），命中最大的那个。
- 报错文本历史：`Unexpected end of JSON input`（本轮）、`Unterminated string in JSON at position 73/122/206/213/270`（上一轮），均属流末截断的同类不同切点。

## 证据指针

- 原始字节 + 元数据：`runs/13356-1789656894275/sse-capture/`（`*.sse` / `*.meta.json`，`anomalies[0].kind = invalid_json: ...`）。
- 客户端报错落点：`runs/13356-1789656894275/pi-sessions/*.jsonl` idx=14（`stopReason=error`）。
- 同刻运行日志：`runs/13356-1789656894275/run-log.txt`（`+15m56s` 行含本轮耗时/token）。
- 抓包开关：`SHALLOW_CAPTURE_SSE`（见 `AGENTS.md`）；抓包只读克隆分支，不改变请求路径。

## 对网关的请求

1. 修复流末事件截断：终末 usage 事件（及任何事件）必须完整写出，不得在半截 JSON 后直接收尾。
2. 无论正常结束还是异常收尾，都发送 `data: [DONE]`；缺失 `[DONE]` 使下游无法区分"正常结束"与"被截断"。
3. 排查长流（数百 KB、近 2000 事件）场景下的事件写出/缓冲路径；短请求探针 0 坏块，问题为长流间歇性，疑与缓冲或超时截断相关。
4. 网关当前不遵守 `max_tokens`（传 200 仍连续输出 400+ 事件），推理无上界；请一并确认。

## ShallowCode 侧已落地的客户端缓解

`src/builder/sse-resilience.ts`（始终启用，与诊断抓包 `sse-capture.ts` 同层，独立于 `SHALLOW_CAPTURE_SSE`）：在 `globalThis.fetch` 上包装 `text/event-stream` 响应，先于 OpenAI 客户端重写事件流：

- 按 `\n\n` / `\r\n\r\n` 缓冲完整事件块，容忍任意 chunk 切分，缓冲上限 1 MB；
- 合法 `data:` 事件与 `[DONE]` 原样转发，流末若无 `[DONE]` 则补发；
- 非法 JSON 事件丢弃并计数（该截断样本为终末 usage 段，内容与工具增量此前已全部到达，丢弃仅损失 usage 统计，本轮得以恢复）；
- 若被丢弃的事件仍含 `choices` / `tool_calls`（可能承载内容或工具调用），不静默接受：以 `provider returned error: gateway truncated a content-bearing SSE event` 使流失败，触发 Pi 侧有界自动重试（`maxRetries: 2`），避免执行残缺工具调用；
- body 层错误不被掩盖，照常冒泡给现有可重试错误处理。

未启用 OpenAI SDK 级 `provider.maxRetries`：该参数只覆盖响应体开始消费前的连接错误，无法重试流中截断；流中错误交由 Pi 侧自动重试。缓解是客户端韧性，不修复网关根因。

回归覆盖：`test/sse-resilience.test.ts`（单元）、`test/pi-worker.test.ts`（端到端：截断终末事件仍 completed；截断内容事件被重试后 failed）。
