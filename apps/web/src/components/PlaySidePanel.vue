<script setup lang="ts">
/**
 * 阅读器右侧面板：角色面板 / 状态 / 世界线 三个标签页。
 *
 * 从 PlayView 抽出。原来这三个标签页直接在页面模板里铺了 200 多行，
 * 和推演主流程混在一起，改面板要在一大段模板里找位置。
 *
 * 组件保持「纯展示 + 事件上抛」：不自己发请求，所有动作交给父组件处理，
 * 这样面板可以独立预览与复用。
 */
import { computed } from 'vue';
import type { CheckResult, CocSheet, Message, Session, World } from '@worldtree/shared';
import SheetPanel from '@/components/SheetPanel.vue';
import { formatDateTime, evValue, evChecked } from '@/utils/ui';
import { useRulePackStore } from '@/stores/rulepacks';
import type { SessionTreeNode } from '@/composables/useSessionTree';

const props = defineProps<{
  tab: 'sheet' | 'state' | 'lines';
  session: Session | null;
  world: World | null;
  playerName?: string;
  sheet: CocSheet | null;
  improving: boolean;
  improveResults: { skill: string; before: number; after: number; roll: number; grew: boolean; gained: number; detail: string }[];
  showRaw: boolean;
  lastRaw: string;
  tree: SessionTreeNode[];
  currentSessionId?: string;
  combatBusy: boolean;
  combatWeapon: string;
  combatDefense: 'dodge' | 'fightBack';
}>();

const emit = defineEmits<{
  'update:tab': [value: 'sheet' | 'state' | 'lines'];
  'update:showRaw': [value: boolean];
  'update:combatWeapon': [value: string];
  'update:combatDefense': [value: 'dodge' | 'fightBack'];
  improve: [];
  roll: [skill: string, difficulty: 'regular' | 'hard' | 'extreme'];
  attack: [defenderId: string];
  combatNext: [];
  combatEnd: [];
  openSession: [id: string];
  forkSession: [id: string];
}>();

const combat = computed(() => props.session?.state?.combat ?? null);

/** 当前玩家对应的参战单位（多人按 memberId，单人 m_player） */
const myCombatantId = computed(() => {
  const c = combat.value;
  if (!c) return null;
  return c.combatants.find((x) => x.id === 'm_player')?.id ?? c.combatants[0]?.id ?? null;
});

/** 现在轮到谁 */
const currentActor = computed(() => {
  const c = combat.value;
  if (!c) return null;
  const id = c.order[c.turnIndex];
  return c.combatants.find((x) => x.id === id) ?? null;
});
const rulePackStore = useRulePackStore();
const activePackId = computed(() => props.session?.state.rulePackId ?? props.world?.rulePackId ?? 'narrative');
const packName = computed(() => rulePackStore.nameOf(activePackId.value));
const packIcon = computed(() => rulePackStore.iconOf(activePackId.value));

/**
 * 面板渲染用哪本规则书。
 *
 * 默认跟角色卡走（卡片自带的 `sheet.rulePackId`），
 * 世界声明 `sheetRulePrecedence: 'world'` 时强制用世界的规则书。
 * 注意这只影响**面板怎么显示**；检定判定永远用 activePackId。
 */
const sheetPack = computed(() => {
  const active = rulePackStore.byId(activePackId.value) ?? null;
  if (props.world?.sheetRulePrecedence === 'world') return active;
  const cardId = props.sheet?.rulePackId;
  if (cardId && cardId !== activePackId.value) {
    const cardPack = rulePackStore.byId(cardId);
    if (cardPack?.sheetSchema) return cardPack;
  }
  return active;
});

/** 世界线树压平成列表（带缩进） */
const flatTree = computed(() => {
  const out: { node: SessionTreeNode; depth: number }[] = [];
  const walk = (nodes: SessionTreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ node: n, depth });
      walk(n.children ?? [], depth + 1);
    }
  };
  walk(props.tree ?? [], 0);
  return out;
});

function lastCheck(m: Message): CheckResult | undefined {
  return m.meta?.checks?.[0];
}
</script>

