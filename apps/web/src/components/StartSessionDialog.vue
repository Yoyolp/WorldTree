<script setup lang="ts">
/**
 * 开局对话框：挑一张角色卡当主角 + 选同行角色。
 *
 * 之前这里只有「你的称呼」输入框，主角卡是写死的（取世界自带的那张）。
 * 现在改成正经的选卡：世界队内的角色 + 角色库里的其他卡 + 不绑定。
 * 上次选过什么会记在 localStorage，下次进来预选好，直接点开始。
 */
import { computed, ref, watch } from 'vue';
import type { CharacterCard, World } from '@worldtree/shared';
import { api } from '@/api';

const props = defineProps<{
  open: boolean;
  world: World | null;
  /** 本世界的角色（含世界自带的主角卡） */
  cast: CharacterCard[];
  starting?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  start: [payload: { playerCharacterId: string | null; characterIds: string[] }];
}>();

const library = ref<CharacterCard[]>([]);
const loadingLibrary = ref(false);
const playerId = ref<string | null>(null);
/** 用户手动取消勾选的同行角色（记「排除谁」而不是「选了谁」，换主角时不会乱） */
const excluded = ref<Set<string>>(new Set());
const showAdvanced = ref(false);

const mode = computed(() => props.world?.playerCardMode ?? 'open');
const allowCustom = computed(() => mode.value !== 'fixed');

const builtIn = computed(() => props.cast.find((c) => c.isPlayer) ?? null);
const castIds = computed(() => new Set(props.cast.map((c) => c.id)));
/** 角色库里、不属于这个世界的卡 */
const extraCards = computed(() => library.value.filter((c) => !castIds.value.has(c.id)));
/** 当前模式下真正能选的卡数（fixed 世界不显示角色库） */
const visibleCount = computed(() => props.cast.length + (allowCustom.value ? extraCards.value.length : 0));

const companions = computed(() =>
  props.cast
    .filter((c) => c.id !== playerId.value && !excluded.value.has(c.id))
    .map((c) => c.id),
);

const pickedCard = computed(() => {
  if (!playerId.value) return null;
  return (
    props.cast.find((c) => c.id === playerId.value) ??
    library.value.find((c) => c.id === playerId.value) ??
    null
  );
});

const hint = computed(() => {
  if (!pickedCard.value) return '不绑定角色卡时，会按规则包自动生成一名调查员。';
  if (builtIn.value && pickedCard.value.id !== builtIn.value.id) {
    return `世界自带的「${builtIn.value.name}」会作为 NPC 出场。`;
  }
  return '';
});

const storageKey = computed(() => `wt.start.${props.world?.id ?? 'none'}`);

function snippet(s: string): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 58 ? `${t.slice(0, 58)}…` : t;
}

function loadRemembered() {
  if (!props.world) return;
  let saved: { playerId?: string | null; excluded?: string[] } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey.value) ?? 'null');
  } catch {
    saved = null;
  }

  const selectable = new Set([...props.cast.map((c) => c.id), ...extraCards.value.map((c) => c.id)]);
  const remembered = saved?.playerId && selectable.has(saved.playerId) ? saved.playerId : null;

  playerId.value = allowCustom.value ? (remembered ?? builtIn.value?.id ?? null) : (builtIn.value?.id ?? null);

  // 排除名单里剔除已经不存在 / 正被扮演的卡
  excluded.value = new Set(
    (saved?.excluded ?? []).filter((id) => castIds.value.has(id) && id !== playerId.value),
  );
}

function persist() {
  if (!props.world) return;
  try {
    localStorage.setItem(
      storageKey.value,
      JSON.stringify({ playerId: playerId.value, excluded: [...excluded.value] }),
    );
  } catch {
    /* 隐私模式下写不进去就算了，不影响开局 */
  }
}

async function prepare() {
  showAdvanced.value = false;
  if (!props.world) return;

  loadingLibrary.value = true;
  try {
    const res = await api.listCharacters();
    library.value = res.items;
  } catch {
    library.value = [];
  } finally {
    loadingLibrary.value = false;
  }
  loadRemembered();
}

