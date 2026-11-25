<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, roomsApi, type RoomDetail } from '@/api';
import type { CharacterCard } from '@worldtree/shared';
import { askConfirm, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const route = useRoute();
const router = useRouter();

const roomId = computed(() => String(route.params.id));
const detail = ref<RoomDetail | null>(null);
const loading = ref(true);
const busy = ref(false);
const characters = ref<CharacterCard[]>([]);
const now = ref(Date.now());

const memberId = ref('');
let closeStream: (() => void) | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

const room = computed(() => detail.value?.room ?? null);
const me = computed(() => room.value?.members.find((m) => m.id === memberId.value) ?? null);
const isHost = computed(() => !!me.value && room.value?.hostMemberId === me.value.id);
const turnMember = computed(() => room.value?.members.find((m) => m.id === room.value?.turnMemberId) ?? null);
const myTurn = computed(() => !!me.value && room.value?.turnMemberId === me.value.id);

function saveMember(id: string) {
  memberId.value = id;
  localStorage.setItem(`wt.room.${roomId.value}.member`, id);
}

async function load() {
  try {
    const res = await roomsApi.get(roomId.value);
    detail.value = res;

    // 身份来源：URL > 本地记忆 > 房主
    const fromQuery = String(route.query.member ?? '');
    const stored = localStorage.getItem(`wt.room.${roomId.value}.member`) ?? '';
    const candidate = fromQuery || stored;
    if (candidate && res.room.members.some((m) => m.id === candidate)) {
      saveMember(candidate);
    } else if (res.room.hostMemberId) {
      saveMember(res.room.hostMemberId);
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function applyRoom(next: unknown) {
  if (!detail.value) return;
  detail.value = { ...detail.value, room: next as never };
}

function connect() {
  closeStream?.();
  closeStream = roomsApi.events(
    roomId.value,
    (raw) => {
      const ev = raw as { type: string; room?: unknown };
      if (ev.type === 'room' && ev.room && detail.value) {
        detail.value = { ...detail.value, room: ev.room as never };
      }
    },
    () => {
      /* 断线后由 events() 内部自动重连 */
    },
    memberId.value || undefined,
  );
}

async function start() {
  if (!me.value) return;
  busy.value = true;
  try {
    const next = await roomsApi.start(roomId.value, me.value.id);
    applyRoom(next);
    toast('团开始了');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function nextTurn() {
  if (!me.value) return;
  busy.value = true;
  try {
    applyRoom(await roomsApi.next(roomId.value, me.value.id));
  } catch (err) {
    toast((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function toggleReady() {
  if (!me.value) return;
  applyRoom(await roomsApi.ready(roomId.value, me.value.id, !me.value.ready));
}

async function toggleSkip(targetId: string, skipped: boolean) {
  if (!me.value) return;
  applyRoom(await roomsApi.skip(roomId.value, me.value.id, targetId, skipped));
}

async function bind(characterId: string) {
  if (!me.value) return;
  applyRoom(await roomsApi.bindCharacter(roomId.value, me.value.id, characterId || null));
  toast('角色卡已更新');
}

async function kick(targetId: string) {
  if (!me.value) return;
  if (!(await askConfirm('把这个人移出团？', 'TA 的角色与面板会一起移除。'))) return;
  applyRoom(await roomsApi.leave(roomId.value, targetId));
}

async function leave() {
  if (!me.value) return;
  if (!(await askConfirm('离开这个团？', '你仍然可以凭加入码回来。'))) return;
  await roomsApi.leave(roomId.value, me.value.id);
  router.push('/rooms');
}

function enterReader() {
  if (!room.value || !me.value) return;
  router.push(`/play/${room.value.sessionId}?room=${room.value.id}&member=${me.value.id}`);
}

async function copyCode() {
  if (!room.value) return;
  try {
    await navigator.clipboard.writeText(room.value.code);
    toast('加入码已复制');
  } catch {
    toast(`加入码：${room.value.code}`);
  }
}

function roleLabel(role: string) {
  return role === 'kp' ? 'KP' : role === 'spectator' ? '旁观' : '玩家';
}

onMounted(async () => {
  await load();
  connect();
  try {
    const c = await api.listCharacters();
    characters.value = c.items;
  } catch {
    /* 忽略 */
  }
  ticker = setInterval(() => (now.value = Date.now()), 15000);
});

onBeforeUnmount(() => {
  closeStream?.();
  if (ticker) clearInterval(ticker);
});
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <template v-else-if="detail && room">
        <header class="wt-page-head">
          <mdui-button-icon icon="arrow_back" @click="router.push('/rooms')" />
          <div>
            <h1 class="wt-page-title">{{ detail.world?.title ?? '多人团' }}</h1>
            <p class="wt-muted wt-small">
              {{ room.status === 'lobby' ? '等待开始' : room.status === 'playing' ? '进行中' : '已结束' }}
              · 第 {{ room.round }} 轮 · {{ detail.online }} 人在线
            </p>
          </div>
          <div class="wt-spacer"></div>
          <mdui-button variant="outlined" icon="content_copy" @click="copyCode">{{ room.code }}</mdui-button>
          <mdui-button v-if="room.status === 'playing'" variant="filled" icon="menu_book" @click="enterReader">
            进入阅读器
          </mdui-button>
        </header>

        <section class="wt-panel">
          <div class="wt-row">
            <div>
              <strong>加入码</strong>
              <p class="wt-small wt-muted" style="margin: 2px 0 0">
                同一 Wi-Fi 下的朋友打开这个页面的地址，输入 <b>{{ room.code }}</b> 就能进团。
              </p>
            </div>
            <div class="wt-spacer"></div>
            <mdui-button v-if="room.status === 'lobby'" variant="text" icon="check" @click="toggleReady">
              {{ me?.ready ? '取消准备' : '我准备好了' }}
            </mdui-button>
          </div>
          <div class="wt-code-hint">http://本机局域网IP:5174/rooms</div>
        </section>

        <section v-if="room.status === 'playing'" class="wt-turn-banner" :class="{ 'is-mine': myTurn }">
          <span class="material-icons-outlined">{{ myTurn ? 'play_circle' : 'hourglass_top' }}</span>
          <div>
            <strong>{{ myTurn ? '轮到你了' : `正在等「${turnMember?.name ?? '其他人'}」` }}</strong>
            <p class="wt-small" style="margin: 2px 0 0">
              {{ myTurn ? '点「进入阅读器」写下你的行动。' : '可以在阅读器里看别人的行动，但只有轮到你时才能发言。' }}
            </p>
          </div>
          <div class="wt-spacer"></div>
          <mdui-button variant="outlined" icon="skip_next" @click="nextTurn">下一位</mdui-button>
        </section>

        <section class="wt-panel">
          <h2 class="wt-section-title">成员（{{ room.members.length }}）</h2>

          <article v-for="m in room.members" :key="m.id" class="wt-member-row" :class="{ 'is-turn': room.turnMemberId === m.id }">
            <div class="wt-member-main">
              <span class="wt-chip">{{ roleLabel(m.role) }}</span>
              <strong>{{ m.name }}</strong>
              <span v-if="m.id === memberId" class="wt-you">你</span>
              <span v-if="room.hostMemberId === m.id" class="wt-chip wt-chip-sm">房主</span>
              <span v-if="room.turnMemberId === m.id" class="wt-chip wt-chip-sm wt-chip-turn">当前行动</span>
              <span v-if="m.skipped" class="wt-chip wt-chip-sm wt-chip-skip">已跳过</span>
            </div>

            <div class="wt-member-side">
              <mdui-select
                v-if="m.id === memberId"
                :value="m.characterId ?? ''"
                label="角色卡"
                variant="outlined"
                class="wt-char-select"
                @change="bind(String($event.target && ($event.target as any).value))"
              >
                <mdui-menu-item value="">不绑定</mdui-menu-item>
                <mdui-menu-item v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</mdui-menu-item>
              </mdui-select>
              <span v-else class="wt-small wt-muted">{{ m.characterId || '未绑定角色' }}</span>

              <mdui-button-icon
                v-if="isHost && m.id !== memberId"
                :icon="m.skipped ? 'undo' : 'skip_next'"
                :aria-label="m.skipped ? '取消跳过' : '跳过这一回合'"
                @click="toggleSkip(m.id, !m.skipped)"
              ></mdui-button-icon>
              <mdui-button-icon
                v-if="isHost && m.id !== memberId"
                icon="person_remove"
                aria-label="移出"
                @click="kick(m.id)"
              ></mdui-button-icon>
            </div>
          </article>

          <div class="wt-actions">
            <mdui-button variant="text" icon="logout" @click="leave">离开房间</mdui-button>
            <mdui-button v-if="isHost && room.status === 'lobby'" variant="filled" icon="play_arrow" :loading="busy" @click="start">
              开始
            </mdui-button>
          </div>
        </section>
      </template>

      <div v-else class="wt-empty-inline">找不到这个房间，可能已经被解散了。</div>
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

.wt-panel {
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  border-radius: 18px;
  padding: 20px;
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-section-title {
  font-size: 1rem;
  margin: 0;
}

.wt-code-hint {
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  background: rgb(var(--mdui-color-surface-container));
  padding: 8px 12px;
  border-radius: 10px;
}

.wt-turn-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-radius: 18px;
  margin-bottom: 18px;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-turn-banner.is-mine {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}

.wt-member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  flex-wrap: wrap;
}

.wt-member-row.is-turn {
  border-color: rgb(var(--mdui-color-primary));
  background: rgb(var(--mdui-color-primary-container));
}

.wt-member-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wt-member-side {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.wt-char-select {
  min-width: 160px;
}

.wt-chip {
  font-size: 0.75rem;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-chip-sm {
  font-size: 0.6875rem;
}

.wt-chip-turn {
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
}

.wt-chip-skip {
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}

.wt-you {
  font-size: 0.6875rem;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid rgb(var(--mdui-color-outline));
}

.wt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.wt-empty-inline {
  padding: 40px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  border-radius: 14px;
  text-align: center;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}
</style>
