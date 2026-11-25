<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { WorldBook } from '@worldtree/shared';
import { api } from '@/api';
import { askConfirm, askText, formatTime, toast } from '@/utils/ui';

const router = useRouter();
const books = ref<WorldBook[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await api.listBooks();
    books.value = res.items;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function createBook() {
  const name = await askText('新建世界书', '', '世界书用于存放大量设定，命中关键词时会自动注入上下文。');
  if (!name?.trim()) return;
  try {
    const book = await api.createBook({ name: name.trim() });
    router.push(`/worldbooks/${book.id}`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function remove(b: WorldBook) {
  const ok = await askConfirm('删除这本世界书？', `「${b.name}」的 ${b.entries.length} 个条目将被删除。`);
  if (!ok) return;
  await api.deleteBook(b.id);
  await load();
  toast('已删除');
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">世界书</h1>
          <p class="wt-muted">设定集。命中关键词的条目会被注入模型上下文，避免一次性塞满提示词。</p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="filled" icon="add" @click="createBook">新建世界书</mdui-button>
      </header>

      <div v-if="loading" class="wt-grid">
        <div v-for="i in 3" :key="i" class="wt-skeleton"></div>
      </div>

      <div v-else-if="books.length" class="wt-grid">
        <article
          v-for="b in books"
          :key="b.id"
          class="wt-book-card wt-clickable"
          @click="router.push(`/worldbooks/${b.id}`)"
        >
          <div class="wt-book-icon"><span class="material-icons-outlined">menu_book</span></div>
          <div class="wt-book-body">
            <h3 class="wt-card-title">{{ b.name }}</h3>
            <p class="wt-muted wt-small wt-clamp2">{{ b.description || '（无描述）' }}</p>
            <div class="wt-book-meta wt-small wt-muted">
              <span>{{ b.entries.length }} 个条目</span>
              <span>·</span>
              <span>扫描 {{ b.scanDepth }} 条 / 预算 {{ b.tokenBudget }} 字</span>
            </div>
            <div class="wt-book-foot">
              <span class="wt-small wt-muted">更新于 {{ formatTime(b.updatedAt) }}</span>
              <mdui-button-icon icon="delete" @click.stop="remove(b)" />
            </div>
          </div>
        </article>
      </div>

      <div v-else class="wt-empty">
        <div class="wt-empty-emoji material-icons-outlined">menu_book</div>
        <div>还没有世界书</div>
        <mdui-button variant="filled" @click="createBook">创建第一本</mdui-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

.wt-page-title {
  font-size: 1.5rem;
  margin: 0 0 4px;
}

.wt-page-head p {
  margin: 0;
  font-size: 0.875rem;
  max-width: 620px;
}

.wt-book-card {
  display: flex;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-book-icon {
  width: 54px;
  height: 54px;
  flex-shrink: 0;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 1.75rem;
  background: rgb(var(--mdui-color-surface-container-high));
}

.wt-book-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wt-clamp2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}

.wt-book-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.wt-book-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 6px;
}

.wt-skeleton {
  height: 150px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container));
}
</style>

