<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StoryScript } from '@worldtree/shared';
import { api, type ScriptRecord } from '@/api';
import { askConfirm, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const route = useRoute();
const router = useRouter();

const markdown = ref('');
const record = ref<ScriptRecord | null>(null);
const compiled = ref<StoryScript | null>(null);
const errors = ref<string[]>([]);
const warnings = ref<string[]>([]);
const loading = ref(true);
const saving = ref(false);
const dirty = ref(false);
const activeNode = ref<string | null>(null);
const showHelp = ref(false);

let compileTimer: ReturnType<typeof setTimeout> | null = null;

const nodeCount = computed(() => compiled.value?.nodes.length ?? 0);
const eventCount = computed(() => {
  if (!compiled.value) return 0;
  return (
    compiled.value.events.length + compiled.value.nodes.reduce((a, n) => a + n.events.length, 0)
  );
});

const selectedNode = computed(() =>
  compiled.value?.nodes.find((n) => n.id === activeNode.value) ?? compiled.value?.nodes[0] ?? null,
);

const outgoing = computed(() => {
  if (!compiled.value || !selectedNode.value) return [];
  return selectedNode.value.choices.filter((c) => c.next);
});

const incoming = computed(() => {
  if (!compiled.value || !selectedNode.value) return [];
  return compiled.value.nodes.filter((n) =>
    n.choices.some((c) => (c.effects?.goto ?? c.next) === selectedNode.value!.id),
  );
});

async function load() {
  loading.value = true;
  try {
    const rec = await api.getScript(String(route.params.id));
    record.value = rec;
    markdown.value = rec.sourceMd;
    applyCompile(rec.script, rec.errors, rec.warnings);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function applyCompile(script: StoryScript | null, errs: string[], warns: string[]) {
  compiled.value = script;
  errors.value = errs;
  warnings.value = warns;
  if (script?.nodes.length && !script.nodes.some((n) => n.id === activeNode.value)) {
    activeNode.value = script.nodes[0].id;
  }
}

/** 防抖编译 */
function scheduleCompile() {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(async () => {
    try {
      const res = await api.compileScript(markdown.value, `${route.params.id}.md`);
      applyCompile(res.script, res.errors, res.warnings);
    } catch {
      /* 编译失败保留上次结果 */
    }
  }, 400);
}

watch(markdown, () => {
  dirty.value = true;
  scheduleCompile();
});

async function save() {
  if (!record.value) return;
  saving.value = true;
  try {
    const saved = await api.saveScript(record.value.id, markdown.value);
    record.value = saved;
    applyCompile(saved.script, saved.errors, saved.warnings);
    dirty.value = false;
    toast(saved.errors.length ? `已保存，但有 ${saved.errors.length} 个错误` : '已保存并编译通过');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function format() {
  if (!compiled.value) return;
  try {
    const res = await api.compileScript(markdown.value);
    if (!res.script) {
      toast('无法格式化：剧本未通过编译');
      return;
    }
    // 用 shared 的序列化器重排
    const { serializeScript } = await import('@worldtree/shared');
    markdown.value = serializeScript(res.script);
    toast('已重新格式化');
  } catch (err) {
    toast((err as Error).message);
  }
}

async function copyTemplate() {
  const tpl = `---
id: my-script
title: 我的剧本
start: start
rulePack: coc7
---

# 开篇 {id=start}

这里写玩家进入世界时看到的文字。

::: event 某个事件 once chance=100%
事件发生时注入给模型的叙事。
- san: -1
:::

- [选择 A] -> node-a
- [选择 B] -> node-b {check=侦查 常规}

# 节点 A {id=node-a}

描述……

- [继续] -> end

# 节点 B {id=node-b}

描述……

- [继续] -> end

# 结局 {id=end ending=结局名称}

这里写结局。
`;
  markdown.value = tpl;
  toast('已插入模板');
}

function back() {
  if (dirty.value) {
    askConfirm('有未保存的修改', '确定要离开吗？').then((ok) => {
      if (ok) router.push('/scripts');
    });
  } else {
    router.push('/scripts');
  }
}

function insertAtCursor(text: string) {
  markdown.value += `\n${text}\n`;
}

onMounted(load);
onBeforeUnmount(() => {
  if (compileTimer) clearTimeout(compileTimer);
});
</script>

<template>
  <div class="wt-page wt-script-editor">
    <header class="wt-editor-bar">
      <mdui-button-icon icon="arrow_back" @click="back" />
      <div class="wt-editor-title">
        <strong>{{ compiled?.title || route.params.id }}</strong>
        <span class="wt-small wt-muted">
          {{ nodeCount }} 节点 · {{ eventCount }} 事件
          <template v-if="dirty"> · 未保存</template>
        </span>
      </div>
      <div class="wt-spacer"></div>

      <span v-if="errors.length" class="wt-chip error">
        <span class="material-icons-outlined">error</span>{{ errors.length }}
      </span>
      <span v-else-if="warnings.length" class="wt-chip warn">
        <span class="material-icons-outlined">warning</span>{{ warnings.length }}
      </span>
      <span v-else class="wt-chip ok">
        <span class="material-icons-outlined">check_circle</span>通过
      </span>

      <mdui-button variant="text" icon="help" @click="showHelp = !showHelp">语法</mdui-button>
      <mdui-button variant="outlined" icon="format_align_left" @click="format">格式化</mdui-button>
      <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
    </header>

    <!-- 语法速查 -->
    <div v-if="showHelp" class="wt-help">
      <div class="wt-help-grid">
        <div>
          <div class="wt-label">节点</div>
          <pre># 标题 {id=node-1}
# 结局 {id=end ending=结局名}</pre>
        </div>
        <div>
          <div class="wt-label">选项</div>
          <pre>- [选项文字] -> 目标节点
- [尝试开锁] -> 里屋 {check=锁匠 困难}
- [继续] -> end {san=-1 flag=勇敢}</pre>
        </div>
        <div>
          <div class="wt-label">内嵌事件</div>
          <pre>::: event 事件名 once chance=35% cooldown=3
叙事片段
- san: -1
- flag: 见过
:::</pre>
        </div>
        <div>
          <div class="wt-label">进入效果</div>
          <pre>::: on-enter
san: -2
flag: 进门
item: 旧钥匙
:::</pre>
        </div>
        <div>
          <div class="wt-label">全局事件</div>
          <pre>::: world-events
## 雾中汽笛
- trigger: turn_end
- chance: 12%
- cooldown: 4
- when: san<40
- narrative: 雾里传来汽笛……
- san: -1
:::</pre>
        </div>
        <div>
          <div class="wt-label">其它</div>
          <pre>::: director
只给 AI 看的导演备注
:::

- 效果：san / hp / mp / luck
  flag / unflag / item / check / var:键=值</pre>
        </div>
      </div>
      <mdui-button variant="tonal" icon="content_paste" @click="copyTemplate">插入完整模板</mdui-button>
    </div>

    <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

    <div v-else class="wt-editor-body">
      <!-- 左：源码 -->
      <section class="wt-pane wt-pane-source">
        <div class="wt-pane-head">
          <span class="material-icons-outlined">code</span>
          <span>Markdown 源码</span>
          <div class="wt-spacer"></div>
          <span class="wt-mono wt-muted">{{ record?.file }}</span>
        </div>
        <textarea
          v-model="markdown"
          class="wt-source"
          spellcheck="false"
          placeholder="从这里开始写剧本…"
        ></textarea>
      </section>

      <!-- 中：节点图 -->
      <section class="wt-pane wt-pane-graph">
        <div class="wt-pane-head">
          <span class="material-icons-outlined">account_tree</span>
          <span>节点图</span>
        </div>
        <div class="wt-node-list">
          <button
            v-for="n in compiled?.nodes ?? []"
            :key="n.id"
            class="wt-node"
            :class="{ active: selectedNode?.id === n.id, ending: n.ending, start: n.id === compiled?.startNodeId }"
            @click="activeNode = n.id"
          >
            <span class="wt-node-mark">
              <span class="material-icons-outlined">{{
                n.ending ? 'flag' : n.id === compiled?.startNodeId ? 'play_arrow' : 'radio_button_unchecked'
              }}</span>
            </span>
            <span class="wt-node-body">
              <span class="wt-node-title">{{ n.title }}</span>
              <span class="wt-node-meta wt-mono">{{ n.id }}</span>
            </span>
            <span v-if="n.events.length" class="wt-node-badge" :title="`${n.events.length} 个内嵌事件`">
              <span class="material-icons-outlined">bolt</span>{{ n.events.length }}
            </span>
          </button>
          <div v-if="!compiled?.nodes.length" class="wt-empty-sm wt-muted wt-small">
            还没有解析出节点
          </div>
        </div>
      </section>

      <!-- 右：详情 -->
      <section class="wt-pane wt-pane-detail">
        <div class="wt-pane-head">
          <span class="material-icons-outlined">info</span>
          <span>节点详情</span>
        </div>

        <div v-if="selectedNode" class="wt-detail-body">
          <div class="wt-detail-title">{{ selectedNode.title }}</div>
          <div class="wt-row wt-gap-6">
            <span class="wt-tag wt-mono">{{ selectedNode.id }}</span>
            <span v-if="selectedNode.ending" class="wt-tag end">结局</span>
            <span v-if="selectedNode.id === compiled?.startNodeId" class="wt-tag start">起始</span>
          </div>

          <div class="wt-label" style="margin-top: 12px">正文</div>
          <p class="wt-detail-text">{{ selectedNode.content || '（空）' }}</p>

          <template v-if="selectedNode.directorNote">
            <div class="wt-label">导演备注</div>
            <p class="wt-detail-text wt-muted">{{ selectedNode.directorNote }}</p>
          </template>

          <template v-if="selectedNode.events.length">
            <div class="wt-label">内嵌事件</div>
            <div v-for="ev in selectedNode.events" :key="ev.id" class="wt-event-card">
              <div class="wt-row wt-gap-6">
                <span class="material-icons-outlined">bolt</span>
                <strong class="wt-small">{{ ev.name }}</strong>
                <span class="wt-event-chance">{{ Math.round(ev.chance * 100) }}%</span>
                <span v-if="ev.once" class="wt-tag">一次性</span>
                <span v-if="ev.cooldown" class="wt-tag">CD {{ ev.cooldown }}</span>
              </div>
              <p class="wt-small wt-muted">{{ ev.narrative }}</p>
              <div v-if="ev.state" class="wt-small wt-muted">
                效果：{{ JSON.stringify(ev.state) }}
              </div>
            </div>
          </template>

          <div class="wt-label" style="margin-top: 12px">选项</div>
          <div v-for="c in selectedNode.choices" :key="c.id" class="wt-choice-row">
            <span class="material-icons-outlined">subdirectory_arrow_right</span>
            <div class="wt-choice-info">
              <span class="wt-small">{{ c.text }}</span>
              <span class="wt-choice-tags">
                <span v-if="c.next" class="wt-mono">→ {{ c.next }}</span>
                <span v-if="c.check" class="wt-tag check">检定 {{ c.check.skill }}</span>
                <span v-if="c.effects?.sanDelta" class="wt-tag">SAN {{ c.effects.sanDelta }}</span>
              </span>
            </div>
          </div>
          <div v-if="!selectedNode.choices.length" class="wt-small wt-muted">（没有选项）</div>

          <div class="wt-label" style="margin-top: 12px">连接</div>
          <div class="wt-small wt-muted">
            <div v-if="incoming.length">来自：{{ incoming.map((n) => n.title).join('、') }}</div>
            <div v-if="outgoing.length">指向：{{ outgoing.map((c) => c.next).join('、') }}</div>
            <div v-if="!incoming.length && !outgoing.length">孤立节点</div>
          </div>
        </div>

        <div v-else class="wt-small wt-muted" style="padding: 16px">从左侧选择一个节点</div>

        <!-- 问题列表 -->
        <div v-if="errors.length || warnings.length" class="wt-problems">
          <div class="wt-label">问题</div>
          <div v-for="e in errors" :key="e" class="wt-problem error">
            <span class="material-icons-outlined">error</span>{{ e }}
          </div>
          <div v-for="w in warnings" :key="w" class="wt-problem warn">
            <span class="material-icons-outlined">warning</span>{{ w }}
          </div>
        </div>

        <!-- 全局事件 -->
        <div v-if="compiled?.events.length" class="wt-global-events">
          <div class="wt-label">全局事件（{{ compiled.events.length }}）</div>
          <div v-for="ev in compiled.events" :key="ev.id" class="wt-event-card">
            <div class="wt-row wt-gap-6">
              <span class="material-icons-outlined">bolt</span>
              <strong class="wt-small">{{ ev.name }}</strong>
              <span class="wt-event-chance">{{ Math.round(ev.chance * 100) }}%</span>
            </div>
            <div class="wt-small wt-muted">触发：{{ ev.trigger }} · 冷却 {{ ev.cooldown }}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wt-script-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.wt-editor-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-surface-container-low));
  flex-shrink: 0;
}

.wt-editor-title {
  display: flex;
  flex-direction: column;
}

.wt-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
}

.wt-chip .material-icons-outlined {
  font-size: 0.875rem;
}

.wt-chip.ok {
  background: rgba(76, 175, 80, 0.16);
  color: #2e7d32;
}

.wt-chip.warn {
  background: rgba(217, 131, 36, 0.18);
  color: #a5691c;
}

.wt-chip.error {
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}

.wt-help {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-surface-container));
  flex-shrink: 0;
  max-height: 340px;
  overflow-y: auto;
}

