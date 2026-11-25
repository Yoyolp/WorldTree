<script setup lang="ts">
/**
 * 规则百科。
 *
 * 把「这套规则是怎么运作的」摊开给玩家看：判定方式、能力开关、
 * 角色面板结构、技能表与技能效果、规则原文。
 *
 * 数据全部来自 `GET /api/rulepacks`（也就是规则包对象本身），
 * 这里不做任何写操作 —— 规则书是插件文件，改它应该去改文件。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  evaluateFormula,
  STRATEGY_LIST,
  type CocSheet,
  type RulePack,
  type SheetSchema,
} from '@worldtree/shared';
import { useRulePackStore } from '@/stores/rulepacks';
import { renderMarkdown, firstParagraph } from '@/utils/markdown';

const route = useRoute();
const router = useRouter();
const store = useRulePackStore();

const loading = ref(true);
const keyword = ref('');
const skillKeyword = ref('');
const activeSkill = ref<string | null>(null);

/** 当前选中的规则书 id */
const activeId = ref<string>('');

const packs = computed<RulePack[]>(() => store.list);

const activePack = computed<RulePack | null>(() => store.byId(activeId.value) ?? packs.value[0] ?? null);

const schema = computed<SheetSchema | undefined>(() => activePack.value?.sheetSchema);

/** 左栏过滤 */
const filteredPacks = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return packs.value;
  return packs.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q),
  );
});

/** 判定策略的说明（从 strategy id 反查） */
const strategyInfo = computed(() => {
  const id = activePack.value?.strategy;
  if (!id) return undefined;
  return STRATEGY_LIST.find((s) => s.id === id);
});

/** 能力开关：把 boolean 字段整理成可读列表 */
const toggles = computed(() => {
  const p = activePack.value;
  if (!p) return [];
  return [
    { key: 'difficulties', label: '难度分层', on: p.difficulties, hint: '支持困难 / 极难难度' },
    { key: 'bonusPenalty', label: '奖励 / 惩罚骰', on: p.bonusPenalty, hint: '一次掷多颗骰取优或取劣' },
    { key: 'luckSpend', label: '幸运改判', on: p.luckSpend, hint: '消耗幸运把失败改成成功' },
    { key: 'pushedRolls', label: '孤注一掷', on: p.pushedRolls, hint: '失败后重掷，但失败代价更重' },
    { key: 'autoCheck', label: '自动检定', on: p.autoCheck, hint: '从玩家行动自动推断要检定什么' },
    { key: 'failForward', label: '失败也推进', on: p.failForward, hint: '失败写成一个转折，而不是死路' },
    { key: 'sanity', label: '理智机制', on: p.sanity, hint: '有 SAN 检定与疯狂' },
    { key: 'combat', label: '战斗流程', on: p.combat, hint: '支持先攻、攻击、伤害与濒死' },
  ];
});

