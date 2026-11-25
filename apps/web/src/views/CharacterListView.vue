<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { CharacterCard } from '@worldtree/shared';
import { api } from '@/api';
import { arrayBufferToBase64 } from '@/api/http';
import { askConfirm, toast } from '@/utils/ui';
import WtAvatar from '@/components/WtAvatar.vue';

const router = useRouter();
const items = ref<CharacterCard[]>([]);
const loading = ref(true);
const keyword = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return items.value;
  return items.value.filter((c) =>
    [c.name, c.description, c.creatorNotes, ...c.tags].join(' ').toLowerCase().includes(kw),
  );
});

async function load() {
  loading.value = true;
  try {
    const res = await api.listCharacters();
    items.value = res.items;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function create() {
  try {
    const c = await api.createCharacter({ name: '新角色', avatarIcon: 'person' });
    router.push(`/characters/${c.id}`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function remove(c: CharacterCard) {
  const ok = await askConfirm('删除这个角色？', c.name);
  if (!ok) return;
  await api.deleteCharacter(c.id);
  await load();
  toast('已删除');
}

/** 导入 ST 角色卡：JSON 或 PNG */
async function onImport(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const res = await api.importCharacterPng(base64);
      toast(`已导入 ${res.card.name}${res.warnings.length ? `（${res.warnings.length} 个警告）` : ''}`);
    } else {
      const payload = JSON.parse(await file.text());
      const res = await api.importCharacter(payload);
      toast(`已导入 ${res.card.name}${res.warnings.length ? `（${res.warnings.length} 个警告）` : ''}`);
    }
    await load();
  } catch (err) {
    toast(`导入失败：${(err as Error).message}`);
  }
}

function exportJson(c: CharacterCard) {
  window.open(`/api/characters/${c.id}/export`, '_blank');
}

function exportPng(c: CharacterCard) {
  window.open(`/api/characters/${c.id}/export-png`, '_blank');
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">角色卡</h1>
          <p class="wt-muted">
            兼容 SillyTavern V2 格式，支持 JSON 与 PNG 角色卡导入导出。
          </p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-text-field
          v-model="keyword"
          placeholder="搜索角色"
          icon="search"
          variant="outlined"
          clearable
          class="wt-search"
        ></mdui-text-field>
        <input ref="fileInput" type="file" accept=".json,.png" hidden @change="onImport" />
        <mdui-button variant="outlined" icon="upload" @click="fileInput?.click()">导入</mdui-button>
        <mdui-button variant="filled" icon="person_add" @click="create">新建角色</mdui-button>
      </header>

      <div v-if="loading" class="wt-grid">
        <div v-for="i in 4" :key="i" class="wt-skeleton"></div>
      </div>

      <div v-else-if="filtered.length" class="wt-char-grid">
        <article
          v-for="c in filtered"
          :key="c.id"
          class="wt-char-card wt-clickable"
          @click="router.push(`/characters/${c.id}`)"
        >
          <WtAvatar :image="c.avatarImage" :icon="c.avatarIcon" :color="c.avatarColor" :size="56" shape="round" />
          <div class="wt-char-body">
            <div class="wt-row wt-gap-6">
              <strong class="wt-char-name">{{ c.name }}</strong>
              <span v-if="c.isPlayer" class="wt-badge">玩家</span>
              <span v-if="c.sheet" class="wt-badge-soft">COC</span>
            </div>
            <div class="wt-muted wt-small">{{ c.creatorNotes || '—' }}</div>
            <p class="wt-char-desc">{{ c.description || '（还没有描述）' }}</p>
            <div class="wt-chip-row">
              <span v-for="t in c.tags.slice(0, 3)" :key="t" class="wt-tag">{{ t }}</span>
            </div>
          </div>
          <div class="wt-char-actions">
            <mdui-button-icon icon="download" small @click.stop="exportJson(c)" aria-label="导出 JSON" />
            <mdui-button-icon icon="image" small @click.stop="exportPng(c)" aria-label="导出 PNG" />
            <mdui-button-icon icon="delete" small @click.stop="remove(c)" aria-label="删除" />
          </div>
        </article>
      </div>

      <div v-else class="wt-empty">
        <div class="material-icons-outlined wt-empty-emoji">person</div>
        <div>还没有角色卡</div>
        <div class="wt-small">可以直接拖入 SillyTavern 的角色卡</div>
        <mdui-button variant="filled" @click="create">创建第一个角色</mdui-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-gap-6 { gap: 6px; }

.wt-page-head {
  display: flex;
  align-items: center;
  gap: 14px;
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
  max-width: 220px;
}

.wt-char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.wt-char-card {
  display: flex;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
  position: relative;
}

.wt-char-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wt-char-name {
  font-size: 1rem;
}

.wt-char-desc {
  margin: 4px 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: rgb(var(--mdui-color-on-surface-variant));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wt-badge {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
}

.wt-badge-soft {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.16);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-tag {
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.07);
}

.wt-char-actions {
  display: flex;
  flex-direction: column;
  gap: 0;
  opacity: 0;
  transition: opacity 160ms;
}

.wt-char-card:hover .wt-char-actions {
  opacity: 1;
}

.wt-skeleton {
  height: 150px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-empty-emoji {
  font-size: 2.5rem;
}
</style>