.wt-help-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 12px;
}

.wt-help pre {
  margin: 6px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(var(--mdui-color-surface-container-lowest));
  font-family: Consolas, monospace;
  font-size: 0.6875rem;
  line-height: 1.7;
  white-space: pre-wrap;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-editor-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 260px 300px;
  min-height: 0;
}

.wt-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-pane:last-child {
  border-right: none;
}

.wt-pane-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgb(var(--mdui-color-on-surface-variant));
  border-bottom: 1px solid rgba(var(--mdui-color-outline-variant), 0.3);
  flex-shrink: 0;
}

.wt-pane-head .material-icons-outlined {
  font-size: 1rem;
}

.wt-source {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 16px 18px;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.85;
  background: rgb(var(--mdui-color-surface-container-lowest));
  color: rgb(var(--mdui-color-on-surface));
  tab-size: 2;
}

.wt-node-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: rgb(var(--mdui-color-on-surface));
  width: 100%;
}

.wt-node:hover {
  background: rgba(var(--mdui-color-on-surface), 0.05);
}

.wt-node.active {
  background: rgba(var(--mdui-color-primary), 0.12);
  color: rgb(var(--mdui-color-primary));
}

.wt-node.ending .wt-node-mark {
  color: rgb(var(--mdui-color-tertiary));
}

