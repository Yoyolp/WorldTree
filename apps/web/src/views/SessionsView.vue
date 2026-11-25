<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Session, World } from '@worldtree/shared';
import { api } from '@/api';
import { askConfirm, countDescendants, formatTime, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const router = useRouter();

interface Row {
  session: Session;
  world?: World;
}

const rows = ref<Row[]>([]);
const loading = ref(true);
const keyword = ref('');
const showArchived = ref(false);
const importing = ref(false);
const saveInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return rows.value.filter(({ session, world }) => {
    if (!showArchived.value && session.archived) return false;
    if (!kw) return true;
    return [session.title, session.branchLabel, world?.title ?? '', session.state?.scene ?? '']
      .join(' ')
      .toLowerCase()
      .includes(kw);
  });
});

const grouped = computed(() => {
  const map = new Map<string, { world?: World; items: Session[] }>();
  for (const { session, world } of filtered.value) {
    const key = session.worldId;
    if (!map.has(key)) map.set(key, { world, items: [] });
    map.get(key)!.items.push(session);
  }
  return [...map.entries()].map(([id, v]) => ({ id, ...v, items: v.items.sort((a, b) => b.updatedAt - a.updatedAt) }));
});

async function load() {
  loading.value = true;
  try {
    const res = await api.listWorlds();
    const all: Row[] = [];
    await Promise.all(
      res.items.map(async (w) => {
        try {
          const s = await api.listSessions(w.world.id);
          for (const sess of s.items) all.push({ session: sess, world: w.world });
        } catch {
          /* 单个世界失败不影响整体 */
        }
      }),
    );
    rows.value = all.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function toggleArchive(s: Session) {
  try {
    await api.updateSession(s.id, { archived: !s.archived });
    s.archived = !s.archived;
    toast(s.archived ? '已归档' : '已取消归档');
  } catch (err) {
    toast((err as Error).message);
  }
}

async function remove(s: Session) {
  const all = rows.value.map((r) => r.session);
  const kids = countDescendants(all, s.id);
  const desc = kids
    ? `「${s.title}」及其 ${kids} 条分叉世界线都会被删除，无法恢复。`
    : `「${s.title}」的 ${s.messageCount} 条记录会被删除，无法恢复。`;

  if (!(await askConfirm('删除这条世界线？', desc))) return;

  try {
    const res = await api.deleteSession(s.id);
    // 直接从服务端重新拉一遍，避免手动维护级联删除的本地状态
    await load();
    toast((res.deleted ?? 1) > 1 ? `已删除 ${res.deleted ?? 1} 条世界线` : '已删除');
  } catch (err) {
    toast((err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* 导出 / 导入存档                                                      */
/* ------------------------------------------------------------------ */

function exportSession(s: Session) {
  // 用 a[download] 而不是 window.open，避免浏览器把 JSON 直接渲染出来
  const a = document.createElement('a');
  a.href = `/api/sessions/${s.id}/export`;
  a.download = `${s.title}.wtsave.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('正在下载存档');
}

async function onImportSave(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importing.value = true;
  try {
    const payload = JSON.parse(await file.text());
    const res = await api.importSession(payload);
    toast(`已导入「${res.session.title}」，共 ${res.messages.length} 条记录`);
    await load();
    router.push(`/play/${res.session.id}`);
  } catch (err) {
    toast(`导入失败：${(err as Error).message}`);
  } finally {
    importing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">存档</h1>
          <p class="wt-muted">所有世界的世界线。点进去就能从上次的地方继续。</p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-text-field
          v-model="keyword"
          placeholder="搜索世界线"
          icon="search"
          variant="outlined"
          clearable
          class="wt-search"
        ></mdui-text-field>
        <mdui-switch :checked="showArchived" @change="showArchived = ($event.target as any).checked"></mdui-switch>
        <span class="wt-small wt-muted">显示已归档</span>
        <input ref="saveInput" type="file" accept=".json,.wtsave.json,application/json" hidden @change="onImportSave" />
        <mdui-button variant="outlined" icon="upload" :loading="importing" @click="saveInput?.click()">导入存档</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <div v-else-if="grouped.length" class="wt-sessions">
        <section v-for="g in grouped" :key="g.id" class="wt-group">
          <div class="wt-group-head" @click="router.push(`/worlds/${g.id}`)">
            <span class="wt-group-emoji"><span class="material-icons-outlined">{{ g.world?.coverIcon }}</span></span>
            <strong>{{ g.world?.title }}</strong>
            <span class="wt-muted wt-small">{{ g.items.length }} 条世界线</span>
            <div class="wt-spacer"></div>
            <span class="material-icons-outlined wt-group-arrow">chevron_right</span>
          </div>
          <div class="wt-session-grid">
            <article
              v-for="s in g.items"
              :key="s.id"
              class="wt-session-card wt-clickable"
              @click="router.push(`/play/${s.id}`)"
            >
              <div class="wt-session-top">
                <span class="wt-session-icon"><span class="material-icons-outlined">{{ s.archived ? 'inventory_2' : s.parentId ? 'call_split' : 'explore' }}</span></span>
                <div class="wt-session-body">
                  <div class="wt-session-title">{{ s.title }}</div>
                  <div class="wt-muted wt-small">{{ s.branchLabel }} · {{ s.messageCount }} 条记录</div>
                </div>
              </div>
              <div class="wt-session-scene wt-small" v-if="s.state?.scene">
                <span class="material-icons-outlined">place</span>{{ s.state.scene }}
              </div>
              <div class="wt-session-foot">
                <span class="wt-small wt-muted">{{ formatTime(s.updatedAt) }}</span>
                <div class="wt-session-actions" @click.stop>
                  <mdui-button-icon icon="download" small @click="exportSession(s)" aria-label="导出存档" />
                  <mdui-button-icon :icon="s.archived ? 'unarchive' : 'archive'" small @click="toggleArchive(s)" aria-label="归档" />
                  <mdui-button-icon icon="delete" small @click="remove(s)" aria-label="删除" />
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div v-else class="wt-empty">
        <div class="material-icons-outlined wt-empty-emoji">explore</div>
        <div>还没有任何世界线</div>
        <div class="wt-small">去书库挑一个世界开始吧</div>
        <mdui-button variant="filled" @click="router.push('/')">去书库</mdui-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.wt-page-title {
  font-size: 1.5rem;
  margin: 0 0 4px;
}

.wt-page-head p {
  margin: 0;
  font-size: 0.875rem;
}

.wt-search {
  max-width: 240px;
}

.wt-sessions {
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.wt-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 6px 8px;
  border-radius: 12px;
  cursor: pointer;
}

.wt-group-head:hover {
  background: rgba(var(--mdui-color-on-surface), 0.04);
}

.wt-group-emoji {
  font-size: 1.25rem;
}

.wt-group-arrow {
  font-size: 1.125rem;
  opacity: 0.4;
}

.wt-session-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.wt-session-card {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-session-top {
  display: flex;
  gap: 10px;
  align-items: center;
}

.wt-session-icon {
  font-size: 1.25rem;
}

.wt-session-body {
  min-width: 0;
  flex: 1;
}

.wt-session-title {
  font-weight: 500;
  font-size: 0.9375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-session-scene {
  display: flex;
  align-items: center;
  gap: 3px;
  color: rgb(var(--mdui-color-primary));
}

.wt-session-scene .material-icons-round {
  font-size: 0.875rem;
}

.wt-session-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px dashed rgba(var(--mdui-color-outline-variant), 0.6);
  padding-top: 6px;
}

.wt-session-actions {
  display: flex;
  gap: 0;
  opacity: 0;
  transition: opacity 160ms;
}

.wt-session-card:hover .wt-session-actions {
  opacity: 1;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 100px;
}
</style>




