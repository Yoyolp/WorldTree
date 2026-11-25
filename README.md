# 世界树 · WorldTree

> 剧本驱动的 AI 互动阅读与跑团平台。统一规则引擎、SillyTavern 兼容内容层、Markdown 剧本 DSL。
> 保存、分叉、从任意存档继续推演，把每个选择都写成一条独立的世界线。

---

## 这一版做了什么（v0.2 重构）

| 能力 | 实现方式 |
|---|---|
| **统一规则引擎** | 三种模式（自由叙事/剧本/跑团）共用同一个 TurnResolver：意图 → 检定 → 事件 → 状态 → 叙事。差别只在「选项来源」与「规则包」 |
| **三个规则包** | `coc7`（完整：难度分级/奖励惩罚骰/幸运改判/孤注一掷）、`coc-d100`（简化）、`narrative`（失败也推进）。世界级选择 |
| **内容即文件** | `content/` 目录是唯一真源，启动扫描校验入 SQLite 作读模型；网页保存写回文件。可 VSCode + git 批量编辑 |
| **SillyTavern 兼容** | 角色卡 `chara_card_v2`、世界书 `World Info` 字段全对齐；支持 **JSON 与 PNG 角色卡**双向导入导出 |
| **剧本 Markdown DSL** | 人写友好、可 diff，编译成 JSON 节点图；支持反向序列化（格式化）与节点标题引用 |
| **事件系统** | 世界级全局事件 + 节点内嵌固定事件；条件组 + 概率 + 冷却 + 一次性 + 分组 |
| **可复现随机** | 每回合随机种子写进消息，分叉重演同一存档结果不变 |
| **Material You** | 10 套预设调色板 + 跟随世界封面色动态生成整套色阶 |
| **图标统一** | 全面 Material Icons（Outlined/Filled/Round 三态可切换），不再用 emoji 作图标 |

---

## 技术栈