watch(
  () => props.open,
  (open) => {
    if (open) void prepare();
  },
);

watch(
  () => props.world?.id,
  () => {
    if (props.open) void prepare();
  },
);

function selectPlayer(id: string | null) {
  playerId.value = id;
  if (id) excluded.value.delete(id);
}

function toggleCompanion(id: string) {
  const next = new Set(excluded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  excluded.value = next;
}

function start() {
  if (!props.world) return;
  persist();
  emit('start', { playerCharacterId: playerId.value, characterIds: companions.value });
}

function close() {
  emit('update:open', false);
}
</script>

<template>
  <mdui-dialog
    :open="open"
    icon="play_arrow"
    headline="开启新的世界线"
    @closed="close"
  >
    <div class="wt-start">
      <p class="wt-start-lead">你扮演谁？</p>

      <div class="wt-card-grid">
        <!-- 不绑定 -->
        <button
          v-if="allowCustom"
          type="button"
          class="wt-scard wt-scard-none"
          :class="{ picked: !playerId }"
          @click="selectPlayer(null)"
        >
          <span class="wt-scard-avatar wt-avatar-none">
            <span class="material-icons-outlined">casino</span>
          </span>
          <span class="wt-scard-main">
            <span class="wt-scard-name">不绑定角色卡</span>
            <span class="wt-scard-desc">自动生成一名调查员</span>
          </span>
          <span v-if="!playerId" class="material-icons-outlined wt-scard-check">check_circle</span>
        </button>

        <!-- 世界队内的角色 -->
        <button
          v-for="c in cast"
          :key="c.id"
          type="button"
          class="wt-scard"
          :class="{ picked: playerId === c.id }"
          @click="selectPlayer(c.id)"
        >
          <span
            class="wt-scard-avatar"
            :style="{ background: `color-mix(in srgb, ${c.avatarColor} 24%, transparent)`, color: c.avatarColor }"
          >
            <span class="material-icons-outlined">{{ c.avatarIcon }}</span>
          </span>
          <span class="wt-scard-main">
            <span class="wt-scard-name">
              {{ c.name }}
              <span v-if="c.isPlayer" class="wt-scard-badge">世界自带</span>
            </span>
            <span class="wt-scard-desc">{{ snippet(c.description || c.personality) }}</span>
          </span>
          <span v-if="playerId === c.id" class="material-icons-outlined wt-scard-check">check_circle</span>
        </button>

        <!-- 角色库里的其他卡 -->
        <button
          v-for="c in allowCustom ? extraCards : []"
          :key="c.id"
          type="button"
          class="wt-scard"
          :class="{ picked: playerId === c.id }"
          @click="selectPlayer(c.id)"
        >
          <span
            class="wt-scard-avatar"
            :style="{ background: `color-mix(in srgb, ${c.avatarColor} 24%, transparent)`, color: c.avatarColor }"
          >
            <span class="material-icons-outlined">{{ c.avatarIcon }}</span>
          </span>
          <span class="wt-scard-main">
            <span class="wt-scard-name">
              {{ c.name }}
              <span class="wt-scard-badge wt-badge-lib">角色库</span>
            </span>
            <span class="wt-scard-desc">{{ snippet(c.description || c.personality) }}</span>
          </span>
          <span v-if="playerId === c.id" class="material-icons-outlined wt-scard-check">check_circle</span>
        </button>
      </div>

      <p v-if="loadingLibrary" class="wt-start-loading">
        <span class="wt-dot"></span>正在读取角色库…
      </p>

      <p v-if="!allowCustom" class="wt-start-note">
        <span class="material-icons-outlined">lock</span>
        这个剧本的主角已经写死，只能用上面世界自带的角色卡。
      </p>
      <p v-else-if="visibleCount === 0" class="wt-start-note">
        <span class="material-icons-outlined">info</span>
        还没有可用的角色卡。可以先去「角色库」新建或导入一张。
      </p>
      <p v-else-if="hint" class="wt-start-note">
        <span class="material-icons-outlined">info</span>
        {{ hint }}
      </p>

      <button type="button" class="wt-adv-toggle" @click="showAdvanced = !showAdvanced">
        <span class="material-icons-outlined">{{ showAdvanced ? 'expand_less' : 'expand_more' }}</span>
        高级 · 同行角色（{{ companions.length }} / {{ cast.filter((c) => c.id !== playerId).length }}）
      </button>

      <div v-if="showAdvanced" class="wt-companions">
        <div v-if="!cast.filter((c) => c.id !== playerId).length" class="wt-start-note">
          这个世界没有其他角色可以同行。
        </div>
        <button
          v-for="c in cast.filter((x) => x.id !== playerId)"
          :key="c.id"
          type="button"
          class="wt-chip"
          :class="{ picked: !excluded.has(c.id) }"
          @click="toggleCompanion(c.id)"
        >
          <span class="material-icons-outlined">{{ c.avatarIcon }}</span>
          {{ c.name }}
          <span v-if="!excluded.has(c.id)" class="material-icons-outlined wt-chip-check">check</span>
        </button>
      </div>
    </div>

    <mdui-button slot="action" variant="text" @click="close">取消</mdui-button>
    <mdui-button slot="action" variant="filled" :loading="starting" @click="start">开始</mdui-button>
  </mdui-dialog>
</template>

<style scoped>
.wt-start {
  min-width: min(520px, 82vw);
}

.wt-start-lead {
  margin: 0 0 12px;
  font-size: 0.875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: min(48vh, 420px);
  overflow-y: auto;
  padding: 2px;
  margin: 0 -2px;
}

.wt-scard {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 20px;
  border: 1.5px solid rgba(var(--mdui-color-outline-variant), 0.9);
  background: rgb(var(--mdui-color-surface-container-low));
  font-family: inherit;
  text-align: left;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  transition:
    border-color 0.24s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.24s ease,
    transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wt-scard:hover {
  transform: translateY(-1px);
  background: rgb(var(--mdui-color-surface-container));
}

.wt-scard.picked {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary-container), 0.55);
}

