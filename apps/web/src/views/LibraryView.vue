<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { WorldSummary } from '@worldtree/shared';
import { api } from '@/api';
import { useLibraryStore } from '@/stores/library';
import { useCatalogStore } from '@/stores/catalog';
import { MODE_ICONS, MODE_LABELS, askConfirm, formatTime, toast } from '@/utils/ui';

const router = useRouter();
const library = useLibraryStore();
const catalog = useCatalogStore();

const keyword = ref('');
const modeFilter = ref<string>('all');
const creating = ref(false);

const filtered = computed<WorldSummary[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  return library.worlds.filter((w) => {
    if (modeFilter.value !== 'all' && w.world.mode !== modeFilter.value) return false;
    if (!kw) return true;
    const hay = [w.world.title, w.world.subtitle, w.world.description, ...w.world.tags]
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
});

const stats = computed(() => {
  const all = library.worlds;
  return {
    worlds: all.length,
    sessions: all.reduce((a, w) => a + w.sessionCount, 0),
    tags: new Set(all.flatMap((w) => w.world.tags)).size,
  };
});

function open(w: WorldSummary) {
  router.push(`/worlds/${w.world.id}`);
}

async function quickStart(w: WorldSummary) {
  try {
    const res = await api.createSession(w.world.id, {});
    router.push(`/play/${res.session.id}`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function remove(w: WorldSummary) {
  const ok = await askConfirm('删除这个世界？', `《${w.world.title}》及其所有世界线将被永久删除。`);
  if (!ok) return;
  await api.deleteWorld(w.world.id);
  await library.load();
  toast('已删除');
}

onMounted(async () => {
  await library.load();
  await catalog.load();
});

void creating;
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <!-- 顶部氛围区 -->
      <section class="wt-hero wt-enter">
        <div class="wt-hero-text">
          <h1 class="wt-hero-title">世界树</h1>
          <p class="wt-hero-sub">
            把剧本交给 AI，让它替你推演。保存每一条世界线，从任意存档继续——你做的每个选择，都在写着不同的结局。
          </p>
          <div class="wt-row wt-hero-stats">
            <div class="wt-stat">
              <div class="wt-stat-num">{{ stats.worlds }}</div>
              <div class="wt-stat-label">个世界</div>
            </div>
            <div class="wt-stat">
              <div class="wt-stat-num">{{ stats.sessions }}</div>
              <div class="wt-stat-label">条世界线</div>
            </div>
            <div class="wt-stat">
              <div class="wt-stat-num">{{ stats.tags }}</div>
              <div class="wt-stat-label">种题材</div>
            </div>
          </div>
        </div>
        <div class="wt-hero-art" aria-hidden="true">
          <div class="wt-orb wt-orb-1"></div>
          <div class="wt-orb wt-orb-2"></div>
          <div class="wt-hero-tree">🌳</div>
        </div>
      </section>

      <!-- 工具栏 -->
      <div class="wt-toolbar">
        <mdui-text-field
          v-model="keyword"
          placeholder="搜索世界、标签、简介…"
          icon="search"
          variant="outlined"
          clearable
          class="wt-search"
        ></mdui-text-field>
        <div class="wt-seg">
          <button
            v-for="m in [
              { k: 'all', label: '全部' },
              { k: 'story', label: '自由叙事' },
              { k: 'script', label: '剧本' },
              { k: 'coc', label: '跑团' },
            ]"
            :key="m.k"
            class="wt-seg-item"
            :class="{ active: modeFilter === m.k }"
            @click="modeFilter = m.k"
          >
            {{ m.label }}
          </button>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="filled" icon="add" @click="router.push('/worlds/new')">
          新建世界
        </mdui-button>
      </div>

      <!-- 加载态 -->
      <div v-if="library.loading" class="wt-grid">
        <div v-for="i in 6" :key="i" class="wt-skeleton"></div>
      </div>

      <div v-else-if="library.error" class="wt-empty">
        <div class="wt-empty-emoji">🌵</div>
        <div>无法连接到后端服务</div>
        <div class="wt-small wt-muted">{{ library.error }}</div>
        <mdui-button variant="tonal" @click="library.load()">重试</mdui-button>
      </div>

      <!-- 世界卡片 -->
      <div v-else-if="filtered.length" class="wt-grid">
        <article
          v-for="(w, i) in filtered"
          :key="w.world.id"
          class="wt-world-card wt-clickable wt-enter"
          :style="{ animationDelay: `${Math.min(i, 8) * 30}ms` }"
          @click="open(w)"
        >
          <div class="wt-cover" :style="{ background: w.world.coverColor }">
            <span class="material-icons-outlined wt-cover-emoji">{{ w.world.coverIcon }}</span>
            <span class="wt-cover-mode">
              <span class="material-icons-round">{{ MODE_ICONS[w.world.mode] }}</span>
              {{ MODE_LABELS[w.world.mode] }}
            </span>
          </div>
          <div class="wt-card-body">
            <h3 class="wt-card-title">{{ w.world.title }}</h3>
            <p class="wt-card-sub wt-muted">{{ w.world.subtitle || w.world.description.slice(0, 48) }}</p>
            <div class="wt-chip-row">
              <span v-for="t in w.world.tags.slice(0, 3)" :key="t" class="wt-tag">{{ t }}</span>
            </div>
            <div class="wt-card-foot">
              <span class="wt-muted wt-small">
                <span class="material-icons-round wt-inline-icon">route</span>
                {{ w.sessionCount }} 条世界线
              </span>
              <span class="wt-muted wt-small">{{ w.lastPlayedAt ? formatTime(w.lastPlayedAt) : '未开始' }}</span>
            </div>
          </div>
          <div class="wt-card-actions">
            <mdui-button
              variant="tonal"
              icon="play_arrow"
              @click.stop="quickStart(w)"
            >
              开始
            </mdui-button>
            <mdui-button-icon icon="more_vert" @click.stop="remove(w)" aria-label="删除" />
          </div>
        </article>

        <!-- 新建卡片 -->
        <article class="wt-world-card wt-new-card wt-clickable" @click="router.push('/worlds/new')">
          <span class="material-icons-round wt-new-icon">add_circle</span>
          <div class="wt-card-title">创造一个世界</div>
          <div class="wt-muted wt-small">从空白开始，或复制示例</div>
        </article>
      </div>

      <div v-else class="wt-empty">
        <div class="wt-empty-emoji">📭</div>
        <div>还没有匹配的世界</div>
        <div class="wt-small">试着换个关键词，或者新建一个</div>
        <mdui-button variant="filled" @click="router.push('/worlds/new')">新建世界</mdui-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-hero {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 28px 32px;
  margin-bottom: 28px;
  border-radius: 28px;
  background:
    radial-gradient(1100px 320px at 8% -40%, rgba(var(--mdui-color-primary), 0.18), transparent 70%),
    rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  overflow: hidden;
  position: relative;
}

.wt-hero-text {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.wt-hero-title {
  font-size: 2.25rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  margin: 0 0 8px;
}

.wt-hero-sub {
  margin: 0 0 20px;
  max-width: 560px;
  line-height: 1.75;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.9375rem;
}

.wt-hero-stats {
  gap: 28px;
}

.wt-stat-num {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  color: rgb(var(--mdui-color-primary));
}

.wt-stat-label {
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  letter-spacing: 0.04em;
}

.wt-hero-art {
  position: relative;
  width: 180px;
  height: 140px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.wt-hero-tree {
  font-size: 4.5rem;
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.18));
  animation: wt-sway 6s ease-in-out infinite;
}

@keyframes wt-sway {
  0%, 100% { transform: rotate(-3deg) translateY(0); }
  50% { transform: rotate(3deg) translateY(-6px); }
}

.wt-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(18px);
  opacity: 0.55;
}

.wt-orb-1 {
  width: 110px;
  height: 110px;
  background: rgba(var(--mdui-color-primary), 0.5);
  top: 0;
  right: 20px;
}

.wt-orb-2 {
  width: 90px;
  height: 90px;
  background: rgba(var(--mdui-color-tertiary), 0.45);
  bottom: 0;
  left: 10px;
}

.wt-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}

.wt-search {
  max-width: 320px;
}

.wt-seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-seg-item {
  border: none;
  background: transparent;
  padding: 8px 16px;
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.wt-seg-item.active {
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
  font-weight: 500;
}

.wt-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(292px, 1fr));
}

