<script setup lang="ts">
/**
 * 通用角色面板。
 *
 * 这个组件不认识 COC，也不认识 D&D —— 它只认识 `SheetSchema`。
 * 规则书声明什么属性、什么资源、什么技能，就渲染什么。
 *
 * 之前这里叫 CocSheetPanel，写死了九属性 + HP/MP/SAN 三条状态条 +
 * 「COC 7th · 角色面板」副标题。加一本新规则书就得改组件，
 * 这正是本次改造要解决的问题。
 */
import { computed } from 'vue';
import {
  computeDerived,
  resourceMax,
  resourceValue,
  type CocSheet,
  type RulePack,
  type SheetSchema,
} from '@worldtree/shared';

const props = defineProps<{
  sheet: CocSheet;
  /** 面板按哪本规则书渲染；没给就退回「平铺所有数字字段」 */
  pack?: RulePack | null;
  name?: string;
  /** 隐藏技能区（例如阅读器里空间不够） */
  hideSkills?: boolean;
}>();

defineEmits<{
  (e: 'roll', skill: string, difficulty: 'regular' | 'hard' | 'extreme'): void;
}>();

const schema = computed<SheetSchema | undefined>(() => props.pack?.sheetSchema);

/** 面板副标题：优先用 schema 的自称，否则用规则包名 */
const subtitle = computed(() => {
  if (schema.value?.label) return schema.value.label;
  if (props.pack?.name) return props.pack.name;
  return '角色面板';
});

/** 属性：有 schema 按 schema 顺序与标签；没有就把数字字段铺出来 */
const attrs = computed(() => {
  const s = schema.value;
  if (s?.attributes?.length) {
    return s.attributes
      .filter((d) => typeof props.sheet.attributes[d.key] === 'number')
      .map((d) => ({
        key: d.key,
        label: d.label || d.key,
        abbr: d.abbr ?? d.key,
        value: props.sheet.attributes[d.key],
      }));
  }
  return Object.entries(props.sheet.attributes)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ key: k, label: k, abbr: k, value: v }));
});

/** 资源：有 schema 按声明渲染；没有则退回 COC 的 HP/MP/SAN + 幸运 */
const resources = computed(() => {
  const s = schema.value;
  const defs = s?.resources?.length
    ? s.resources
    : [
        { key: 'hp', label: 'HP', color: '#4f8a5b' },
        { key: 'mp', label: 'MP', color: '#3d7ea6' },
        { key: 'san', label: 'SAN', color: '#7d5a96' },
      ];

  return defs.map((d) => {
    const cur = resourceValue(props.sheet, d.key);
    const max = resourceMax(props.sheet, d.key);
    const isBar = d.bar !== false && max > 0;
    const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    return {
      key: d.key,
      label: d.label || d.key,
      cur,
      max,
      isBar,
      ratio,
      color: d.color || '#4f6f52',
      hint: d.hint,
      danger: ratio <= (d.dangerRatio ?? 0.25),
    };
  });
});

/** 额外资源里没被 schema 声明的（例如换规则书后残留的字段），也列出来 */
const extraResources = computed(() => {
  const declared = new Set((schema.value?.resources ?? []).map((r) => r.key));
  const out: { key: string; label: string; cur: number; max: number }[] = [];
  for (const key of Object.keys(props.sheet.resources ?? {})) {
    if (key.endsWith('Max')) continue;
    if (declared.has(key)) continue;
    if (['hp', 'mp', 'san', 'luck'].includes(key)) continue;
    out.push({
      key,
      label: key,
      cur: resourceValue(props.sheet, key),
      max: resourceMax(props.sheet, key),
    });
  }
  return out;
});

/** 派生展示项 */
const derived = computed(() => computeDerived(props.sheet, schema.value?.derived));

const skills = computed(() => props.sheet.skills ?? []);

function barColor(r: { color: string; danger: boolean; key: string }): string {
  if (r.danger) return '#c0392b';
  return r.color;
}
</script>

