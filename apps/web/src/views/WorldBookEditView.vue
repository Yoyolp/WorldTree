<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SelectiveLogic, WorldBook, WorldBookEntry } from '@worldtree/shared';
import { api } from '@/api';
import { askConfirm, toast, evValue } from '@/utils/ui';
import { uploadImage, assetUrl } from '@/utils/image';
import WtLoader from '@/components/WtLoader.vue';

const route = useRoute();
const router = useRouter();

const book = ref<WorldBook | null>(null);
const loading = ref(true);
const saving = ref(true);
const testText = ref('');
const activeId = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

/** 条目配图 */
const entryImageInput = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);

const meta = reactive({ name: '', description: '', scanDepth: 6, tokenBudget: 4000, recursiveScanning: false });
const entries = ref<WorldBookEntry[]>([]);

const active = computed(() => entries.value.find((e) => e.id === activeId.value) ?? null);
/** 上传条目配图（1280 最长边，够看清细节又不至于太大） */
async function onPickEntryImage(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !active.value) return;
  imageUploading.value = true;
  try {
    active.value.image = await uploadImage(file, { prefix: 'wb', maxEdge: 1280 });
    toast('配图已上传');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    imageUploading.value = false;
    input.value = '';
  }
}

const selectiveLogicOptions: { value: SelectiveLogic; label: string }[] = [
  { value: 'and', label: 'AND（次关键词必须命中）' },
  { value: 'or', label: 'OR（主关键词命中即可）' },
  { value: 'not', label: 'NOT（次关键词不得命中）' },
];

/* 命中测试 */
function safeRegex(p: string, cs: boolean): RegExp {
  try {
    return new RegExp(p, cs ? '' : 'i');
  } catch {
    return /$^/;
  }
}

function hits(entry: WorldBookEntry): boolean {
  const text = testText.value.trim();
  if (!text) return false;
  if (!entry.enabled) return false;
  if (entry.constant) return true;

  const check = (k: string) => {
    const parts = k.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.some((p) => {
      if (entry.useRegex) return safeRegex(p, entry.caseSensitive).test(text);
      if (entry.matchWholeWords && /^[\w\s-]+$/.test(p)) {
        return new RegExp(`\\b${p}\\b`, entry.caseSensitive ? '' : 'i').test(text);
      }
      return entry.caseSensitive ? text.includes(p) : text.toLowerCase().includes(p.toLowerCase());
    });
  };

  const primary = entry.keys.some(check);
  if (!primary) return false;
  if (entry.selective && entry.secondaryKeys.length) {
    const sec = entry.secondaryKeys.some(check);
    if (entry.selectiveLogic === 'and') return sec;
    if (entry.selectiveLogic === 'not') return !sec;
    return true;
  }
  return true;
}

function newEntry(): WorldBookEntry {
  return {
    id: `entry_${Math.random().toString(36).slice(2, 8)}`,
    comment: '新条目',
    keys: [],
    secondaryKeys: [],
    selective: true,
    selectiveLogic: 'and',
    constant: false,
    caseSensitive: false,
    useRegex: false,
    matchWholeWords: false,
    priority: 50,
    insertionOrder: entries.value.length,
    position: 'before_char',
    depth: 0,
    probability: 100,
    useProbability: false,
    group: '',
    cooldown: 0,
    sticky: 0,
    content: '',
    maxChars: 0,
    image: undefined,
    imageCaption: '',
    enabled: true,
  };
}

function addEntry() {
  const e = newEntry();
  entries.value.unshift(e);
  activeId.value = e.id;
}

function removeEntry(e: WorldBookEntry) {
  const idx = entries.value.findIndex((x) => x.id === e.id);
  if (idx >= 0) entries.value.splice(idx, 1);
  if (activeId.value === e.id) activeId.value = entries.value[0]?.id ?? null;
}

function duplicateEntry(e: WorldBookEntry) {
  const copy = { ...JSON.parse(JSON.stringify(e)), id: `entry_${Math.random().toString(36).slice(2, 8)}`, comment: `${e.comment} 副本` };
  entries.value.unshift(copy);
  activeId.value = copy.id;
}

