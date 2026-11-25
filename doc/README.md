# 世界树 · 开发者文档

> 面向要改这个项目的人：结构怎么分、模块各自管什么、内容怎么编写、规则怎么扩展。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-程序结构.md](./01-程序结构.md) | 目录布局、依赖关系、一回合推演的数据流 |
| [02-模块讲解.md](./02-模块讲解.md) | 服务端 / 共享层 / 前端每个文件负责什么 |
| [03-世界书编写.md](./03-世界书编写.md) | World Info 字段、扫描算法、配图 |
| [04-规则插件.md](./04-规则插件.md) | 规则书插件格式、四类判定策略、自定义策略 |
| [05-角色卡编写.md](./05-角色卡编写.md) | ST V2 字段、能力、面板、头像图片 |
| [06-图片与附件.md](./06-图片与附件.md) | assets 目录、上传接口、前端显示 |

---

## 一句话架构

```
content/          文件即真源（世界 / 角色 / 世界书 / 剧本 / 规则插件 / 图片）
   ↓ 启动时扫描
SQLite            只是「读模型」，删了可以重建
   ↓
Fastify 服务      引擎在这里：意图 → 检定 → 事件 → 状态 → 提示词 → 模型 → 解析
   ↓ SSE
Vue 3 前端        只负责展示与输入，不含任何规则判定
```

**最重要的一条设计原则**：LLM 只写叙事，规则、状态、随机性全部留在引擎里。
所以「同一个存档点重演，结果必然相同」是可以做到的。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3.5 + TypeScript + Vite 8 + Pinia + vue-router |
| UI | Material 3 / mdui Web Components |
| 后端 | Node.js + TypeScript + Fastify 5 |
| 存储 | SQLite（`node:sqlite`，零原生依赖） |
| 流式 | SSE |
| 运行 | Node ≥ 22.5（依赖内置 `node:sqlite`） |

---

## 本地起服务

```bash
pnpm install

# 开发（两个终端）
pnpm dev:server   # http://127.0.0.1:5174
pnpm dev:web      # http://127.0.0.1:5173（/api 自动代理）

# 生产单端口
pnpm build
pnpm start        # http://127.0.0.1:5174
```

首次启动会在 `apps/server/content/` 写入示例内容，并在日志里打印一次 admin 初始密码。

---

## 常见改动入口

| 想做什么 | 改哪里 |
|---|---|
| 加一种新的判定方式 | `packages/shared/src/resolution.ts` 加策略 |
| 加一本规则书 | `content/rulepacks/*.js`（不用改代码） |
| 给规则书加技能效果说明 | 插件 `sheetSchema.skills[].description` / `effectText`，百科自动读出 |
| 改提示词结构 | `apps/server/src/llm/prompt.ts` |
| 改回合流程 | `apps/server/src/services/play.ts` 的 `runTurn` |
| 加 API | `apps/server/src/routes.ts` |
| 改内容文件格式 | `apps/server/src/content/store.ts` |
| 加前端页面 | `apps/web/src/views/` + `router.ts` |

---

## 规则百科（`/codex`）

左侧导航的「百科」页把每本规则书摊开给玩家看：

- 判定方式（策略、参数、成功等级分档、大成功/大失败值）
- 能力开关（难度分层、幸运改判、理智、战斗……）
- 角色面板结构（属性 / 资源 / 派生值），并给出一份面板预览
- 技能表：按分组展示，点开可看效果说明与用法示例
- 规则原文（`instructions`，Markdown 渲染并注入模型的那段）

数据全部来自 `GET /api/rulepacks`，**页面只读**。要改内容请改插件文件。

`description` / `effectText` 这些字段只是给人读的说明，不参与判定；
想让技能真影响掷骰，用 `baseFormula` 或角色能力的 `checkBonus`。