- **前端**：Vue 3 + TypeScript + Vite + Pinia + vue-router
- **UI**：Material 3 / [mdui](https://www.mdui.org/zh-cn/) Web Components
- **后端**：Node.js + TypeScript + Fastify
- **存储**：SQLite（`node:sqlite`，零原生依赖）
- **流式**：SSE

```
WorldTree/
├─ apps/
│  ├─ server/
│  │  ├─ content/               ← 内容真源（worlds / characters / worldbooks / scripts）
│  │  └─ src/
│  │     ├─ content/store.ts     文件读写 + 扫描入库
│  │     ├─ content/png.ts       PNG 角色卡生成
│  │     ├─ engine/resolver.ts   统一规则引擎
│  │     ├─ lib/lore.ts          世界书扫描
│  │     └─ llm/prompt.ts        提示词编排
│  └─ web/
├─ packages/shared/
│  ├─ types.ts        领域模型
│  ├─ dice.ts         骰子与检定（纯函数，前后端共用）
│  ├─ events.ts       事件引擎（纯函数）
│  ├─ script-dsl.ts   剧本 Markdown DSL
│  ├─ sillytavern.ts  ST V2 双向转换 + PNG tEXt
│  └─ rulepacks.ts    规则包定义
└─ tools/
   ├─ smoke.mjs       97 项端到端测试
   ├─ mock-llm.mjs    本地假模型
   └─ ui-check.mjs    无头浏览器交互验收
```

---

## 快速开始

需要 **Node.js ≥ 22.5**（依赖内置 `node:sqlite`）与 **pnpm**。

```bash
cd D:\WorldTree
pnpm install

# 开发（两个终端）
pnpm dev:server   # http://127.0.0.1:5174
pnpm dev:web      # http://127.0.0.1:5173（/api 自动代理）

# 或生产单端口
pnpm build
pnpm start        # http://127.0.0.1:5174

```

也可直接双击 `start.ps1` / `start.bat`。

### 首次登录

平台带账号体系，**必须登录才能用**。首次启动会自动创建内置管理员：

```
账号：admin
初始密码：<启动日志里打印的一次性随机密码>
```

那段密码**只在首次创建时打印一次**（只存 scrypt 哈希，服务端拿不回明文）。忘记密码就只能：
- 用 admin 身份在「设置 → 账号」重置自己 → 需要旧密码；或
- 删掉 `apps/server/data/users.json` 重启，会重新生成一个 admin 与新的初始密码。

其余账号由 admin 在「设置 → 账号」创建，没有自助注册。

**权限模型**：

| 范围 | 谁能改 |
|---|---|
| 内容库（世界 / 角色卡 / 世界书 / 剧本） | 所有登录用户（共享，可编辑） |
| 世界线、存档、房间 | 各自创建者（互相看不见） |
| 模型接入、上下文探测、账号管理、内容安全 | 仅 admin |

> 「敏感内容」由 admin 在「设置 → 内容安全」里调（叙事尺度开关 + 自定义红线），会作为红线注入系统提示。

首次启动会在 `apps/server/content/` 写入示例内容（4 世界 / 5 角色 / 3 世界书 / 2 剧本），零编译错误：

| 世界 | 模式 | 说明 |
|---|---|---|
| 灰潮 | COC 跑团 | 雾岬港的第七次退潮 |
| 末班列车 | 剧本驱动 | 15 节点 · 5 事件 |
| 夜航图书馆 | 自由叙事 | 治愈向，叙事规则包 |
| **哈利·波特与魔法石** | 剧本驱动 · COC7 | **45 节点 · 54 事件 · 36 条世界书**；11 岁调查员视角，按角色卡关键词分院 |
| **哈利·波特与密室** | 剧本驱动 | **续作示例**，声明 `inheritance`，只接受《魔法石》的结局存档 |

---

## 内容层：文件即真源

```
apps/server/content/
├─ worlds/*.json            世界定义
├─ characters/*.json|*.png  角色卡（ST V2；PNG 即角色卡格式）
├─ worldbooks/*.json        世界书（原生或 ST World Info）
└─ scripts/*.md             剧本（Markdown DSL）
```

- 启动时扫描 → 校验 → 同步进 SQLite（读模型）
- 网页上保存 = 写回文件，再重新扫描
- 手写/脚本/git 批量改文件同样生效（重启或调 `POST /api/content/sync`）
- `GET /api/content/health` 返回错误与警告清单

---

## 剧本 Markdown DSL

```markdown
---
id: last-train
title: 末班列车
start: car1
rulePack: coc7
---

# 第一节车厢 · 广播 {id=car1}

列车晃了一下，你从座位上惊醒。

::: director
建立诡异但不恐怖的气氛，不要提前揭示列车员身份。
:::

::: event 第一次广播 once chance=100%
广播里混进了一个不属于广播员的笑声。
- san: -1
:::

::: on-enter
san: -2
flag: 上车
:::

- [留在原地，观察车厢] -> seat {flag=谨慎} {check=侦查 常规}
- [走向第三节车厢] -> car3 {var:车厢=3}
- [试着拉开车门] -> door {san=-1d3}

# 在世界之间下车 {id=end-off ending=在世界之间下车}

你踏下车门。雪没有想象中那么冷。

::: world-events
## 雾中汽笛
- trigger: turn_end
- chance: 12%
- cooldown: 4
- when: san<40
- narrative: 雾里传来一声汽笛……
- san: -1
:::
```

| 语法 | 含义 |
|---|---|
| `# 标题 {id=x}` | 定义节点；`ending=结局名` 标记结局 |
| `- [文字] -> 目标 {…}` | 选项。目标可写节点 id 或节点标题 |
| `{check=侦查 常规}` | 选项附带技能检定（常规/困难/极难） |
| `{san=-1} {flag=x} {hp=-2} {item=钥匙} {var:键=值}` | 选项效果 |
| `::: director` | 只给 AI 看的导演备注 |
| `::: event 名 [once] [chance=30%] [cooldown=3]` | 内嵌事件（默认 `enter_node` 触发） |
| `::: on-enter` | 进入节点时的效果 |
| `::: world-events` | 全局事件表（文末，用 `## 事件名 once` 分段） |
| 块内 `- chance: 45%` / `- cooldown: 3` / `- trigger: turn_start` | 覆盖概率、冷却与触发时机 |
| 块内 `- when: flag=x` / `- when: node=ch05` / `- when: san<40` | 触发条件，多条为 AND |

编辑器实时编译：左源码 / 中节点图 / 右详情与问题列表。

---

## 事件系统

```ts
{
  id, name,
  scope: 'world' | 'node',
  trigger: 'turn_start' | 'turn_end' | 'enter_node' | 'player_action' | 'before_narration',
  once: boolean,          // 只触发一次
  chance: 0..1,           // 触发概率
  cooldown: number,       // 冷却回合
  priority: number,
  conditions: [...],      // flag / var / stat / node / turn / scene / chance
  narrative?: string,     // 注入给模型的叙事
  state?: { sanDelta, hpDelta, set, addFlags, ... },
  goto?: string,          // 跳转节点
}
```

- 每回合最多触发 2 个，按优先级排序
- 固定事件 = `chance: 1`（可选 `once: true`）
- 触发记录（含 random roll）写进消息 `meta.events`，重演可复现
- 条件组 `conditions` 全部满足（AND）才会触发；常用写法 `flag=分院·斯莱特林`、`!flag=与纳威交好`、`node=ch12`、`san<40`

**同一段剧情按状态分版**：给两条同位置的事件各写一个互斥条件，就能让同一个节拍在不同状态下读起来完全不同。

```md
::: event 抢球 chance=100% once
马尔福把记忆球抛向空中又接住。「来拿啊！」
- when: !flag=与纳威交好
:::

::: event 抢球·纳威的提醒 chance=100% once
你身后，纳威还坐在地上按着手腕：「别……别去，那球记仇。」
- when: flag=与纳威交好
:::
```

**日常事件池**：文末 `::: world-events` 里一节点一条，用 `node=` 门控 + 概率 + 一次性，主线之外的小插曲。

```md
::: world-events
## 站台的钟 once
月台上那座钟快了四分钟。你盯着它看，它又慢回去两分钟。
- chance: 40%
- cooldown: 3
- trigger: turn_start
- when: node=ch05
:::
```

---

## SillyTavern 兼容

**角色卡 V2**：`name / description / personality / scenario / first_mes / mes_example / creator_notes / system_prompt / post_history_instructions / alternate_greetings / tags / creator / character_version / extensions`

- 本平台扩展放在 `extensions.worldtree`（图标、面板、绑定世界书），其它工具会原样保留
- `GET /api/characters/:id/export` → V2 JSON
- `GET /api/characters/:id/export-png` → 内嵌 `chara` tEXt 的 PNG
- `POST /api/characters/import` / `import-png` → 导入

**世界书**：`key / keysecondary / comment / content / constant / selective / selectiveLogic / order / position / disable / probability / useProbability / depth / group / caseSensitive / matchWholeWords / sticky / cooldown`

---

## 导入模型

**设置 → 模型接入**，任何 OpenAI `/chat/completions` 兼容服务均可。

| 服务 | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` |
| Anthropic | `https://api.anthropic.com/v1`（走 /messages） |
| **Ollama** | `http://127.0.0.1:11434/v1`（Key 留空） |
| **LM Studio** | `http://127.0.0.1:1234/v1`（Key 留空） |

未配置或连不上时自动进入**离线旁白模式**，界面不崩、剧本仍可推进。

### 离线验证链路

```bash
node tools/mock-llm.mjs     # 监听 5999
# 设置里填 http://127.0.0.1:5999/v1，模型名 mock-storyteller
```

---

## 核心机制

### 检定（COC7）

- 1d100，成功等级：大成功(1) / 极难(≤技能/5) / 困难(≤技能/2) / 常规(≤技能) / 失败 / 大失败(100，或技能<50 时 96-100)
- 奖励骰取多组十位骰的最小值，惩罚骰取最大值
- 消耗幸运改判：每 1 点换 1 点差额
- 孤注一掷：失败后重掷，代价由叙事承担

### 存档与分叉

- 每条消息都是一个存档点
- **分叉**：复制该消息前的历史 + **快照那一刻的状态**，新世界线从分叉点继续
- **回退**：删掉该消息之后的内容，在原线上重写

### 世界书扫描

1. 取最近 `scanDepth` 条消息拼成窗口
2. 主关键词命中 + 选择性逻辑（AND/OR/NOT）判次关键词
3. 常驻条目直接入选
4. 概率判定（`useProbability`）
5. 同组只保留优先级最高的一个
6. 按优先级排序，在 `tokenBudget` 内注入，按 `position` 插入提示词对应位置

---

## 测试

测试脚本会自动登录（通过 `tools/_auth-patch.mjs` 给请求补 Bearer 头），
所以要先给出 admin 密码或一个现成 token：

```bash
export WT_BASE=http://127.0.0.1:5174
export WT_ADMIN_PASSWORD='<admin 初始密码>'   # 或 export WT_TOKEN=<已登录 token>
```

```bash
node tools/smoke.mjs                  # 97 项端到端检查（需先启动后端）
node tools/check-combat.mjs           # 战斗流程（20 项）
node tools/check-pov.mjs              # 幕间成长 + 私密视角（17 项）
node tools/check-kp.mjs               # KP 模式（14 项）
node tools/check-lite.mjs             # 剧本简化判定包（23 项）
node tools/check-inherit.mjs          # 能力 / 继承 / 续作 全流程（23 项）
node tools/check-rooms.mjs            # 多人房间回合与权限（26 项）
node tools/ui-check-tabs.mjs          # mdui 组件绑定回归（19 项）

# 这几项跨包引用共享层源码，要用 tsx 跑
npx tsx tools/check-coc.mjs           # COC7 判定引擎（36 项）
npx tsx tools/check-parse.mjs         # 元数据容错解析（21 项）
npx tsx tools/check-plot.mjs          # 条件变体 / 日常事件池 / 插曲与兜底 / 截断容错（61 项）

node tools/ui-check.mjs <sessionId>   # 无头浏览器交互验收
```

覆盖：内容扫描零错 / 规则包差异 / 剧本编译与往返 / 检定可复现与奖励惩罚骰 / 意图推断 / 事件触发与 once 语义 / ST JSON+PNG 往返 / 世界书 ST 字段 / 分叉快照 / 回退 / 存档级联删除 / 存档导出导入 / 哈利·波特剧本图完整性。

```bash
node tools/ui-check-save.mjs          # 存档删除/导出/导入 的浏览器端验收（14 项）
node tools/ui-check.mjs <sessionId>   # 阅读器交互验收
```

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/content/health` | 内容巡检（含错误/警告） |
| POST | `/api/content/sync` | 重新扫描 content/ |
| GET | `/api/rulepacks` | 规则包列表 |
| GET/POST | `/api/worlds` | 世界列表/创建 |
| GET/PATCH/DELETE | `/api/worlds/:id` | 世界详情（含剧本源码）/更新/删除 |
| GET | `/api/scripts` | 剧本列表（含编译状态） |
| GET/PUT | `/api/scripts/:id` | 剧本源码与编译结果 |
| POST | `/api/scripts/compile` | 编译 Markdown（不落盘） |
| POST | `/api/scripts/serialize` | JSON → Markdown |
| GET/POST | `/api/worldbooks` | 世界书列表/创建 |
| GET/PATCH/DELETE | `/api/worldbooks/:id` | 世界书 CRUD |
| GET | `/api/worldbooks/:id/export` | 导出 ST World Info |
| POST | `/api/worldbooks/import` | 导入 ST World Info |
| GET/POST | `/api/characters` | 角色列表/创建 |
| GET/PATCH/DELETE | `/api/characters/:id` | 角色 CRUD |
| GET | `/api/characters/:id/export` | 导出 ST V2 JSON |
| GET | `/api/characters/:id/export-png` | 导出 PNG 角色卡 |
| POST | `/api/characters/import` / `import-png` | 导入角色卡 |
| POST | `/api/characters/roll-sheet` | 随机调查员面板 |
| GET/POST | `/api/worlds/:worldId/sessions` | 世界线列表（含树）/新建 |
| GET/PATCH/DELETE | `/api/sessions/:id` | 世界线详情/更新/删除 |
| POST | `/api/sessions/:id/fork` | 分叉（含状态快照） |
| POST | `/api/sessions/:id/rewind` | 回退 |
| GET | `/api/sessions/:id/export` | 导出存档（.wtsave.json） |
| POST | `/api/sessions/import` | 导入存档（跨世界会被拒绝） |
| GET | `/api/worlds/:id/inheritance` | 该世界能接收哪些继承存档 |
| GET/POST | `/api/legacies` · `/api/legacies/:id` | 继承存档列表 / 详情 / 删除 |
| GET/POST | `/api/rooms` | 房间列表 / 创建房间 |
| POST | `/api/rooms/join` | 用加入码进团 |
| GET | `/api/rooms/:id/events` | 房间实时事件流（SSE） |
| POST | `/api/rooms/:id/{start,next,ready,skip,character,leave}` | 开始 / 推进回合 / 准备 / 跳过 / 绑角色 / 离开 |
| POST | `/api/sessions/:id/roll` | 技能检定 |
| POST | `/api/sessions/:id/intent` | 意图推断（预览） |
| POST | `/api/roll` | 自由投骰（支持 seed） |
| POST | `/api/chat` | **推演**（SSE 或 JSON） |
| GET/PUT | `/api/settings/llm` | 模型配置（Key 脱敏） |

SSE 事件：`start` / `token` / `reasoning` / `rolls` / `checks` / `events` / `choices` / `state` / `notice` / `done` / `error`

---

## 数据与隐私

- 运行期数据：`apps/server/data/worldtree.db`（SQLite WAL）
- 内容源文件：`apps/server/content/`（可用 `WORLDTREE_CONTENT` 覆盖）
- 数据目录可用 `WORLDTREE_DATA` 覆盖
- 除你自己填的模型接口外，没有任何数据外发

---

## 后续可讨论的方向

1. **剧本 DSL 增强**：变量插值、条件分支（`if flag`）、并行节拍、章节嵌套
2. **提示词预设系统**：类似 ST 的 preset / 正则脚本，支持作者自定义输出清洗
3. **多人跑团**：一条世界线多人输入，KP 与玩家权限分离
4. **世界线可视化**：节点树形图 + 分支对比（目前为列表）
5. **内容包分发**：`.wtpack` 打包格式（世界+角色+世界书+剧本一体导入）

---

## 许可

示例剧本、世界书与角色卡仅用于演示，可自由修改与替换。




---

---

## 本地小模型排障

7B 级别的本地模型（Qwen2.5-7B / Llama-3.1-8B 等）输出结构化工整度有限，最容易踩的坑是**上下文窗口**，而不是 `max_tokens`。

### 先对齐上下文窗口（现在是自动探测的）

「设置 → 模型接入」里有一个 **模型上下文窗口（tokens）**，旁边有 **探测真实上下文** 按钮。

点一下，服务端会去问本地推理服务它到底有多少上下文：

| 服务 | 探测方式 | 坑 |
|---|---|---|
| llama.cpp / llama-server | `GET /props` 的 `n_ctx` ÷ `total_slots` | `--parallel 4` 会把总上下文**切成 4 份**，每个请求只能用 1/4。16384 ÷ 4 = **4096**，但 `/v1/models` 什么都不告诉你 |
| Ollama | `GET /api/ps` 的 `context_length` | 不设 `num_ctx` 时用服务端默认值（常见 2048/4096） |

探测结果会在启动时自动跑一次，并且**强制夹住**提示词预算：你填 12288、实际只有 4096，系统也只按 4096 算。

```bash
# llama.cpp：想让 9B 模型真正用满上下文，别开并发槽
llama-server -m model.gguf -c 16384 -np 1
```
```bash
# Ollama：走原生 /api/chat 下发 num_ctx（本平台已支持，填设置页的 num_ctx 即可）
OLLAMA_CONTEXT_LENGTH=12288 ollama serve
```

> Ollama 的 OpenAI 兼容接口（`/v1/chat/completions`）**不接受** `num_ctx`，所以本平台对 Ollama 改走原生 `/api/chat` 把 `num_ctx` 真正下发。其它本地服务（llama.cpp / LM Studio）仍在 `/v1` 上，只能靠探测 + 启动参数。

**填大了会怎样**：prompt 超过真实窗口时，服务端会从**头部**静默截断——输出格式、剧本位置、世界设定一起没了。模型于是自由发挥、丢选项，正文还经常断在半句。系统现在会：

1. 探测真实窗口并夹住预算（`contextWindow = min(你填的, 探测值)`）
2. 中文按 **1 字 1 token** 保守估算（低估是截断的头号帮凶）
3. 系统提示超预算时逐级瘦身：先丢世界书 → 再丢节点目录/继承/事件 → 最后压成摘要（`compactNarrative`）
4. 输出被截断时发一条 `notice` 说明原因，并在消息里记 `outputTruncated` / `usage` / `reasoningLen`

### 推理模型要关思考链

Qwen3 / Qwen3.5 这类「思考型」模型，**思考 token 和正文共享同一个输出预算**。思考一长，JSON 就在半路没了。

- 设置里的 **关闭模型思考链** 默认开启
- 对 llama.cpp 下发 `chat_template_kwargs: { enable_thinking: false }`
- 对 Ollama 下发 `think: false`
- 同时在最后一条用户消息尾部补 `/no_think`

如果关不掉（某些魔改模板不认），就把 **最大输出 tokens** 调到 3072 以上，用预算换空间。

### 已经内建的容错

模型不听话时，系统会依次尝试：

1. **标准标记** `<<<WT_META>>>…<<<END_META>>>`
2. **裸 JSON**：忘了写标记，末尾直接贴 JSON → 从尾部识别并切走
3. **截断修复**：JSON 写一半被上下文掐断 → 自动补引号和括号
4. **行内选项**：`>>> 选项A / 选项B` → 剥离，并在没有剧本选项时转成真按钮
5. **思考标签**：`</think>`、` thinking…<｜end▁of▁thinking｜>` 残留 → 清掉
6. **模型兜底**：以上都失败 → 发一次 `max_tokens=600, temperature=0` 的小请求，让它「只把这段转成 JSON」

### 历史净化

坏格式一旦存进正文，会回灌给模型并被模仿，越写越糟。系统在发送历史前会再清洗一次；已有的污染数据可以手动清：

```bash
npx tsx tools/clean-polluted.mjs          # 预演，看看会改哪些
npx tsx tools/clean-polluted.mjs --apply  # 真正写入
```

### 选项来源

- **模型选项优先**：更贴当前情境
- 模型没给可推进的选项时，自动补上剧本节点分支，避免永远停在同一节点
- 模型把剧本选项原样抄一遍时，会继承剧本的 `next`，保证点了能往下走
- 模型可以写 `"goto": "节点id"` 主动把剧情推进到别的节点

### 剧情插曲（跑偏不是错误，是额外回合）

玩家可以完全不点选项、用自由输入把剧情带到任何地方。系统不会拒绝，也不会跳出来劝你——它把这一回合当成**额外回合**处理。

- `state.plotDrift` 只记账：连续几回合没推进剧本节点
- 玩家点了剧本选项 / 模型选项带 `next` 被点中 / 事件 `goto` 跳了节点 → 立即归零
- 偏离期间，系统从**母题库**里随机抽 3 条塞给模型当素材（`PLOT_MOTIFS`），让它写一件小事，而不是凭空发散：

| 偏离 | 系统做什么（全部不显示给玩家） |
|---|---|
| 1~3 回合 | 只写插曲：小事件、有后果、不推进主线；选项里留一个自然的回线入口 |
| ≥ 4 回合 | 插曲开始收尾：让与节拍有关的东西重新出现（传话、铃响、求助） |
| ≥ 6 回合 | 兜底：允许一次不可拒绝的事件把场景带回去，或因势写 `goto` 翻页；此时可推进的剧本分支才会被排到选项队首 |

> 界面上**没有任何**「已偏离主线 / 正在收束」之类的 log。收束是防止剧情崩坏的安全网，不是玩家要面对的规则。

```bash
npx tsx tools/check-plot.mjs   # 条件变体 / 日常事件池 / 插曲与兜底 / 截断容错（61 项）
```

### 排障入口

阅读器侧栏 →「调试 · 模型原始输出」，可以直接看到模型吐了什么（含被剥离的 JSON），以及上一条是否走了兜底解析。

## 多人跑团（局域网）

服务默认绑定 `0.0.0.0`，启动日志会打印局域网地址。同一 Wi-Fi 下的设备直接打开即可。

- **形态**：一名 KP（主持人）+ 最多 7 名玩家，共享同一条世界线
- **加入码**：6 位（去掉易混字符），可加房间密码
- **推进**：按座位轮流；只有轮到的人能发言，其他人只读
- **KP 特权**：跳过某人、强行推进、踢人
- **角色卡**：每人可绑定自己的角色卡，面板与能力随之带入
- **实时**：`GET /api/rooms/:id/events` 一条 SSE 广播通道

```bash
node tools/check-rooms.mjs   # 创建/加入/开始/轮流/越权/跳过/离开
```

## 能力（金手指）

能力不是「写进提示词的一句话」，而是引擎真正会计算的东西：

```ts
{
  name: '蛇佬腔',
  kind: 'cheat',
  description: '你能与蛇交谈…',
  effect: {
    checkBonus: [{ skill: '话术', value: 20 }],  // 检定目标值 +20
    grantsFlags: ['蛇佬腔'],                      // 进场自动获得标记
    cost: { san: 1 },                             // 使用代价
    onUseNarrative: '你的喉咙里发出低沉的嘶声…'   // 注入叙事的提示
  },
  uses: { max: 3, recharge: 'scene' },            // 每场景 3 次
  unlocked: true,
  inheritable: true
}
```

在角色卡编辑器的「能力」标签页里可视化编辑。检定明细会写明加值来源：

```
掷出 87，目标 70（能力加值 +20）
```

## 继承（跨作品延续）

一条世界线走到**结局节点**时，自动生成 `LegacySnapshot`：

| 字段 | 内容 |
|---|---|
| `abilities` | 能力（含金手指） |
| `sheet` | 最终面板（属性/技能/物品） |
| `relationships` | 人际关系（来自 `vars` 里的 `rel.<名字>` 约定） |
| `flags` | 关键选择标记 |
| `vars` | 对世界造成的改变 |
| `summary` | 前情提要 |

续作在世界 JSON 里声明接受哪些字段：

```json
{
  "inheritance": {
    "enabled": true,
    "accepts": ["abilities", "relationships", "flags", "items", "summary"],
    "fromWorldIds": ["harry-potter-1"],
    "decay": 1,
    "header": "二年级 · 你从上一部带回来的东西"
  }
}
```

导入后：继承数据会**注入提示词**（作为既成事实），关键标记合并进 `flags`，剧本可以据此分支：

```md
- [你曾与伏地魔正面交锋过，你不害怕] -> ch08 {require=legacy:面对伏地魔}
- [让蛇佬腔自然生效] -> ch06 {require=ability:蛇佬腔}
- [你与斯内普的关系让你本能地看向他] -> ch05s {require=rel:斯内普 min=-100}
```

未声明继承的世界会**明确拒绝**导入，不会产生推进不了的坏存档。
---

## 规则包一览

| id | 名称 | 骰子 | 难度分层 | 奖励骰 | 幸运 | 孤注一掷 | 理智 | 战斗 | 失败推进 |
|---|---|---|---|---|---|---|---|---|---|
| `coc7` | 克苏鲁的呼唤 7 版 | d100 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `coc-d100` | 简化 d100 | d100 | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| **`script-lite`** | **剧本简化判定** | d100 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `narrative` | 叙事优先 | d20 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### 剧本简化判定（`script-lite`）

专门给剧本用：**一次 d100，≤ 目标就算成功**。没有奖励骰、没有幸运改判、没有理智检定、没有战斗流程。

角色**不需要跑团面板**。没有技能值时按难度取固定值：

| 难度 | 目标值 |
|---|---|
| 常规 | 50 |
| 困难 | 30 |
| 极难 | 15 |

只保留 1（大成功）和 100（大失败）两个戏剧性结果。失败也推进剧情。

**怎么选**：

- 世界编辑 →「规则」标签 → 规则包下拉选「剧本简化」
- 或者剧本 front-matter 里写：
  ```yaml
  ---
  id: my-script
  title: 我的剧本
  start: s1
  rulePack: script-lite
  ---
  ```

优先级：世界线显式指定 > 世界的 `rulePackId` > 剧本的 `rulePack` > 按模式默认。

某个规则包不支持的能力会被明确拒绝，例如简化包里调战斗接口会返回「当前规则包不支持战斗」。
---

## 按关键词分院

世界可以声明一套分院规则，进入世界线时会按角色卡的**标签 / 能力 / 描述**判定归属：

```json
{
  "sorting": {
    "houses": [
      { "name": "格兰芬多", "keywords": ["勇敢", "勇气", "胆量", "正义", "冲动"] },
      { "name": "赫奇帕奇", "keywords": ["忠诚", "勤奋", "耐心", "善良", "踏实"] },
      { "name": "拉文克劳", "keywords": ["聪明", "好奇", "求知", "理性", "观察"] },
      { "name": "斯莱特林", "keywords": ["野心", "精明", "算计", "蛇佬腔"] }
    ],
    "fallback": "拉文克劳"
  }
}
```

判定结果会写成标记 `分院·拉文克劳`（剧本里用 `{require=flag:分院·拉文克劳}` 只在该院显示对应分支）和变量 `house`。

### 角色卡的「适龄」约束

《魔法石》调查员版要求玩家是 11 岁：STR/CON/SIZ 偏低（30~45）、EDU 上限约 60，搬不动盔甲、跑不过级长、宵禁后不能出宿舍；但 DEX 与 LUCK 高，而且「孩子问问题，大人往往愿意回答」。

示例卡：`content/characters/hp-first-year.json`（HP 8/8、SAN 55、天赋「从不漏看的眼睛」侦查 +10）。

## 开局选角色卡

以前开局只问一句「你的称呼」，主角卡写死取世界里标记 `isPlayer` 的那张。现在改成正经选卡：

```
开局 → 你扮演谁？
  ○ 不绑定角色卡          自动生成一名调查员
  ○ 林砚 [世界自带]        世界队内的角色
  ○ 我的调查员 [角色库]     角色库里自己的卡
     ▸ 高级 · 同行角色（默认全选，记住上次的选择）
```

- 角色库里的卡可以直接当主角：属性、技能、能力、物品都跟着走；卡上没有面板就按规则包生成
- 玩家名默认取角色卡名，不用再填「旅人」
- 上次选的角色卡与同行名单记在 `localStorage`（键 `wt.start.<worldId>`），下次进来预选好
- 世界可以声明主角是否写死：

```json
{ "playerCardMode": "fixed" }
```

| 值 | 含义 |
|---|---|
| `open`（默认 / 不写） | 世界队内的角色 + 角色库里的卡都能当主角 |
| `fixed` | 主角已写死在剧本里，只能用本世界自带的角色卡；外来卡和「不绑定」都会被服务端拒绝（400） |

对应地，`POST /api/worlds/:id/sessions` 的 `playerCharacterId` 有三种语义：

- 不传 → 用世界自带的主角卡（老行为，老调用方不受影响）
- `null` → 明确「不绑定角色卡」，随机生成调查员
- 字符串 → 就用这张卡

在「世界编辑 → 角色」里可以直接切这个开关。

## 内网穿透
```bash
 ./ngrok http 5174 --url https://pasty-wimp-unfocused.ngrok-free.dev
```

> ⚠️ 这个平台加了账号体系（登录 + 按账号隔离存档），但它**不是抗公网攻击的设计**：
> 没有验证码、没有登录限流、密码找回靠管理员。用 ngrok 暴露到公网前请自己想清楚，
> 至少先把 admin 密码换成一个强密码。

---

## 变更记录（v0.3）

### 修掉的问题

| 问题 | 原因 | 修法 |
|---|---|---|
| **节点 `on-enter` 每回合重复结算** | 停在节点里每回合都重新 `enterNode`，`san/hp` 无限叠加 | `enterNode` 加 `applyOnEnter` 选项，只有真正换节点时才结算 |
| **角色卡往返丢 `abilities`** | `toSTCard` 的 `extensions.worldtree` 漏了 abilities | JSON 与 PNG 两条路径都带上并读回 |
| **并发推演丢状态** | 读 state → 算 → 写回不是原子的 | `lib/session-lock.ts` 按 sessionId 串行化（JSON 与 SSE 两条路径都覆盖） |
| **分叉/回退状态不对** | 用的是父线「当前」状态，不是那一刻 | 每条消息存完整状态快照（`message_states` 表），分叉与回退都精确还原 |
| **种子掺了墙钟** | `Date.now() % 1000` 进了 seed | 改成 `会话种子 + 回合数`，同一存档点重演结果一致 |
| **世界书一批字段没接线** | `sticky/cooldown/at_depth/recursiveScanning` 只存不用 | 扫描器全部实现，跨回合状态存在 `state.lore` |
| **`world.rules` 是装饰品** | 只有 `style/directives` 被读 | `autoCheck / choiceCount / failForward` 真正参与决策 |
| **`requireAbility` 永远不认自身能力** | 判断里写了个空 Set | 传入角色卡自带能力一起判 |
| **能力次数永不恢复** | `resetUsesFor` 从没被调用 | 回合/场景切换时按 `recharge` 重置 |
| 幽灵文件 `NUL`、空壳 `log_format.ts` | 历史遗留 | 已删除 |

### 新增

- **开局选角色卡**：`components/StartSessionDialog.vue`（选世界角色 / 角色库的卡 / 不绑定，高级里选同行角色，记住上次选择）；世界新增 `playerCardMode: open | fixed`；`createSession` 的 `playerCharacterId` 支持三态（不传 = 世界自带，`null` = 不绑定，字符串 = 指定）；玩家卡不再重复出现在提示词的「登场角色」里
- **账号体系**：`apps/server/src/lib/users.ts`（scrypt + `users.json`）、`lib/auth.ts`（Bearer 钩子）、`routes.auth.ts`（登录/账号管理）
- **数据隔离**：`lib/access.ts`，世界线与房间按 `ownerId` 过滤；越权返回 404 不泄露存在性
- **内容安全**：admin 在设置页调「叙事尺度」，渲染成提示词红线（`settings.ts` 的 `renderSafety`）
- **登录页**：`views/LoginView.vue`，M3 Expressive 风格
- **PlayView 拆分**：1396 → 856 行
  - `composables/useTurnStream.ts`（SSE 推演）、`useCombat.ts`、`useRoom.ts`、`useSessionTree.ts`
  - `components/PlaySidePanel.vue`（右侧三标签面板）、`PlayComposer.vue`（输入区）
- **M3 Expressive 设计令牌**：`styles/main.css` 重写形状/动效/间距刻度，卡片悬停时圆角与阴影一起「呼吸」

### 测试

全部 **407 项通过**（13 组，含 2 组无头浏览器测试）。测试脚本经 `tools/_auth-patch.mjs` 自动登录。

> 无头浏览器那两组还要额外给 `WT_TOKEN`（它靠 `location.pathname === '/login'` 判断后往 localStorage 写 token）：
>
> ```bash
> WT_TOKEN=$(node -e "…登录拿 token…") node tools/ui-check-tabs.mjs
> ```
>
> `check-coc / check-parse / check-plot` 跨包引用共享层源码，要用 `npx tsx` 跑。

admin
hiMYTDnbM5eppeHan7iM

test
114514