.wt-node.start .wt-node-mark {
  color: rgb(var(--mdui-color-primary));
}

.wt-node-mark .material-icons-outlined {
  font-size: 1rem;
}

.wt-node-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.wt-node-title {
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-node-meta {
  font-size: 0.625rem;
  opacity: 0.55;
}

.wt-node-badge {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 0.625rem;
  color: rgb(var(--mdui-color-tertiary));
}

.wt-node-badge .material-icons-outlined {
  font-size: 0.75rem;
}

.wt-detail-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
}

.wt-detail-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.wt-detail-text {
  margin: 6px 0 0;
  font-size: 0.8125rem;
  line-height: 1.75;
  color: rgb(var(--mdui-color-on-surface-variant));
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.wt-tag {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.08);
}

.wt-tag.end {
  background: rgba(var(--mdui-color-tertiary), 0.16);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-tag.start {
  background: rgba(var(--mdui-color-primary), 0.14);
  color: rgb(var(--mdui-color-primary));
}

.wt-tag.check {
  background: rgba(var(--mdui-color-secondary), 0.16);
  color: rgb(var(--mdui-color-secondary));
}

.wt-event-card {
  padding: 10px 12px;
  margin-top: 6px;
  border-radius: 10px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-event-card .material-icons-outlined {
  font-size: 0.875rem;
  color: rgb(var(--mdui-color-tertiary));
}

.wt-event-card p {
  margin: 4px 0 0;
  line-height: 1.6;
}

.wt-event-chance {
  margin-left: auto;
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-tertiary));
  font-weight: 600;
}