/** 技能按分组归类 */
const skillGroups = computed(() => {
  const s = schema.value;
  if (!s?.skills?.length) return [];

  const q = skillKeyword.value.trim().toLowerCase();
  const matched = q
    ? s.skills.filter(
        (k) =>
          (k.label || k.key).toLowerCase().includes(q) ||
          (k.description ?? '').toLowerCase().includes(q) ||
          (k.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      )
    : s.skills;

  const order = s.groups ?? [];
  const map = new Map<string, typeof matched>();
  for (const k of matched) {
    const g = k.group || '未分组';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(k);
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia < 0 && ib < 0) return a.localeCompare(b, 'zh');
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  return keys.map((g) => ({ group: g, items: map.get(g)! }));
});

const activeSkillDef = computed(() => {
  const s = schema.value;
  if (!s?.skills?.length || !activeSkill.value) return undefined;
  return s.skills.find((k) => k.key === activeSkill.value);
});

/** 规则原文渲染成 HTML（已转义，见 utils/markdown） */
const instructionsHtml = computed(() => renderMarkdown(activePack.value?.instructions));

/** 示例面板：用当前 schema 造一个空壳，展示面板会渲染成什么样 */
const sampleSheet = computed<CocSheet | null>(() => {
  const s = schema.value;
  if (!s) return null;

  const attrs: Record<string, number> = {};
  for (const d of s.attributes) {
    attrs[d.key] = d.default ?? Math.round(((d.min ?? 1) + (d.max ?? 99)) / 2);
  }

  const sheet: CocSheet = {
    attributes: attrs,
    skills: [],
    hp: 0,
    hpMax: 0,
    mp: 0,
    mpMax: 0,
    san: 0,
    sanMax: 0,
    resources: {},
    conditions: [],
    items: [],
  };

  // 资源上限按公式算（跟平台里同一套求值器）
  for (const r of s.resources) {
    const max = evalMax(sheet, r);
    if (isFlat(r.key)) {
      const flat = sheet as unknown as Record<string, number>;
      flat[r.key] = max;
      flat[r.key === 'luck' ? 'luckMax' : `${r.key}Max`] = max;
    } else {
      sheet.resources![r.key] = max;
      sheet.resources![`${r.key}Max`] = max;
    }
  }
  return sheet;
});

/** 派生值展示（用和平台一致的公式求值） */
const derivedPreview = computed(() => {
  const s = schema.value;
  const sheet = sampleSheet.value;
  if (!s?.derived?.length || !sheet) return [];
  return s.derived.map((d) => {
    const v = evalDerived(sheet, d.formula);
    return { key: d.key, label: d.label, text: v === null ? '—' : `${Math.round(v)}${d.suffix ?? ''}` };
  });
});

/* ------------------------------------------------------------------ */
/* 本地求值（避免为了预览再去引一堆东西）                                */
/* ------------------------------------------------------------------ */

const FLAT = new Set(['hp', 'mp', 'san', 'luck']);
const isFlat = (k: string) => FLAT.has(k);

function varsOf(sheet: CocSheet): Record<string, number> {
  const vars: Record<string, number> = { ...sheet.attributes };
  for (const [k, v] of Object.entries(sheet)) if (typeof v === 'number') vars[k] = v;
  for (const [k, v] of Object.entries(sheet.resources ?? {})) vars[k] = v;
  return vars;
}

/**
 * 用 shared 的求值器算；这里只做「拿不到就返回默认值」的兜底，
 * 不重复实现一套公式解析。
 */
function evalMax(sheet: CocSheet, r: { key: string; maxFormula?: string; min?: number; max?: number }): number {
  if (!r.maxFormula) return r.max ?? 10;
  const v = evaluateFormula(r.maxFormula, varsOf(sheet));
  return v === null ? (r.max ?? 10) : Math.max(r.min ?? 0, Math.round(v));
}

function evalDerived(sheet: CocSheet, formula: string): number | null {
  return evaluateFormula(formula, varsOf(sheet));
}

/* ------------------------------------------------------------------ */

function selectPack(id: string): void {
  activeId.value = id;
  activeSkill.value = null;
  skillKeyword.value = '';
  router.replace({ path: '/codex', query: { pack: id } });
}

/** 效果说明里的 Markdown 预先渲染好 */
function effectHtml(text?: string): string {
  return renderMarkdown(text);
}

function summaryOf(p: RulePack): string {
  return firstParagraph(p.description, 60);
}

onMounted(async () => {
  await store.load();
  const q = String(route.query.pack ?? '');
  activeId.value = store.byId(q) ? q : packs.value[0]?.id ?? '';
  loading.value = false;
});

// 支持从外部链接直接带 ?pack= 进来
watch(
  () => route.query.pack,
  (q) => {
    const id = String(q ?? '');
    if (id && store.byId(id) && id !== activeId.value) {
      activeId.value = id;
      activeSkill.value = null;
    }
  },
);
</script>

<template>
  <div class="wt-page">
    <header class="wt-page-head">
      <div>
        <h1>规则百科</h1>
        <p class="wt-muted wt-small">
          每本规则书是怎么运作的：判定方式、面板结构、技能与效果。规则书由插件定义，这里是只读视图。
        </p>
      </div>
    </header>

    <div v-if="loading" class="wt-empty-inline">正在读取规则书…</div>

    <div v-else class="wt-codex">
      <!-- 左：规则书列表 -->
      <aside class="wt-codex-side">
        <mdui-text-field
          v-model="keyword"
          placeholder="搜索规则书"
          variant="outlined"
          clearable
          class="wt-codex-search"
        >
          <span slot="icon" class="material-icons-outlined">search</span>
        </mdui-text-field>

        <nav class="wt-codex-list">
          <button
            v-for="p in filteredPacks"
            :key="p.id"
            class="wt-codex-item"
            :class="{ active: p.id === activePack?.id }"
            @click="selectPack(p.id)"
          >
            <span class="material-icons-outlined">{{ p.icon ?? 'extension' }}</span>
            <span class="wt-codex-item-body">
              <span class="wt-codex-item-name">{{ p.name }}</span>
              <span class="wt-codex-item-sub">{{ summaryOf(p) }}</span>
            </span>
            <span v-if="p.external" class="wt-codex-badge">插件</span>
          </button>
          <div v-if="!filteredPacks.length" class="wt-empty-inline">没有匹配的规则书</div>
        </nav>
      </aside>

      <!-- 右：详情 -->
      <main v-if="activePack" class="wt-codex-main">
        <header class="wt-codex-hero">
          <span class="material-icons-outlined wt-codex-hero-icon">{{ activePack.icon ?? 'extension' }}</span>
          <div>
            <h2>{{ activePack.name }}</h2>
            <p class="wt-muted wt-small">{{ activePack.description || '这本规则书没有写简介。' }}</p>
            <div class="wt-codex-meta">
              <span class="wt-chip">id: {{ activePack.id }}</span>
              <span class="wt-chip">骰：d{{ activePack.dieFaces }}</span>
              <span v-if="activePack.external" class="wt-chip wt-chip-accent">插件加载</span>
              <span v-if="activePack.file" class="wt-chip">{{ activePack.file }}</span>
            </div>
          </div>
        </header>

        <!-- 插件加载问题 -->
        <div v-if="activePack.errors?.length" class="wt-alert wt-alert-error">
          <strong>加载错误</strong>
          <ul>
            <li v-for="e in activePack.errors" :key="e">{{ e }}</li>
          </ul>
        </div>
        <div v-if="activePack.warnings?.length" class="wt-alert wt-alert-warn">
          <strong>警告</strong>
          <ul>
            <li v-for="w in activePack.warnings" :key="w">{{ w }}</li>
          </ul>
        </div>

        <!-- 判定方式 -->
        <section class="wt-codex-section">
          <h3>判定方式</h3>
          <div v-if="activePack.strategy" class="wt-codex-card">
            <div class="wt-row">
              <strong>{{ strategyInfo?.name ?? activePack.strategy }}</strong>
              <div class="wt-spacer"></div>
              <code class="wt-code">{{ activePack.strategy }}</code>
            </div>
            <p class="wt-small wt-muted" style="margin: 6px 0 0">
              {{ strategyInfo?.description ?? '这是插件自定义的策略。' }}
            </p>

            <template v-if="activePack.strategyParams && Object.keys(activePack.strategyParams).length">
              <div class="wt-codex-sub">策略参数</div>
              <table class="wt-kv">
                <tbody>
                  <tr v-for="(v, k) in activePack.strategyParams" :key="k">
                    <td class="wt-kv-key">{{ k }}</td>
                    <td class="wt-kv-val"><code>{{ JSON.stringify(v) }}</code></td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <div v-else class="wt-empty-inline">这本规则书没有声明判定策略，会回落到 d100 阈值。</div>

          <!-- 分档 -->
          <div v-if="activePack.outcomeBands?.length" class="wt-codex-card">
            <div class="wt-codex-sub">成功等级分档</div>
            <table class="wt-kv">
              <thead>
                <tr><th>等级</th><th>区间</th></tr>
              </thead>
              <tbody>
                <tr v-for="(b, i) in activePack.outcomeBands" :key="i">
                  <td class="wt-kv-key">{{ b.outcome }}</td>
                  <td class="wt-kv-val">{{ b.min }} ~ {{ b.max ?? '∞' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="wt-codex-grid">
            <div class="wt-codex-mini">
              <span class="wt-codex-mini-label">大成功</span>
              <span class="wt-codex-mini-val">{{ activePack.criticalValue ?? '—' }}</span>
            </div>
            <div class="wt-codex-mini">
              <span class="wt-codex-mini-label">大失败</span>
              <span class="wt-codex-mini-val">{{ activePack.fumbleValue ?? '—' }}</span>
            </div>
            <div class="wt-codex-mini">
              <span class="wt-codex-mini-label">结果分档</span>
              <span class="wt-codex-mini-val">{{ activePack.simpleOutcome ? '两档' : '多档' }}</span>
            </div>
          </div>
        </section>

        <!-- 能力开关 -->
        <section class="wt-codex-section">
          <h3>能力开关</h3>
          <div class="wt-toggle-grid">
            <div v-for="t in toggles" :key="t.key" class="wt-toggle" :class="{ on: t.on }" :title="t.hint">
              <span class="material-icons-outlined">{{ t.on ? 'check_circle' : 'remove_circle_outline' }}</span>
              <span class="wt-toggle-label">{{ t.label }}</span>
            </div>
          </div>
        </section>

        <!-- 角色面板 -->
        <section v-if="schema" class="wt-codex-section">
          <h3>角色面板</h3>
          <p class="wt-small wt-muted">
            角色卡上能填的字段由这本规则书决定。共 {{ schema.attributes.length }} 项属性、
            {{ schema.resources.length }} 项资源、{{ schema.skills?.length ?? 0 }} 项技能。
          </p>

          <!-- 属性 -->
          <div class="wt-codex-sub">属性</div>
          <table class="wt-kv">
            <thead>
              <tr><th>键</th><th>名称</th><th>范围</th><th>随机骰式</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in schema.attributes" :key="a.key">
                <td class="wt-kv-key"><code>{{ a.key }}</code></td>
                <td>{{ a.label }}</td>
                <td class="wt-muted">{{ a.min ?? 1 }} ~ {{ a.max ?? 99 }}</td>
                <td><code v-if="a.roll">{{ a.roll }}</code><span v-else class="wt-muted">—</span></td>
                <td class="wt-muted wt-small">{{ a.hint ?? '' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- 资源 -->
          <div class="wt-codex-sub">资源</div>
          <table class="wt-kv">
            <thead>
              <tr><th>键</th><th>名称</th><th>上限公式</th><th>展示</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in schema.resources" :key="r.key">
                <td class="wt-kv-key"><code>{{ r.key }}</code></td>
                <td>{{ r.label }}</td>
                <td>
                  <code v-if="r.maxFormula">{{ r.maxFormula }}</code>
                  <span v-else class="wt-muted">固定 {{ r.max ?? '—' }}</span>
                </td>
                <td class="wt-muted wt-small">{{ r.bar === false ? '数字' : '进度条' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- 派生值 -->
          <template v-if="schema.derived?.length">
            <div class="wt-codex-sub">衍生数值</div>
            <div class="wt-derived-preview">
              <div v-for="d in derivedPreview" :key="d.key" class="wt-derived-chip">
                <span class="wt-derived-chip-label">{{ d.label }}</span>
                <span class="wt-derived-chip-val">{{ d.text }}</span>
              </div>
            </div>
            <p class="wt-small wt-muted" style="margin-top: 6px">
              按默认属性算出来的结果。实际角色卡会随属性变化。
            </p>
          </template>

          <!-- 面板预览 -->
          <div class="wt-codex-sub">面板预览</div>
          <div class="wt-sheet-preview">
            <div class="wt-sheet-preview-head">
              <strong>{{ schema.label ?? activePack.name }}</strong>
              <span class="wt-muted wt-small">（示例数据）</span>
            </div>
            <div class="wt-sheet-preview-bars">
              <div v-for="r in schema.resources" :key="r.key" class="wt-preview-bar-row">
                <span class="wt-preview-bar-label">{{ r.label }}</span>
                <div class="wt-preview-bar">
                  <div class="wt-preview-bar-fill" :style="{ width: '100%', background: r.color || '#4f6f52' }"></div>
                </div>
                <span class="wt-preview-bar-num">
                  {{ sampleSheet?.[r.key as keyof CocSheet] ?? sampleSheet?.resources?.[r.key] ?? 0 }}
                  {{ r.bar === false ? '' : `/${sampleSheet?.resources?.[`${r.key}Max`] ?? sampleSheet?.hpMax ?? ''}` }}
                </span>
              </div>
            </div>
            <div class="wt-preview-attrs">
              <div v-for="a in schema.attributes" :key="a.key" class="wt-preview-attr">
                <div class="wt-preview-attr-val">{{ sampleSheet?.attributes[a.key] }}</div>
                <div class="wt-preview-attr-name">{{ a.label }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- 技能 -->
        <section v-if="schema?.skills?.length" class="wt-codex-section">
          <div class="wt-row">
            <h3 style="margin: 0">技能</h3>
            <div class="wt-spacer"></div>
            <mdui-text-field
              v-model="skillKeyword"
              placeholder="筛选技能"
              variant="outlined"
              clearable
              class="wt-skill-search"
            ></mdui-text-field>
          </div>
          <p class="wt-small wt-muted">
            共 {{ schema.skills.length }} 项，分 {{ skillGroups.length }} 组。点开可以看效果说明与用法示例。
          </p>

          <div v-for="g in skillGroups" :key="g.group" class="wt-skill-group">
            <div class="wt-codex-sub">{{ g.group }}</div>
            <div class="wt-skill-cards">
              <button
                v-for="k in g.items"
                :key="k.key"
                class="wt-skill-card"
                :class="{ active: activeSkill === k.key }"
                @click="activeSkill = activeSkill === k.key ? null : k.key"
              >
                <div class="wt-skill-card-top">
                  <strong>{{ k.label || k.key }}</strong>
                  <code v-if="k.baseFormula" class="wt-skill-base">{{ k.baseFormula }}</code>
                </div>
                <div v-if="k.description" class="wt-skill-card-desc">{{ k.description }}</div>
                <div v-if="k.tags?.length" class="wt-skill-tags">
                  <span v-for="t in k.tags" :key="t" class="wt-tag">{{ t }}</span>
                </div>
              </button>
            </div>
          </div>

          <!-- 技能详情 -->
          <div v-if="activeSkillDef" class="wt-skill-detail">
            <div class="wt-row">
              <strong>{{ activeSkillDef.label || activeSkillDef.key }}</strong>
              <code v-if="activeSkillDef.baseFormula" class="wt-code">{{ activeSkillDef.baseFormula }}</code>
              <div class="wt-spacer"></div>
              <mdui-button-icon icon="close" @click="activeSkill = null" aria-label="关闭"></mdui-button-icon>
            </div>

            <div class="wt-skill-detail-meta">
              <span v-if="activeSkillDef.attribute" class="wt-chip">关联属性：{{ activeSkillDef.attribute }}</span>
              <span v-if="activeSkillDef.group" class="wt-chip">分组：{{ activeSkillDef.group }}</span>
              <span v-if="activeSkillDef.default !== undefined" class="wt-chip">默认值：{{ activeSkillDef.default }}</span>
            </div>

            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-if="activeSkillDef.effectText"
              class="wt-md"
              v-html="effectHtml(activeSkillDef.effectText)"
            ></div>
            <p v-else class="wt-muted wt-small">这项技能没有写详细说明。</p>

            <template v-if="activeSkillDef.examples?.length">
              <div class="wt-codex-sub">什么时候用</div>
              <ul class="wt-examples">
                <li v-for="(ex, i) in activeSkillDef.examples" :key="i">{{ ex }}</li>
              </ul>
            </template>
          </div>
        </section>

        <!-- 规则原文 -->
        <section v-if="activePack.instructions" class="wt-codex-section">
          <h3>规则原文</h3>
          <p class="wt-small wt-muted">这段文字会原样注入系统提示，是模型理解规则的依据。</p>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="wt-md wt-codex-doc" v-html="instructionsHtml"></div>
        </section>

        <section v-else class="wt-codex-section">
          <h3>规则原文</h3>
          <div class="wt-empty-inline">
            这本规则书没有写 <code>instructions</code>，平台会用一段通用兜底文案。
          </div>
        </section>
      </main>

      <main v-else class="wt-codex-main">
        <div class="wt-empty-inline">没有可显示的规则书。</div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.wt-codex {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

@media (max-width: 900px) {
  .wt-codex {
    grid-template-columns: 1fr;
  }
}

/* ---- 左栏 ---- */
.wt-codex-side {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wt-codex-search {
  width: 100%;
}

.wt-codex-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-codex-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--mdui-color-on-surface));
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.wt-codex-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.06);
}

.wt-codex-item.active {
  background: rgba(var(--mdui-color-primary), 0.14);
}

.wt-codex-item .material-icons-outlined {
  font-size: 19px;
  opacity: 0.7;
  margin-top: 1px;
}

.wt-codex-item.active .material-icons-outlined {
  opacity: 1;
  color: rgb(var(--mdui-color-primary));
}

.wt-codex-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.wt-codex-item-name {
  font-size: 0.875rem;
  font-weight: 600;
}

.wt-codex-item-sub {
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.wt-codex-badge {
  font-size: 0.5625rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.18);
  color: rgb(var(--mdui-color-tertiary));
  flex: 0 0 auto;
}

/* ---- 右栏 ---- */
.wt-codex-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.wt-codex-hero {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-low));
}

.wt-codex-hero h2 {
  margin: 0 0 4px;
  font-size: 1.25rem;
}

.wt-codex-hero-icon {
  font-size: 34px;
  color: rgb(var(--mdui-color-primary));
}

.wt-codex-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.wt-chip {
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.08);
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-chip-accent {
  background: rgba(var(--mdui-color-primary), 0.16);
  color: rgb(var(--mdui-color-primary));
}

.wt-codex-section {
  margin-top: 22px;
}

.wt-codex-section h3 {
  margin: 0 0 4px;
  font-size: 1rem;
}

.wt-codex-sub {
  margin: 16px 0 6px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-codex-card {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-surface-container-low));
  margin-top: 8px;
}

.wt-codex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.wt-codex-mini {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--mdui-color-surface-container-low));
}

.wt-codex-mini-label {
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-codex-mini-val {
  font-size: 1.0625rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wt-kv {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  margin-top: 6px;
}

.wt-kv th {
  text-align: left;
  font-weight: 600;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--mdui-color-on-surface-variant));
  padding: 6px 8px;
  border-bottom: 1px solid rgba(var(--mdui-color-outline), 0.25);
}

.wt-kv td {
  padding: 7px 8px;
  border-bottom: 1px solid rgba(var(--mdui-color-outline), 0.12);
  vertical-align: top;
}

.wt-kv-key code,
.wt-code {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 0.75rem;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(var(--mdui-color-on-surface), 0.07);
}

.wt-kv-val code {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 0.75rem;
}

/* 开关 */
.wt-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.wt-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--mdui-color-surface-container-low));
  font-size: 0.8125rem;
  opacity: 0.5;
}

