仅依据所提供的需求证据创建独立的黑盒 browser 探针。返回符合 schema 的 JSON。覆盖每一个所提供的需求 ID。每个 case 必须有一个独立于 steps 的终末 assertion 对象（expectVisible、expectText、expectValue 或 expectCount）。只使用列出的 operation 与可访问的 locator。

## 测试设计原则
每个探针 case 只测试一个原子行为。遵循以下模式：准备前置条件 → 导航 → 交互 → 断言结果。这与真实验收测试的结构一致：一个需求一个测试，一个测试一个行为。

## Case 选择优先级
1. 始终覆盖 happy path：需求所描述的主要用户流程。
2. 当证据声明或暗示以下内容时，补充边界与负向 case：校验规则（必填字段、长度限制、格式约束、数值范围）、唯一性约束、持久化行为（状态在 reload 后存活）或权限/访问控制。
3. 对于边界 case：提交空值、超长输入、非法格式、重复提交。断言声明的错误反馈，同时断言成功效果不存在（count 为 0 的 expectCount，或成功文案不出现）。
4. 对于 seed data：加入一个 case，断言声明的条目在应用列出它们的位置逐字出现。把 seed 记录当作可用的前置数据。
5. 优先把 case 预算花在边界 case 上，而不是额外的 happy path 变体。绝不断言证据未声明的反馈。

## Locator 策略
对于重复出现的控件，将 scope 设为包含它的 role（row、article、listitem、dialog），可选带来自需求证据或先前 fill 值的字面 hasText，然后在该 scope 内定位控件。scope 必须是单层的。
使用 role、label 或 text，字符串取证据中声明的原值，包括 exactUiStrings。字符串按字面匹配，忽略大小写，除非 exact 为 true，否则作为子串匹配；绝不使用正则表达式语法、alternation 或通配符。button、link、checkbox、heading、alert 优先用 role 加 name；表单控件优先用 label；保留应用声明的语言，不要翻译 label。
为关键 locator 给出一到两个 fallback，描述同一控件的其他可访问渲染方式——例如同名 role button，其次 label，再次纯 text——按最具体优先排序；每个 fallback 必须复用证据中声明的字符串，且 fallback 不得嵌套。

## Locator 陷阱
当 exactUiStrings 为空时，优先使用不带猜测 name 的结构化 role，例如主工作区用 main，唯一输入框用 textbox。要求展示首页的需求描述的是页面状态，而不是字面文本 Home 或一个 Home 按钮：导航到 / 并断言所需区域可见。没有声明 exactUiString、seed 条目或先前 fill 值的纯 text locator，必须为同一目标提供 role 或 label fallback。绝不把描述性词汇变成必需的 UI label，也不臆造 seed 记录。

## Step 模式
每个 case 以 goto 开始，指向场景所需的路由，包括证据中声明的 deep link。用 click 触发需求要求的可见入口点。用 fill 和 select 填入已声明的有效数据，用 press 测试键盘行为，用 reload 验证状态在页面刷新后存活，仅在切换到不同 actor 或 session 时使用 newContext。

## 断言模式
expectText 匹配完整的可见文本，除非 exact: false（此时匹配子串）；用简短稳定的子串加 exact: false 断言消息。当证据为同一条消息声明了多种措辞时，用 expectText 的 anyOf 逐字列出这些候选；绝不臆造替代措辞。用 expectValue 断言输入状态，用 count 为 0 的 expectCount 断言不存在，例如没有已登录 session 或没有已创建的记录。对于被拒绝的操作，断言必需的可见反馈以及成功效果不存在。绝不臆造证据未声明的 operation、locator 或行为。

每个 case 在全新的 browser context 中运行，必须自行建立前置条件。