.wt-scard-none {
  grid-column: 1 / -1;
}

.wt-scard-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: grid;
  place-items: center;
}

.wt-scard-avatar .material-icons-outlined {
  font-size: 1.375rem;
}

.wt-avatar-none {
  background: rgba(var(--mdui-color-on-surface), 0.07);
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-scard-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.wt-scard-name {
  font-size: 0.9375rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wt-scard-badge {
  font-size: 0.625rem;
  font-weight: 400;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.16);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-badge-lib {
  background: rgba(var(--mdui-color-secondary), 0.14);
  color: rgb(var(--mdui-color-secondary));
}

.wt-scard-desc {
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgb(var(--mdui-color-on-surface-variant));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wt-scard-check {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 1.125rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-start-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 0;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--mdui-color-primary));
  animation: wt-pulse 1.1s ease-in-out infinite;
}

@keyframes wt-pulse {
  0%, 100% { opacity: 0.25; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

.wt-start-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 12px 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-start-note .material-icons-outlined {
  font-size: 0.9375rem;
  flex-shrink: 0;
  margin-top: 1px;
}

.wt-adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
  padding: 4px 10px 4px 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-primary));
  cursor: pointer;
}

.wt-adv-toggle:hover {
  background: rgba(var(--mdui-color-primary), 0.08);
}

.wt-adv-toggle .material-icons-outlined {
  font-size: 1.125rem;
}

.wt-companions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.wt-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(var(--mdui-color-outline), 0.5);
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.wt-chip .material-icons-outlined {
  font-size: 1rem;
}

.wt-chip.picked {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.1);
}

.wt-chip-check {
  color: rgb(var(--mdui-color-primary));
}

@media (max-width: 560px) {
  .wt-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>