.wt-toggle.on {
  opacity: 1;
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-toggle .material-icons-outlined {
  font-size: 18px;
}

.wt-toggle.on .material-icons-outlined {
  color: rgb(var(--mdui-color-primary));
}

/* 派生值 */
.wt-derived-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.wt-derived-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(var(--mdui-color-primary), 0.08);
  min-width: 60px;
}

.wt-derived-chip-label {
  font-size: 0.625rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  white-space: nowrap;
}

.wt-derived-chip-val {
  font-size: 0.9375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* 面板预览 */
.wt-sheet-preview {
  padding: 14px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-surface-container-low));
  max-width: 420px;
}

.wt-sheet-preview-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.wt-sheet-preview-bars {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.wt-preview-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
}

.wt-preview-bar-label {
  width: 46px;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-weight: 600;
}

.wt-preview-bar {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.1);
  overflow: hidden;
}

.wt-preview-bar-fill {
  height: 100%;
  border-radius: 999px;
  opacity: 0.85;
}

.wt-preview-bar-num {
  width: 62px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-preview-attrs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 12px;
}

.wt-preview-attr {
  text-align: center;
  padding: 6px 4px;
  border-radius: 10px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-preview-attr-val {
  font-size: 1rem;
  font-weight: 600;
}

.wt-preview-attr-name {
  font-size: 0.625rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

/* 技能 */
.wt-skill-search {
  max-width: 200px;
}

.wt-skill-group {
  margin-top: 6px;
}

.wt-skill-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}

.wt-skill-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--mdui-color-outline), 0.25);
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--mdui-color-on-surface));
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms, background 140ms;
}