.wt-world-card {
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
  border-radius: 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

.wt-cover {
  height: 132px;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
}

.wt-cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.28));
}

.wt-cover-emoji {
  font-size: 3.25rem;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.3));
  z-index: 1;
}

.wt-cover-mode {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
}

.wt-cover-mode .material-icons-round {
  font-size: 0.875rem;
}

.wt-card-body {
  padding: 16px 18px 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-card-sub {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  min-height: 2.6em;
}

.wt-tag {
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-primary), 0.1);
  color: rgb(var(--mdui-color-primary));
}

.wt-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--mdui-color-outline-variant), 0.6);
}

.wt-inline-icon {
  font-size: 0.875rem;
  vertical-align: -2px;
  margin-right: 2px;
}

.wt-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 14px;
  justify-content: flex-end;
}

.wt-new-card {
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  border-style: dashed;
  background: transparent;
  text-align: center;
  min-height: 260px;
}

.wt-new-icon {
  font-size: 2.5rem;
  color: rgb(var(--mdui-color-primary));
  opacity: 0.7;
}

.wt-skeleton {
  height: 268px;
  border-radius: 22px;
  background: linear-gradient(
    100deg,
    rgba(var(--mdui-color-surface-container), 0.6) 30%,
    rgba(var(--mdui-color-surface-container-high), 0.9) 50%,
    rgba(var(--mdui-color-surface-container), 0.6) 70%
  );
  background-size: 220% 100%;
  animation: wt-shimmer 1.4s ease-in-out infinite;
}

@keyframes wt-shimmer {
  from { background-position: 140% 0; }
  to { background-position: -40% 0; }
}

@media (max-width: 720px) {
  .wt-hero {
    padding: 22px;
    flex-direction: column;
    align-items: flex-start;
  }
  .wt-hero-art {
    display: none;
  }
  .wt-hero-title {
    font-size: 1.75rem;
  }
  .wt-search {
    max-width: none;
    flex: 1;
  }
}
</style>