<template>
  <aside class="wt-side">
    <mdui-tabs
      :value="tab"
      variant="secondary"
      full-width
      class="wt-side-tabs"
      @change="emit('update:tab', evValue($event) as 'sheet' | 'state' | 'lines')"
    >
      <mdui-tab v-if="sheet" value="sheet">面板</mdui-tab>
      <mdui-tab value="state">状态</mdui-tab>
      <mdui-tab value="lines">世界线</mdui-tab>
    </mdui-tabs>

    <div class="wt-side-scroll">
      <!-- 角色面板 -->
      <template v-if="tab === 'sheet' && sheet">
        <SheetPanel :sheet="sheet" :pack="sheetPack" :name="playerName" @roll="(s, d) => emit('roll', s, d)" />

        <div class="wt-side-block">
          <div class="wt-row">
            <div class="wt-label">幕间结算</div>
            <div class="wt-spacer"></div>
            <mdui-button variant="tonal" icon="trending_up" :loading="improving" @click="emit('improve')">
              技能成长
            </mdui-button>
          </div>
          <p class="wt-small wt-muted" style="margin: 4px 0 0">
            本幕成功用过的技能：{{ (session?.state.skillsUsed ?? []).join('、') || '暂无' }}
          </p>
          <div v-if="improveResults.length" class="wt-improve-list">
            <div v-for="r in improveResults" :key="r.skill" class="wt-improve-row" :class="{ grew: r.grew }">
              <span>{{ r.skill }}</span>
              <span class="wt-small">{{ r.before }} → {{ r.after }}</span>
              <span class="wt-small wt-muted">{{ r.grew ? '掷 ' + r.roll + ' 成功' : '无提升' }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 状态 -->
      <template v-else-if="tab === 'state'">
        <div class="wt-side-block">
          <div class="wt-label">当前场景</div>
          <p class="wt-side-text">{{ session?.state.scene || '尚未确定' }}</p>
        </div>
        <div v-if="session?.state.summary" class="wt-side-block">
          <div class="wt-label">前情提要</div>
          <p class="wt-side-text">{{ session.state.summary }}</p>
        </div>

        <!-- 战斗 -->
        <div v-if="combat?.active" class="wt-side-block wt-combat">
          <div class="wt-row">
            <div class="wt-label">战斗 · 第 {{ combat.round }} 轮</div>
            <div class="wt-spacer"></div>
            <span class="wt-small wt-muted">{{ currentActor?.name }} 行动中</span>
          </div>

          <div
            v-for="c in combat.combatants"
            :key="c.id"
            class="wt-combatant"
            :class="{ 'is-current': c.id === currentActor?.id }"
          >
            <span class="wt-combatant-name">{{ c.name }}</span>
            <div class="wt-hpbar">
              <i :style="{ width: (c.hpMax ? Math.max(0, c.hp / c.hpMax) * 100 : 0) + '%' }"></i>
            </div>
            <span class="wt-small wt-muted">{{ c.hp }}/{{ c.hpMax }}</span>
            <span v-for="cond in c.conditions" :key="cond" class="wt-chip wt-chip-sm">{{ cond }}</span>
            <mdui-button
              v-if="c.id !== myCombatantId"
              variant="text"
              :loading="combatBusy"
              @click="emit('attack', c.id)"
            >
              攻击
            </mdui-button>
          </div>

          <div class="wt-row" style="margin-top: 8px">
            <mdui-select
              :value="combatWeapon"
              label="武器"
              variant="outlined"
              @change="emit('update:combatWeapon', evValue($event))"
            >
              <mdui-menu-item value="拳头">拳头 1d3</mdui-menu-item>
              <mdui-menu-item value="小刀">小刀 1d4</mdui-menu-item>
              <mdui-menu-item value="棍棒">棍棒 1d6</mdui-menu-item>
              <mdui-menu-item value="手枪">手枪 1d10</mdui-menu-item>
              <mdui-menu-item value="步枪">步枪 2d6</mdui-menu-item>
            </mdui-select>
            <mdui-select
              :value="combatDefense"
              label="对方应对"
              variant="outlined"
              @change="emit('update:combatDefense', evValue($event) as 'dodge' | 'fightBack')"
            >
              <mdui-menu-item value="dodge">闪避</mdui-menu-item>
              <mdui-menu-item value="fightBack">格斗反击</mdui-menu-item>
            </mdui-select>
          </div>
          <div class="wt-row" style="margin-top: 8px">
            <mdui-button variant="outlined" icon="skip_next" @click="emit('combatNext')">下一位</mdui-button>
            <div class="wt-spacer"></div>
            <mdui-button variant="text" @click="emit('combatEnd')">结束战斗</mdui-button>
          </div>
        </div>

        <div class="wt-side-block">
          <div class="wt-label">关键标记</div>
          <div v-if="session?.state.flags.length" class="wt-chip-row">
            <span v-for="f in session.state.flags" :key="f" class="wt-flag">{{ f }}</span>
          </div>
          <p v-else class="wt-small wt-muted">暂无</p>
        </div>

        <div v-if="Object.keys(session?.state.vars ?? {}).length" class="wt-side-block">
          <div class="wt-label">世界变量</div>
          <div class="wt-vars">
            <div v-for="(v, k) in session?.state.vars" :key="k" class="wt-var-row">
              <span class="wt-var-key">{{ k }}</span>
              <span class="wt-var-val">{{ typeof v === 'object' ? JSON.stringify(v) : v }}</span>
            </div>
          </div>
        </div>

        <div v-if="session?.state.nodeId" class="wt-side-block">
          <div class="wt-label">剧本节点</div>
          <code class="wt-mono">{{ session.state.nodeId }}</code>
        </div>

        <div class="wt-side-block">
          <div class="wt-row">
            <div class="wt-label">调试 · 模型原始输出</div>
            <div class="wt-spacer"></div>
            <mdui-switch :checked="showRaw" @change="emit('update:showRaw', evChecked($event))"></mdui-switch>
          </div>
          <p class="wt-small wt-muted" style="margin: 4px 0 0">
            看模型到底吐了什么（包括被剥掉的 JSON）。格式跑偏时先看这里。
          </p>
          <pre v-if="showRaw && lastRaw" class="wt-raw">{{ lastRaw }}</pre>
          <p v-else-if="showRaw" class="wt-small wt-muted">还没有可显示的原始输出。</p>
        </div>

        <div class="wt-side-block">
          <div class="wt-label">规则包</div>
          <div class="wt-row" style="margin-top: 4px">
            <span class="material-icons-outlined" style="font-size: 1.1rem">{{ packIcon }}</span>
            <span class="wt-small">{{ packName }}</span>
          </div>
        </div>
      </template>

      <!-- 世界线 -->
      <template v-else>
        <div class="wt-side-block">
          <div class="wt-label">这条世界线</div>
          <p class="wt-side-text">{{ session?.title }}</p>
          <p class="wt-small wt-muted">
            {{ session?.branchLabel }} · {{ session?.messageCount ?? 0 }} 条消息
          </p>
          <p v-if="session?.createdAt" class="wt-small wt-muted">
            开始于 {{ formatDateTime(session.createdAt) }}
          </p>
        </div>

        <div class="wt-side-block">
          <div class="wt-label">所有世界线</div>
          <div class="wt-tree">
            <button
              v-for="item in flatTree"
              :key="item.node.session.id"
              class="wt-tree-item"
              :class="{ active: item.node.session.id === currentSessionId }"
              :style="{ paddingLeft: 10 + item.depth * 14 + 'px' }"
              @click="emit('openSession', item.node.session.id)"
            >
              <span class="material-icons-outlined wt-tree-icon">
                {{ item.depth === 0 ? 'bookmark' : 'call_split' }}
              </span>
              <span class="wt-tree-label">{{ item.node.session.branchLabel || item.node.session.title }}</span>
            </button>
            <p v-if="!flatTree.length" class="wt-small wt-muted">还没有其他世界线。</p>
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.wt-side {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgb(var(--mdui-color-surface-container-low));
  border-left: 1px solid rgba(var(--mdui-color-outline-variant), 0.28);
}

.wt-side-tabs {
  flex-shrink: 0;
}

.wt-side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-side-block {
  background: rgb(var(--mdui-color-surface-container));
  border-radius: var(--wt-shape-md);
  padding: 14px;
}

.wt-side-text {
  margin: 6px 0 0;
  font-size: 0.875rem;
  line-height: 1.7;
  color: rgb(var(--mdui-color-on-surface));
  white-space: pre-wrap;
}

.wt-raw {
  margin: 8px 0 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  border-radius: var(--wt-shape-sm);
  background: rgb(var(--mdui-color-surface-container-lowest));
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.6875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.wt-improve-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wt-improve-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  padding: 5px 8px;
  border-radius: var(--wt-shape-xs);
  background: rgba(var(--mdui-color-on-surface), 0.03);
}

.wt-improve-row.grew {
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-combatant {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--wt-shape-xs);
  margin-top: 6px;
  flex-wrap: wrap;
}

.wt-combatant.is-current {
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-combatant-name {
  font-size: 0.8125rem;
  font-weight: 500;
  min-width: 3em;
}

.wt-hpbar {
  flex: 1;
  min-width: 48px;
  height: 6px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.12);
  overflow: hidden;
}

.wt-hpbar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgb(var(--mdui-color-error));
  transition: width var(--wt-dur) var(--wt-ease-emph);
}

.wt-flag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--wt-shape-full);
  font-size: 0.75rem;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-vars {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
}

.wt-var-row {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
}

.wt-var-key {
  color: rgb(var(--mdui-color-on-surface-variant));
  flex-shrink: 0;
}

.wt-var-val {
  font-family: 'JetBrains Mono', Consolas, monospace;
  word-break: break-all;
}

.wt-chip,
.wt-chip-sm {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--wt-shape-full);
  font-size: 0.6875rem;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}

.wt-tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: var(--wt-shape-full);
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  cursor: pointer;
  text-align: left;
  transition: background var(--wt-dur-fast) var(--wt-ease-emph);
}

.wt-tree-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.06);
}

.wt-tree-item.active {
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
  font-weight: 500;
}

.wt-tree-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.wt-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