.wt-skill-card:hover {
  background: rgba(var(--mdui-color-primary), 0.06);
}

.wt-skill-card.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-skill-card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.wt-skill-base {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.625rem;
  opacity: 0.6;
}

.wt-skill-card-desc {
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  line-height: 1.45;
}

.wt-skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.wt-tag {
  font-size: 0.5625rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.15);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-skill-detail {
  margin-top: 16px;
  padding: 14px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-skill-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.wt-examples {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 0.8125rem;
  line-height: 1.7;
  color: rgb(var(--mdui-color-on-surface-variant));
}

/* Markdown 渲染结果 */
.wt-md {
  font-size: 0.875rem;
  line-height: 1.7;
}

.wt-md :deep(h1),
.wt-md :deep(h2),
.wt-md :deep(h3),
.wt-md :deep(h4) {
  margin: 14px 0 6px;
  font-size: 0.9375rem;
}

.wt-md :deep(p) {
  margin: 6px 0;
}

.wt-md :deep(ul),
.wt-md :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}

.wt-md :deep(li) {
  margin: 2px 0;
}

.wt-md :deep(code) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.8125rem;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(var(--mdui-color-on-surface), 0.08);
}

.wt-md :deep(pre) {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--mdui-color-on-surface), 0.08);
  overflow-x: auto;
}

.wt-md :deep(pre code) {
  background: none;
  padding: 0;
}

.wt-md :deep(blockquote) {
  margin: 6px 0;
  padding-left: 12px;
  border-left: 3px solid rgba(var(--mdui-color-primary), 0.5);
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-md :deep(hr) {
  border: none;
  border-top: 1px solid rgba(var(--mdui-color-outline), 0.3);
  margin: 14px 0;
}

.wt-md :deep(a) {
  color: rgb(var(--mdui-color-primary));
}

.wt-codex-doc {
  padding: 16px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-surface-container-low));
}

/* 警告 */
.wt-alert {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.8125rem;
  margin-top: 10px;
}

.wt-alert ul {
  margin: 4px 0 0;
  padding-left: 18px;
}

.wt-alert-error {
  background: rgba(192, 57, 43, 0.12);
  color: #c0392b;
}

.wt-alert-warn {
  background: rgba(217, 131, 36, 0.14);
  color: #a5651a;
}
</style>