<template>
  <div class="wt-sheet">
    <div class="wt-sheet-head">
      <div class="wt-sheet-name">{{ name || '角色' }}</div>
      <div class="wt-sheet-sub wt-muted">{{ subtitle }}</div>
    </div>

    <!-- 资源条 -->
    <div v-if="resources.length" class="wt-bars">
      <template v-for="r in resources" :key="r.key">
        <!-- 有上限的：进度条 -->
        <div v-if="r.isBar" class="wt-bar-row" :title="r.hint">
          <span class="wt-bar-label">{{ r.label }}</span>
          <div class="wt-bar">
            <div
              class="wt-bar-fill"
              :style="{ width: `${r.ratio * 100}%`, background: barColor(r) }"
            ></div>
          </div>
          <span class="wt-bar-num">{{ r.cur }}/{{ r.max }}</span>
        </div>
        <!-- 无上限的：数字徽章（AC、速度这类） -->
        <div v-else class="wt-bar-row" :title="r.hint">
          <span class="wt-bar-label">{{ r.label }}</span>
          <div class="wt-badge">{{ r.cur }}</div>
        </div>
      </template>

      <div v-for="r in extraResources" :key="r.key" class="wt-bar-row">
        <span class="wt-bar-label">{{ r.label }}</span>
        <div class="wt-bar">
          <div
            class="wt-bar-fill"
            :style="{ width: `${r.max > 0 ? (r.cur / r.max) * 100 : 0}%`, background: '#6b7280' }"
          ></div>
        </div>
        <span class="wt-bar-num">{{ r.cur }}{{ r.max ? `/${r.max}` : '' }}</span>
      </div>
    </div>

    <!-- 属性 -->
    <template v-if="attrs.length">
      <div class="wt-section-label">{{ schema?.attrLabel || '属性' }}</div>
      <div class="wt-attrs">
        <div v-for="a in attrs" :key="a.key" class="wt-attr">
          <div class="wt-attr-val">{{ a.value }}</div>
          <div class="wt-attr-name">{{ a.label }}</div>
          <div class="wt-attr-key">{{ a.abbr }}</div>
        </div>
      </div>
    </template>

    <!-- 派生项 -->
    <template v-if="derived.length">
      <div class="wt-section-label">衍生</div>
      <div class="wt-derived-row">
        <div v-for="d in derived" :key="d.key" class="wt-derived-chip" :title="d.label">
          <span class="wt-derived-label">{{ d.label }}</span>
          <span class="wt-derived-val">{{ d.text }}</span>
        </div>
      </div>
    </template>

    <!-- 技能 -->
    <template v-if="skills.length && !hideSkills">
      <div class="wt-section-label">{{ schema?.skillLabel || '技能（点击检定）' }}</div>
      <div class="wt-skills">
        <button
          v-for="s in skills"
          :key="s.name"
          class="wt-skill"
          @click="$emit('roll', s.name, 'regular')"
          :title="`对 ${s.name} 掷一次检定（目标 ${s.value}）`"
        >
          <span class="wt-skill-name">{{ s.name }}</span>
          <span class="wt-skill-val">{{ s.value }}</span>
        </button>
      </div>
    </template>

    <!-- 状态 -->
    <template v-if="sheet.conditions?.length">
      <div class="wt-section-label">状态</div>
      <div class="wt-chip-row">
        <span v-for="c in sheet.conditions" :key="c" class="wt-cond">{{ c }}</span>
      </div>
    </template>

    <!-- 物品 -->
    <template v-if="sheet.items?.length">
      <div class="wt-section-label">随身物品</div>
      <ul class="wt-items">
        <li v-for="i in sheet.items" :key="i">{{ i }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.wt-sheet {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-sheet-name {
  font-weight: 600;
  font-size: 1rem;
}

.wt-sheet-sub {
  font-size: 0.75rem;
}

.wt-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 4px;
}

.wt-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
}

.wt-bar-label {
  width: 46px;
  flex: 0 0 auto;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgb(var(--mdui-color-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-bar {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.1);
  overflow: hidden;
}

.wt-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 400ms var(--mdui-motion-easing-emphasized);
}

.wt-bar-num {
  width: 62px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-badge {
  flex: 1;
  font-weight: 700;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.wt-section-label {
  margin-top: 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-attrs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 6px;
}

.wt-attr {
  background: rgb(var(--mdui-color-surface-container));
  border-radius: 12px;
  padding: 8px 6px;
  text-align: center;
}

.wt-attr-val {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.1;
}

.wt-attr-name {
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-attr-key {
  font-size: 0.5625rem;
  opacity: 0.45;
  letter-spacing: 0.06em;
}

.wt-derived-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.wt-derived-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px 10px;
  border-radius: 10px;
  background: rgba(var(--mdui-color-primary), 0.08);
  min-width: 52px;
}

.wt-derived-label {
  font-size: 0.625rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  white-space: nowrap;
}

.wt-derived-val {
  font-size: 0.9375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wt-skills {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.wt-skill {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: none;
  background: transparent;
  padding: 7px 8px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  text-align: left;
}

.wt-skill:hover {
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-skill-val {
  font-variant-numeric: tabular-nums;
  color: rgb(var(--mdui-color-primary));
  font-weight: 600;
}

.wt-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.wt-cond {
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(192, 57, 43, 0.15);
  color: #c0392b;
}

.wt-items {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 0.8125rem;
  line-height: 1.7;
  color: rgb(var(--mdui-color-on-surface-variant));
}
</style>
