<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { legaciesApi } from '@/api';
import type { LegacySnapshot } from '@worldtree/shared';
import { askConfirm, formatTime, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const router = useRouter();
const loading = ref(true);
const items = ref<LegacySnapshot[]>([]);
const expanded = ref<string | null>(null);

/** 能接这些存档的世界 */
const targets = ref<Record<string, { reason?: string; accepted: boolean }>>({});

async function load() {
  loading.value = true;
  try {
    const res = await legaciesApi.list();
    items.value = res.items;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}

async function remove(l: LegacySnapshot) {
  if (!(await askConfirm('删除这条继承存档？', `${l.characterName} 在《${l.worldTitle}》的结局记录会被清除。`))) return;
  await legaciesApi.remove(l.id);
  toast('已删除');
  await load();
}

function relationTone(v: number) {
  if (v >= 50) return '亲近';
  if (v >= 20) return '友好';
  if (v <= -50) return '敌视';
  if (v <= -20) return '冷淡';
  return '中立';
}

const hasAny = computed(() => items.value.length > 0);

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">继承存档</h1>
          <p class="wt-muted wt-small">
            一条世界线走到结局后，角色的能力、人际关系和对世界的改变会被留在这里，供续作使用。
          </p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="outlined" icon="refresh" @click="load">刷新</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <template v-else>
        <div v-if="!hasAny" class="wt-empty">
          <span class="material-icons-outlined">history_edu</span>
          <p>
            还没有任何继承存档。<br />
            先把一个故事玩到结局——结局那一刻会自动生成。
          </p>
        </div>

        <div class="wt-legacy-grid">
          <article v-for="l in items" :key="l.id" class="wt-legacy-card">
            <header>
              <span class="material-icons-outlined">auto_awesome</span>
              <div>
                <strong>{{ l.characterName }}</strong>
                <p class="wt-small wt-muted" style="margin: 0">
                  《{{ l.worldTitle }}》· {{ l.ending.title || '结局' }}
                </p>
              </div>
              <div class="wt-spacer"></div>
              <mdui-button-icon icon="delete" aria-label="删除" @click="remove(l)"></mdui-button-icon>
            </header>

            <p class="wt-small wt-muted">
              {{ formatTime(l.createdAt) }} · 来自世界线「{{ l.sessionTitle }}」
            </p>

            <div class="wt-legacy-summary">
              <span class="wt-chip">能力 {{ l.abilities.length }}</span>
              <span class="wt-chip">关系 {{ l.relationships.length }}</span>
              <span class="wt-chip">标记 {{ l.flags.length }}</span>
              <span class="wt-chip">物品 {{ l.items.length }}</span>
            </div>

            <mdui-button variant="text" :icon="expanded === l.id ? 'expand_less' : 'expand_more'" @click="toggle(l.id)">
              {{ expanded === l.id ? '收起详情' : '查看详情' }}
            </mdui-button>

            <div v-if="expanded === l.id" class="wt-legacy-detail">
              <div v-if="l.abilities.length" class="wt-legacy-block">
                <h4>能力</h4>
                <ul>
                  <li v-for="a in l.abilities" :key="a.id">
                    <b>{{ a.name }}</b> —— {{ a.description }}
                  </li>
                </ul>
              </div>

              <div v-if="l.relationships.length" class="wt-legacy-block">
                <h4>人际关系</h4>
                <ul>
                  <li v-for="r in l.relationships" :key="r.target">
                    {{ r.target }}：{{ relationTone(r.value) }}（{{ r.value }}）
                    <span v-if="r.note" class="wt-muted">—— {{ r.note }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="l.flags.length" class="wt-legacy-block">
                <h4>关键选择</h4>
                <div class="wt-tag-row">
                  <span v-for="f in l.flags" :key="f" class="wt-chip">{{ f }}</span>
                </div>
              </div>

              <div v-if="Object.keys(l.vars).length" class="wt-legacy-block">
                <h4>对世界的影响</h4>
                <ul>
                  <li v-for="(v, k) in l.vars" :key="k">
                    {{ k }}：{{ typeof v === 'object' ? JSON.stringify(v) : v }}
                  </li>
                </ul>
              </div>

              <div v-if="l.summary" class="wt-legacy-block">
                <h4>前情提要</h4>
                <p class="wt-small">{{ l.summary }}</p>
              </div>
            </div>
          </article>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.wt-page-title {
  font-size: 1.375rem;
  margin: 0;
}

.wt-legacy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.wt-legacy-card {
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  border-radius: 18px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wt-legacy-card header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wt-legacy-card header .material-icons-outlined {
  color: rgb(var(--mdui-color-primary));
}

.wt-legacy-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wt-chip {
  font-size: 0.75rem;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-legacy-detail {
  border-top: 1px solid rgb(var(--mdui-color-outline-variant));
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-legacy-block h4 {
  font-size: 0.8125rem;
  margin: 0 0 6px;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-legacy-block ul {
  margin: 0;
  padding-left: 18px;
  font-size: 0.8125rem;
  line-height: 1.7;
}

.wt-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wt-empty {
  display: grid;
  place-items: center;
  gap: 12px;
  padding: 80px 20px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  border-radius: 18px;
  color: rgb(var(--mdui-color-on-surface-variant));
  text-align: center;
}

.wt-empty .material-icons-outlined {
  font-size: 2.5rem;
  opacity: 0.6;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}
</style>