.wt-choice-row {
  display: flex;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(var(--mdui-color-outline-variant), 0.5);
}

.wt-choice-row .material-icons-outlined {
  font-size: 0.875rem;
  opacity: 0.4;
  margin-top: 2px;
}

.wt-choice-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wt-choice-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.625rem;
  opacity: 0.8;
}

.wt-problems,
.wt-global-events {
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
  max-height: 220px;
  overflow-y: auto;
  flex-shrink: 0;
}

.wt-problem {
  display: flex;
  gap: 4px;
  font-size: 0.6875rem;
  line-height: 1.6;
  padding: 3px 0;
}

.wt-problem .material-icons-outlined {
  font-size: 0.875rem;
  flex-shrink: 0;
}

.wt-problem.error {
  color: rgb(var(--mdui-color-error));
}

.wt-problem.warn {
  color: #a5691c;
}

.wt-gap-6 {
  gap: 6px;
}

.wt-empty-sm {
  padding: 20px 8px;
  text-align: center;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}

@media (max-width: 1200px) {
  .wt-editor-body {
    grid-template-columns: minmax(0, 1fr) 240px;
  }
  .wt-pane-detail {
    display: none;
  }
}

@media (max-width: 820px) {
  .wt-editor-body {
    grid-template-columns: 1fr;
  }
  .wt-pane-graph {
    display: none;
  }
}
</style>