async function load() {
  loading.value = true;
  try {
    const b = await api.getBook(String(route.params.id));
    book.value = b;
    meta.name = b.name;
    meta.description = b.description;
    meta.scanDepth = b.scanDepth;
    meta.tokenBudget = b.tokenBudget;
    meta.recursiveScanning = b.recursiveScanning;
    entries.value = JSON.parse(JSON.stringify(b.entries)) as WorldBookEntry[];
    activeId.value = entries.value[0]?.id ?? null;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
    saving.value = false;
  }
}

async function save() {
  if (!book.value) return;
  saving.value = true;
  try {
    book.value = await api.updateBook(book.value.id, {
      name: meta.name,
      description: meta.description,
      scanDepth: Number(meta.scanDepth) || 6,
      tokenBudget: Number(meta.tokenBudget) || 4000,
      recursiveScanning: meta.recursiveScanning,
      entries: entries.value,
    });
    toast('已保存');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function removeBook() {
  if (!book.value) return;
  const ok = await askConfirm('删除这本世界书？');
  if (!ok) return;
  await api.deleteBook(book.value.id);
  router.push('/worldbooks');
}

function keysText(entry: WorldBookEntry): string {
  return entry.keys.join('、');
}

function setKeys(entry: WorldBookEntry, v: string) {
  entry.keys = v
    .split(/[、,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function secKeysText(entry: WorldBookEntry): string {
  return entry.secondaryKeys.join('、');
}

function setSecKeys(entry: WorldBookEntry, v: string) {
  entry.secondaryKeys = v
    .split(/[、,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function exportSt() {
  if (book.value) window.open(`/api/worldbooks/${book.value.id}/export`, '_blank');
}

async function onImport(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const res = await api.importBook(payload);
    toast(`已导入 ${res.book.name}`);
    router.push(`/worldbooks/${res.book.id}`);
  } catch (err) {
    toast(`导入失败：${(err as Error).message}`);
  }
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <mdui-button-icon icon="arrow_back" @click="router.push('/worldbooks')" />
        <div>
          <h1 class="wt-page-title">{{ meta.name || '世界书' }}</h1>
          <p class="wt-muted wt-small">
            {{ entries.length }} 个条目 · {{ entries.filter((e) => e.enabled).length }} 个启用 · 预算 {{ meta.tokenBudget }} 字符
          </p>
        </div>
        <div class="wt-spacer"></div>
        <input ref="fileInput" type="file" accept=".json" hidden @change="onImport" />
        <mdui-button variant="text" icon="upload" @click="fileInput?.click()">导入</mdui-button>
        <mdui-button variant="text" icon="download" @click="exportSt">
          导出 ST
        </mdui-button>
        <mdui-button variant="text" icon="delete" @click="removeBook">删除</mdui-button>
        <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <div v-else class="wt-wb-layout">
        <!-- 左：条目列表 -->
        <aside class="wt-wb-list">
          <div class="wt-wb-list-head">
            <span class="wt-label">条目</span>
            <mdui-button-icon icon="add" @click="addEntry" aria-label="新增条目" />
          </div>
          <button
            v-for="e in entries"
            :key="e.id"
            class="wt-entry-item"
            :class="{ active: activeId === e.id, disabled: !e.enabled, hit: testText && hits(e) }"
            @click="activeId = e.id"
          >
            <div class="wt-entry-top">
              <span class="wt-entry-name">{{ e.comment || '未命名' }}</span>
              <span v-if="e.constant" class="wt-pill const">常驻</span>
              <span v-else-if="testText && hits(e)" class="wt-pill hit">命中</span>
            </div>
            <div class="wt-entry-keys">
              {{ e.keys.length ? e.keys.slice(0, 4).join('、') : '（无关键词）' }}
            </div>
          </button>
          <div v-if="!entries.length" class="wt-empty-sm wt-muted wt-small">
            <span class="material-icons-outlined">inbox</span>
            <div>还没有条目</div>
          </div>
        </aside>

        <!-- 右：详情 -->
        <main class="wt-wb-main">
          <section class="wt-card wt-wb-meta">
            <div class="wt-form-row">
              <mdui-text-field v-model="meta.name" label="世界书名称" variant="outlined"></mdui-text-field>
              <mdui-text-field
                v-model.number="meta.scanDepth"
                type="number"
                label="扫描最近 N 条消息"
                variant="outlined"
              ></mdui-text-field>
              <mdui-text-field
                v-model.number="meta.tokenBudget"
                type="number"
                label="注入字符预算"
                variant="outlined"
              ></mdui-text-field>
            </div>
            <mdui-text-field v-model="meta.description" label="描述" variant="outlined"></mdui-text-field>
            <mdui-checkbox
              :checked="meta.recursiveScanning"
              @change="meta.recursiveScanning = ($event.target as any).checked"
            >
              递归扫描（命中内容再扫一次）
            </mdui-checkbox>
            <mdui-text-field
              v-model="testText"
              label="命中测试：粘贴一段文本，左侧会标出会被触发的条目"
              variant="outlined"
              rows="2"
              autosize
            ></mdui-text-field>
          </section>

          <section v-if="active" class="wt-card wt-entry-editor">
            <div class="wt-row wt-entry-head">
              <mdui-text-field v-model="active.comment" label="备注名（comment）" variant="outlined" class="wt-flex1"></mdui-text-field>
              <mdui-switch :checked="active.enabled" @change="active.enabled = ($event.target as any).checked"></mdui-switch>
              <mdui-button-icon icon="content_copy" @click="duplicateEntry(active)" aria-label="复制条目" />
              <mdui-button-icon icon="delete" @click="removeEntry(active)" aria-label="删除条目" />
            </div>

            <div class="wt-form-row">
              <mdui-text-field
                :model-value="keysText(active)"
                label="主关键词（key，顿号分隔）"
                variant="outlined"
                @input="setKeys(active!, ($event.target as any).value)"
              ></mdui-text-field>
            </div>
            <div class="wt-form-row">
              <mdui-text-field
                :model-value="secKeysText(active)"
                label="次关键词（keysecondary）"
                variant="outlined"
                @input="setSecKeys(active!, ($event.target as any).value)"
              ></mdui-text-field>
              <mdui-select :value="active.selectiveLogic" variant="outlined" label="次关键词逻辑" @change="active.selectiveLogic = evValue($event) as any">
                <mdui-menu-item v-for="o in selectiveLogicOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </mdui-menu-item>
              </mdui-select>
            </div>

            <div class="wt-form-row">
              <mdui-text-field v-model.number="active.priority" type="number" label="优先级" variant="outlined"></mdui-text-field>
              <mdui-text-field v-model.number="active.insertionOrder" type="number" label="插入顺序" variant="outlined"></mdui-text-field>
              <mdui-text-field v-model.number="active.maxChars" type="number" label="最大字符（0=不限）" variant="outlined"></mdui-text-field>
              <mdui-text-field v-model.number="active.probability" type="number" label="触发概率 %" variant="outlined"></mdui-text-field>
            </div>

            <div class="wt-form-row">
              <mdui-text-field v-model="active.group" label="分组（同组只取一个）" variant="outlined"></mdui-text-field>
              <mdui-text-field v-model.number="active.cooldown" type="number" label="冷却回合" variant="outlined"></mdui-text-field>
              <mdui-text-field v-model.number="active.sticky" type="number" label="保持回合" variant="outlined"></mdui-text-field>
              <mdui-select :value="active.position" variant="outlined" label="注入位置" @change="active.position = evValue($event) as any">
                <mdui-menu-item value="before_char">角色设定之前</mdui-menu-item>
                <mdui-menu-item value="after_char">角色设定之后</mdui-menu-item>
                <mdui-menu-item value="at_depth">按深度插入</mdui-menu-item>
              </mdui-select>
            </div>

            <div class="wt-flag-row">
              <mdui-checkbox :checked="active.constant" @change="active.constant = ($event.target as any).checked">
                常驻条目
              </mdui-checkbox>
              <mdui-checkbox :checked="active.selective" @change="active.selective = ($event.target as any).checked">
                选择性匹配
              </mdui-checkbox>
              <mdui-checkbox :checked="active.caseSensitive" @change="active.caseSensitive = ($event.target as any).checked">
                大小写敏感
              </mdui-checkbox>
              <mdui-checkbox :checked="active.useRegex" @change="active.useRegex = ($event.target as any).checked">
                正则解析
              </mdui-checkbox>
              <mdui-checkbox :checked="active.matchWholeWords" @change="active.matchWholeWords = ($event.target as any).checked">
                整词匹配
              </mdui-checkbox>
              <mdui-checkbox
                :checked="active.useProbability"
                @change="active.useProbability = ($event.target as any).checked"
              >
                启用概率
              </mdui-checkbox>
            </div>

            <mdui-text-field
              v-model="active.content"
              label="条目内容（content）"
              variant="outlined"
              rows="10"
              autosize
              max-rows="26"
            ></mdui-text-field>

            <!-- 条目配图：纯展示，不注入提示词、不占 token 预算 -->
            <div class="wt-entry-image">
              <div class="wt-label">配图（可选）</div>
              <div class="wt-entry-image-row">
                <div class="wt-entry-image-preview">
                  <img v-if="active.image" :src="assetUrl(active.image)" alt="" />
                  <span v-else class="material-icons-outlined">image</span>
                </div>
                <div class="wt-entry-image-controls">
                  <input
                    ref="entryImageInput"
                    type="file"
                    accept="image/*"
                    class="wt-hidden-file"
                    @change="onPickEntryImage"
                  />
                  <div class="wt-row wt-gap-6">
                    <mdui-button variant="tonal" :disabled="imageUploading" @click="entryImageInput?.click()">
                      {{ imageUploading ? '上传中…' : active.image ? '换图片' : '上传图片' }}
                    </mdui-button>
                    <mdui-button v-if="active.image" variant="text" @click="active.image = undefined">移除</mdui-button>
                  </div>
                  <mdui-text-field
                    v-model="active.imageCaption"
                    label="图注（显示在图片下方）"
                    variant="outlined"
                    density="1"
                  ></mdui-text-field>
                  <p class="wt-small wt-muted">图片只用于展示，不会写进提示词。</p>
                </div>
              </div>
            </div>


            <div class="wt-entry-preview">
              <div class="wt-label">注入预览</div>
              <pre class="wt-preview-box">{{ active.content || '（空）' }}</pre>
            </div>
          </section>

          <section v-else class="wt-empty">
            <div class="material-icons-outlined wt-empty-emoji">touch_app</div>
            <div>从左侧选择一个条目，或新建一个</div>
            <mdui-button variant="tonal" icon="add" @click="addEntry">新增条目</mdui-button>
          </section>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.wt-page-title {
  font-size: 1.375rem;
  margin: 0;
}

.wt-page-head p {
  margin: 2px 0 0;
}

.wt-flex1 {
  flex: 1;
}

.wt-form-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.wt-form-row > * {
  flex: 1;
  min-width: 160px;
}

.wt-wb-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.wt-wb-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 18px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  position: sticky;
  top: 8px;
}

.wt-wb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
}

.wt-entry-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  color: rgb(var(--mdui-color-on-surface));
}

.wt-entry-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.05);
}

.wt-entry-item.active {
  background: rgba(var(--mdui-color-primary), 0.12);
  border-color: rgba(var(--mdui-color-primary), 0.4);
}

.wt-entry-item.disabled {
  opacity: 0.5;
}

.wt-entry-item.hit {
  box-shadow: inset 3px 0 0 rgb(var(--mdui-color-primary));
}

.wt-entry-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wt-entry-name {
  font-size: 0.875rem;
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-entry-keys {
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-pill {
  font-size: 0.5625rem;
  padding: 1px 6px;
  border-radius: 999px;
}

.wt-pill.const {
  background: rgba(var(--mdui-color-tertiary), 0.16);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-pill.hit {
  background: rgba(var(--mdui-color-primary), 0.18);
  color: rgb(var(--mdui-color-primary));
}

.wt-wb-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.wt-wb-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-entry-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-entry-head {
  align-items: center;
}

.wt-flag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.wt-entry-preview {
  margin-top: 4px;
}

.wt-preview-box {
  margin: 6px 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgb(var(--mdui-color-surface-container));
  font-family: var(--wt-font-serif);
  font-size: 0.8125rem;
  line-height: 1.75;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
}

.wt-empty-sm {
  padding: 20px 8px;
  text-align: center;
}

.wt-empty-sm .material-icons-outlined {
  font-size: 1.5rem;
  opacity: 0.5;
}

.wt-empty-emoji {
  font-size: 2.5rem;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}

@media (max-width: 900px) {
  .wt-wb-layout {
    grid-template-columns: 1fr;
  }
  .wt-wb-list {
    position: static;
    max-height: 220px;
  }
}

/* ---- 条目配图 ---- */
.wt-entry-image-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.wt-entry-image-preview {
  width: 120px;
  height: 120px;
  border-radius: 14px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: rgb(var(--mdui-color-surface-container-high));
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-entry-image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wt-entry-image-controls {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}</style>





