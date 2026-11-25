<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ScriptListItem } from '@/api';
import { api } from '@/api';
import { askConfirm, askText, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const router = useRouter();
const items = ref<ScriptListItem[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await api.listScripts();
    items.value = res.items;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function create() {
  const name = await askText('新建剧本', '', '剧本用 Markdown DSL 编写，保存时会自动编译为节点图。');
  if (!name?.trim()) return;
  try {
    const rec = await api.createScript({ title: name.trim() });
    router.push(`/scripts/${rec.id}`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function remove(item: ScriptListItem) {
  const ok = await askConfirm('删除这个剧本文件？', item.file);
  if (!ok) return;
  // 剧本没有独立删除接口，借世界删除逻辑：直接提示手动删
  toast('请在世界编辑页解绑，或直接删除 content/' + item.file);
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">剧本</h1>
          <p class="wt-muted">
            用 Markdown DSL 写剧本，保存时编译为节点图。支持内嵌固定事件与全局概率事件。
          </p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="filled" icon="add" @click="create">新建剧本</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <div v-else-if="items.length" class="wt-script-grid">
        <article
          v-for="s in items"
          :key="s.id"
          class="wt-script-card wt-clickable"
          @click="router.push(`/scripts/${s.id}`)"
        >
          <div class="wt-script-head">
            <span class="material-icons-outlined wt-script-icon">account_tree</span>
            <div class="wt-script-title">
              <strong>{{ s.title }}</strong>
              <span class="wt-mono wt-muted">{{ s.id }}</span>
            </div>
          </div>

          <div class="wt-script-stats">
            <span><span class="material-icons-outlined">widgets</span>{{ s.nodeCount }} 节点</span>
            <span><span class="material-icons-outlined">bolt</span>{{ s.eventCount }} 事件</span>
          </div>

          <div v-if="s.errors.length" class="wt-script-badge error">
            <span class="material-icons-outlined">error</span>
            {{ s.errors.length }} 个错误
          </div>
          <div v-else-if="s.warnings.length" class="wt-script-badge warn">
            <span class="material-icons-outlined">warning</span>
            {{ s.warnings.length }} 个警告
          </div>
          <div v-else class="wt-script-badge ok">
            <span class="material-icons-outlined">check_circle</span>
            编译通过
          </div>

          <div class="wt-script-foot wt-small wt-muted">
            <span class="wt-mono">{{ s.file }}</span>
            <mdui-button-icon icon="delete" small @click.stop="remove(s)" />
          </div>
        </article>
      </div>

      <div v-else class="wt-empty">
        <div class="material-icons-outlined wt-empty-emoji">account_tree</div>
        <div>还没有剧本</div>
        <div class="wt-small">剧本是「剧本驱动」模式的核心</div>
        <mdui-button variant="filled" @click="create">新建第一个</mdui-button>
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
  max-width: 640px;
}

.wt-script-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.wt-script-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-script-head {
  display: flex;
  gap: 10px;
  align-items: center;
}

.wt-script-icon {
  font-size: 1.5rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-script-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wt-script-title strong {
  font-size: 1rem;
}

.wt-script-title .wt-mono {
  font-size: 0.6875rem;
  opacity: 0.7;
}

.wt-script-stats {
  display: flex;
  gap: 16px;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-script-stats span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wt-script-stats .material-icons-outlined {
  font-size: 1rem;
}

.wt-script-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
}

.wt-script-badge .material-icons-outlined {
  font-size: 0.8125rem;
}

.wt-script-badge.ok {
  background: rgba(76, 175, 80, 0.14);
  color: #2e7d32;
}

.wt-script-badge.warn {
  background: rgba(217, 131, 36, 0.16);
  color: #a5691c;
}

.wt-script-badge.error {
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}

.wt-script-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--mdui-color-outline-variant), 0.6);
}

.wt-script-foot .wt-mono {
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-empty-emoji {
  font-size: 2.5rem;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}
</style>
