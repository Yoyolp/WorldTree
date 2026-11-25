<script setup lang="ts">
/**
 * 阅读器页面。
 *
 * 职责已拆薄：本文件只做「组装」——数据加载与把 composables 接到模板。
 *
 * 具体逻辑住在：
 *  - composables/useTurnStream.ts   推演回合（SSE 流式）
 *  - composables/useCombat.ts       战斗
 *  - composables/useRoom.ts         多人房间
 *  - composables/useSessionTree.ts  世界线树
 *  - components/PlaySidePanel.vue   右侧面板
 *  - components/PlayComposer.vue    底部输入区
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CharacterAbility, CheckResult, Message, ScriptChoice, Session, World } from '@worldtree/shared';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import { askConfirm, askText, formatDateTime, toast } from '@/utils/ui';
import { useRulePackStore } from '@/stores/rulepacks';
import MessageBubble from '@/components/MessageBubble.vue';
import PlaySidePanel from '@/components/PlaySidePanel.vue';
import PlayComposer from '@/components/PlayComposer.vue';
import EndingCard from '@/components/EndingCard.vue';
import WtLoader from '@/components/WtLoader.vue';
import { useTurnStream } from '@/composables/useTurnStream';
import { useCombat } from '@/composables/useCombat';
import { useRoom } from '@/composables/useRoom';
import { useSessionTree } from '@/composables/useSessionTree';

const route = useRoute();
const router = useRouter();
const app = useAppStore();

/* ---------------- 基础数据 ---------------- */
const session = ref<Session | null>(null);
const world = ref<World | null>(null);
const messages = ref<Message[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const scroller = ref<HTMLElement | null>(null);
const sideOpen = ref(true);
const panelTab = ref<'sheet' | 'state' | 'lines'>('sheet');
const showRaw = ref(false);
const input = ref('');
const activeAbility = ref('');
const privateTo = ref('');
const playerChar = ref<{
  name: string;
  avatar: string;
  avatarImage?: string | null;
  avatarColor?: string;
  id?: string;
} | null>(null);
const memberId = ref('');

/* ---------------- 组合式逻辑 ---------------- */
const scrollToBottom = async (smooth = true) => {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
};

const roomState = useRoom(memberId);
const roomId = roomState.roomId;
const room = roomState.room;
const myTurn = roomState.myTurn;
const turnName = roomState.turnName;
const isHost = roomState.isHost;
const isKp = roomState.isKp;

const turnStream = useTurnStream({
  session,
  messages,
  roomId,
  memberId,
  activeAbility,
  privateTo,
  scrollToBottom,
});
const busy = turnStream.busy;
const send = turnStream.send;
const stopStreaming = turnStream.stopStreaming;

const combat = useCombat(session, memberId);
const tree = useSessionTree();

/* ---------------- 幕间结算 ---------------- */
const improving = ref(false);
const improveResults = ref<
  { skill: string; before: number; after: number; roll: number; grew: boolean; gained: number; detail: string }[]
>([]);

async function doImprove() {
  const sid = session.value?.id;
  if (!sid || improving.value) return;
  improving.value = true;
  try {
    const res = await api.improve(sid);
    improveResults.value = res.results ?? [];
    if (session.value) session.value.state = res.state;
    if (res.message) toast(res.message);
    else if (!res.results.length) toast('本幕没有可成长的技能');
    else toast(`结算了 ${res.results.length} 项技能`);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    improving.value = false;
  }
}

/* ---------------- 派生状态 ---------------- */
const lastAssistant = computed<Message | null>(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'assistant') return messages.value[i];
  }
  return null;
});

/** 当前可点的选项：仅当最后一条是 assistant 且不在流式中 */
const choices = computed<ScriptChoice[]>(() => {
  if (busy.value) return [];
  return lastAssistant.value?.meta?.choices ?? [];
});

const pendingCheck = computed<CheckResult | null>(() => {
  const last = lastAssistant.value;
  if (!last?.meta?.checks?.length) return null;
  return last.meta.checks[0];
});

/** 模型建议但尚未掷的检定（玩家可确认或忽略） */
const dismissedChecks = ref<Set<string>>(new Set());
const suggestedCheck = computed(() => {
  const last = lastAssistant.value;
  const s = last?.meta?.suggestedCheck;
  if (!s || busy.value) return null;
  if (last?.meta?.checks?.length) return null;
  if (dismissedChecks.value.has(last!.id)) return null;
  return { ...s, messageId: last!.id };
});

function acceptCheck() {
  const s = suggestedCheck.value;
  if (!s) return;
  send('roll', '', undefined, { skill: s.skill, difficulty: s.difficulty ?? 'regular' });
}

function dismissCheck() {
  const s = suggestedCheck.value;
  if (!s) return;
  dismissedChecks.value = new Set([...dismissedChecks.value, s.messageId]);
}

const sheet = computed(() => session.value?.state.sheet ?? null);
const lastRaw = computed(() => lastAssistant.value?.meta?.rawOutput ?? '');
const rulePackStore = useRulePackStore();
const activePackId = computed(() => session.value?.state.rulePackId ?? world.value?.rulePackId ?? 'narrative');
const packName = computed(() => rulePackStore.nameOf(activePackId.value));
const packIcon = computed(() => rulePackStore.iconOf(activePackId.value));
const myAbilities = computed<CharacterAbility[]>(() => roomState.abilitiesOf(session.value));
const blocked = computed(
  () => busy.value || (!!room && !myTurn && !isKp) || endingClosed.value,
);

/* ---------------- 结局 ---------------- */
const endingBusy = ref(false);

/**
 * 结局卡片要显示的信息。
 *
 *  - 还没选过（mode 为空）：显示可点击的两个按钮
 *  - 已经选过：卡片转为只读，避免重复弹
 * 老存档没有 state.ending（或者是 bug 时期留下的 end-off 状态）时，
 * 用消息上的 meta.ending 兜底，保证卡片仍然会出现。
 */
const endingInfo = computed<{ title?: string; chosen: 'closed' | 'epilogue' | null } | null>(() => {
  const st = session.value?.state;
  if (!st) return null;

  const e = st.ending;
  const fromMsg = lastAssistant.value?.meta?.ending;
  const title = e?.title ?? fromMsg?.title;
  if (!e && !fromMsg) return null;

  return { title, chosen: e?.mode ?? null };
});

/** 结局已「收尾」：输入区应禁用 */
const endingClosed = computed(() => session.value?.state?.ending?.mode === 'closed');
/** 处于尾声：输入区可用，但要标明「主线已结束」 */
const endingEpilogue = computed(() => session.value?.state?.ending?.mode === 'epilogue');

async function chooseEnding(mode: 'closed' | 'epilogue') {
  if (!session.value || endingBusy.value) return;
  endingBusy.value = true;
  try {
    const res = await api.chooseEnding(session.value.id, mode);
    session.value.state = res.state;
    if (mode === 'closed') {
      if (res.outro) {
        // 收尾叙事是后端新写的一条消息，重新拉一次列表把它显示出来
        const detail = await api.getSession(session.value.id, memberId.value || undefined);
        messages.value = detail.messages;
        session.value = detail.session;
        await scrollToBottom();
        toast('故事到这里结束了');
      } else {
        toast('没能写出结尾（模型未连接），对话已结束');
      }
    } else {
      toast('已进入尾声，可以继续聊');
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    endingBusy.value = false;
  }
}

/* ---------------- 加载 ---------------- */
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const detail = await api.getSession(String(route.params.sessionId), memberId.value || undefined);
    session.value = detail.session;
    world.value = detail.world;
    messages.value = detail.messages;
    const pc =
      (detail.session.playerCharacterId &&
        detail.characters.find((c) => c.id === detail.session.playerCharacterId)) ||
      detail.characters.find((c) => c.isPlayer);
    playerChar.value = pc
      ? { name: pc.name, avatar: pc.avatarIcon, avatarImage: pc.avatarImage ?? null, avatarColor: pc.avatarColor, id: pc.id }
      : { name: detail.session.playerName, avatar: 'person' };
    if (detail.world) void tree.load(detail.world.id);
    await scrollToBottom(false);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

/* ---------------- 交互 ---------------- */
async function doSend() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await send(isKp ? 'direct' : 'say', text);
}

async function pickChoice(c: ScriptChoice) {
  if (busy.value) return;
  // 模型临场生成的选项可能带 next：点它就等于让剧情推进到那个节点
  const goto = c.next;
  if (c.check?.skill) {
    await send('choice', c.text, c.id, { skill: c.check.skill, difficulty: c.check.difficulty ?? 'regular' }, goto);
  } else {
    await send('choice', c.text, c.id, undefined, goto);
  }
}

async function continueStory() {
  await send('continue');
}

async function rollSkill(skill: string, difficulty: 'regular' | 'hard' | 'extreme') {
  if (!session.value || busy.value) return;
  await send('roll', `检定：${skill}`, undefined, { skill, difficulty });
}

async function forkFrom(m: Message) {
  if (!session.value) return;
  const label = await askText('从这条消息分叉', `分叉 · ${formatDateTime(m.createdAt)}`);
  if (label === null) return;
  try {
    const res = await api.forkSession(session.value.id, m.id, label || undefined);
    toast('已创建新世界线');
    router.push(`/play/${res.session.id}`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function rewindTo(m: Message) {
  if (!session.value) return;
  const ok = await askConfirm('回退到这条消息？', '这条消息之后的内容将被删除。如需保留，请改用「分叉」。');
  if (!ok) return;
  try {
    const res = await api.rewindSession(session.value.id, m.id);
    session.value = res.session;
    messages.value = res.messages;
    toast('已回退');
  } catch (err) {
    toast((err as Error).message);
  }
}

async function renameLine() {
  if (!session.value) return;
  const v = await askText('重命名世界线', session.value.title);
  if (!v) return;
  session.value = await api.updateSession(session.value.id, { title: v });
}

async function copyText(m: Message) {
  try {
    await navigator.clipboard.writeText(m.content);
    toast('已复制');
  } catch {
    toast('复制失败');
  }
}

function openSession(id: string) {
  if (id === session.value?.id) return;
  router.push(`/play/${id}`);
}

watch(() => messages.value.length, () => scrollToBottom());

onMounted(async () => {
  await app.load();
  roomId.value = String(route.query.room ?? '');
  memberId.value = String(route.query.member ?? '');
  await load();
  await roomState.loadRoom();
});

onBeforeUnmount(() => {
  roomState.dispose();
  stopStreaming();
});
</script>

<template>

  <div class="wt-reader">
    <!-- 顶栏 -->
    <header class="wt-reader-bar">
      <mdui-button-icon icon="arrow_back" @click="router.push(world ? `/worlds/${world.id}` : '/')" aria-label="返回" />
      <div class="wt-reader-title">
        <div class="wt-reader-world"><span class="material-icons-outlined wt-title-icon">{{ world?.coverIcon }}</span>{{ world?.title }}</div>
        <button class="wt-reader-line" @click="renameLine">
          {{ session?.title }}
          <span class="material-icons-outlined wt-edit-icon">edit</span>
        </button>
      </div>
      <div class="wt-spacer"></div>
      <span class="wt-pack-chip" :title="`规则包：${packName}`">
        <span class="material-icons-outlined">{{ packIcon }}</span>
        {{ packName }}
      </span>
      <span v-if="session?.state?.scene" class="wt-scene-chip">
        <span class="material-icons-outlined">place</span>
        {{ session.state.scene }}
      </span>
      <mdui-tooltip content="右侧面板">
        <mdui-button-icon :icon="sideOpen ? 'right_panel_close' : 'right_panel_open'" @click="sideOpen = !sideOpen" />
      </mdui-tooltip>
      <mdui-tooltip content="显示元数据">
        <mdui-button-icon
          :icon="app.prefs.showMeta ? 'visibility' : 'visibility_off'"
          @click="app.save({ showMeta: !app.prefs.showMeta })"
        />
      </mdui-tooltip>
    </header>

    <div class="wt-reader-body">
      <!-- 正文区 -->
      <main ref="scroller" class="wt-reader-scroll">
        <div v-if="loading" class="wt-reader-loading">
          <WtLoader size="lg" />
        </div>

        <div v-else-if="error" class="wt-empty">
          <div class="wt-empty-emoji">🌫️</div>
          <div>{{ error }}</div>
          <mdui-button variant="tonal" @click="router.push('/')">返回书库</mdui-button>
        </div>

        <div v-else class="wt-reader-content">
          <div class="wt-reader-intro wt-enter">
            <div class="wt-intro-icon"><span class="material-icons-outlined">{{ world?.coverIcon }}</span></div>
            <h1 class="wt-intro-title">{{ world?.title }}</h1>
            <p class="wt-intro-sub wt-muted">{{ world?.subtitle }}</p>
            <div class="wt-intro-meta wt-small wt-muted">
              {{ session?.branchLabel }} · 第 {{ messages.length }} 段记录
            </div>
          </div>

          <MessageBubble
            v-for="m in messages"
            :key="m.id"
            :message="m"
            :streaming="busy && m.role === 'assistant' && m === lastAssistant && !m.content"
            :player-name="playerChar?.name"
            :player-avatar="playerChar?.avatar"
            :player-avatar-image="playerChar?.avatarImage"
            :player-avatar-color="playerChar?.avatarColor"
            :narrator-icon="packIcon || 'auto_stories'"
            :show-meta="app.prefs.showMeta"
          >
            <template #tools>
              <template v-if="!busy">
                <mdui-tooltip content="从这条分叉">
                  <mdui-button-icon icon="call_split" small @click="forkFrom(m)" />
                </mdui-tooltip>
                <mdui-tooltip content="回退到这里">
                  <mdui-button-icon icon="undo" small @click="rewindTo(m)" />
                </mdui-tooltip>
                <mdui-tooltip content="复制正文">
                  <mdui-button-icon icon="content_copy" small @click="copyText(m)" />
                </mdui-tooltip>
              </template>
            </template>
          </MessageBubble>

          <!-- 掷骰提示 -->
          <div v-if="pendingCheck && !busy" class="wt-check-hint wt-enter">
            <span class="material-icons-outlined">casino</span>
            <div class="wt-check-body">
              <strong>需要进行检定：{{ pendingCheck.skill }}</strong>
              <span class="wt-muted wt-small">难度 {{ pendingCheck.difficulty }} · {{ pendingCheck.detail || '命运正在等你掷下这一骰' }}</span>
            </div>
            <mdui-button variant="tonal" @click="rollSkill(pendingCheck.skill, pendingCheck.difficulty)">
              掷骰
            </mdui-button>
          </div>

          <!-- 检定建议 -->
          <div v-if="suggestedCheck" class="wt-check-bar wt-enter">
            <span class="material-icons-outlined">casino</span>
            <div class="wt-check-bar-main">
              <strong>建议进行一次「{{ suggestedCheck.skill }}」检定</strong>
              <span class="wt-small wt-muted">
                {{ suggestedCheck.difficulty === 'hard' ? '困难难度' : suggestedCheck.difficulty === 'extreme' ? '极难难度' : '常规难度' }}
                · 掷骰结果会直接影响接下来的叙事
              </span>
            </div>
            <mdui-button variant="filled" @click="acceptCheck">掷骰</mdui-button>
            <mdui-button variant="text" @click="dismissCheck">忽略</mdui-button>
          </div>

          <!-- 选项 -->
          <div v-if="!choices.length && !busy && lastAssistant" class="wt-no-choices">
            <span class="material-icons-outlined">edit_note</span>
            <span>这一轮没有解析出选项——直接在下面描述你想怎么做就行。</span>
            <mdui-button
              v-if="lastAssistant.meta?.recovered"
              variant="text"
              @click="showRaw = true"
            >查看原始输出</mdui-button>
          </div>
          <div v-if="choices.length" class="wt-choices wt-enter">
            <button v-for="c in choices" :key="c.id" class="wt-choice" @click="pickChoice(c)">
              <span class="wt-choice-text">{{ c.text }}</span>
              <span class="wt-choice-tail">
                <span v-if="c.check" class="wt-choice-check">
                  <span class="material-icons-outlined">casino</span>
                  {{ c.check.skill }}
                </span>
                <span class="material-icons-outlined wt-choice-arrow">chevron_right</span>
              </span>
            </button>
            <button class="wt-choice wt-choice-ghost" @click="continueStory">
              <span class="wt-choice-text">让故事自己继续</span>
              <span class="material-icons-outlined wt-choice-arrow">east</span>
            </button>
          </div>

          <!-- 结局：收尾 / 尾声 -->
          <EndingCard
            v-if="endingInfo"
            :title="endingInfo.title"
            :busy="endingBusy"
            :chosen="endingInfo.chosen"
            @close="chooseEnding('closed')"
            @epilogue="chooseEnding('epilogue')"
          />

          <div class="wt-reader-bottom"></div>
        </div>
      </main>
      <PlaySidePanel
        v-if="sideOpen"
        v-model:tab="panelTab"
        v-model:show-raw="showRaw"
        :session="session"
        :world="world"
        :player-name="playerChar?.name"
        :sheet="sheet"
        :improving="improving"
        :improve-results="improveResults"
        :last-raw="lastRaw"
        :tree="tree.tree.value"
        :current-session-id="session?.id"
        :combat-busy="combat.combatBusy.value"
        :combat-weapon="combat.combatWeapon.value"
        :combat-defense="combat.combatDefense.value"
        @update:combat-weapon="combat.combatWeapon.value = $event"
        @update:combat-defense="combat.combatDefense.value = $event"
        @improve="doImprove"
        @roll="rollSkill"
        @attack="combat.attack"
        @combat-next="combat.next"
        @combat-end="combat.end"
        @open-session="openSession"
      />
    </div>
    <!-- 多人：回合提示 -->
    <div v-if="room" class="wt-turn-strip" :class="{ 'is-mine': myTurn }">
      <span class="material-icons-outlined">{{ myTurn ? 'play_circle' : 'hourglass_top' }}</span>
      <span class="wt-small">
        {{ myTurn ? '轮到你了' : `正在等「${turnName}」` }}
        · 第 {{ room.round }} 轮
      </span>
      <div class="wt-spacer"></div>
      <mdui-button v-if="isHost" variant="text" icon="skip_next" @click="roomState.passTurn">下一位</mdui-button>
    </div>

    <PlayComposer
      v-model:input="input"
      v-model:private-to="privateTo"
      v-model:active-ability="activeAbility"
      :busy="busy"
      :blocked="blocked"
      :ending-mode="session?.state?.ending?.mode ?? null"
      :is-kp="!!isKp"
      :room="room"
      :abilities="myAbilities"
      @send="doSend"
      @stop="stopStreaming"
      @roll-dice="send('roll', '', undefined, { formula: '1d100' })"
    />
  </div>
</template>
<style scoped>
.wt-reader {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--mdui-color-background));
}
.wt-reader-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-surface-container-low));
  flex-shrink: 0;
}
.wt-reader-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wt-reader-world {
  font-size: 0.6875rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  letter-spacing: 0.04em;
}
.wt-reader-line {
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 42vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wt-edit-icon {
  font-size: 0.8125rem;
  opacity: 0;
  transition: opacity 160ms;
}
.wt-reader-line:hover .wt-edit-icon {
  opacity: 0.5;
}
.wt-pack-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.14);
  color: rgb(var(--mdui-color-tertiary));
  font-size: 0.6875rem;
  white-space: nowrap;
}
.wt-pack-chip .material-icons-outlined {
  font-size: 0.8125rem;
}
.wt-scene-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-primary), 0.1);
  color: rgb(var(--mdui-color-primary));
  font-size: 0.6875rem;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wt-scene-chip .material-icons-outlined {
  font-size: 0.8125rem;
}
.wt-reader-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.wt-reader-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
  scroll-behavior: smooth;
}
.wt-reader-content {
  max-width: calc(var(--wt-reader-width) + 40px);
  margin: 0 auto;
}
.wt-reader-intro {
  text-align: center;
  padding: 48px 16px 26px;
}
.wt-intro-emoji {
  font-size: 2.75rem;
  margin-bottom: 6px;
}
.wt-intro-title {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 4px;
  letter-spacing: 0.04em;
}
.wt-intro-sub {
  margin: 0 0 12px;
}
.wt-intro-meta {
  display: inline-flex;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-surface-container));
}
.wt-reader-loading {
  display: grid;
  place-items: center;
  height: 60vh;
}
.wt-check-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: var(--wt-reader-width);
  margin: 12px auto;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(var(--mdui-color-tertiary), 0.4);
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}
.wt-check-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.wt-choices {
  max-width: var(--wt-reader-width);
  margin: 20px auto 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wt-choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 18px;
  border-radius: 16px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  color: rgb(var(--mdui-color-on-surface));
  font-family: inherit;
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}
.wt-choice:hover {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.06);
  transform: translateX(3px);
}
.wt-choice-text {
  flex: 1;
  line-height: 1.5;
}
.wt-choice-tail {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wt-choice-check {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.14);
  color: rgb(var(--mdui-color-tertiary));
}
.wt-choice-check .material-icons-outlined {
  font-size: 0.75rem;
}
.wt-choice-arrow {
  font-size: 1.125rem;
  opacity: 0.35;
}
.wt-choice-ghost {
  border-style: dashed;
  background: transparent;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.8125rem;
}
.wt-reader-bottom {
  height: 40px;
}
/* 侧栏 */
/* 输入区 */
.wt-check-bar {
  max-width: var(--wt-reader-width);
  margin: 16px auto 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}
.wt-check-bar-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wt-no-choices {
  max-width: var(--wt-reader-width);
  margin: 16px auto 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.8125rem;
}
.wt-turn-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}
.wt-turn-strip.is-mine {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}
@media (max-width: 1080px) {
  .wt-side {
    display: none;
  }
}
@media (max-width: 720px) {
  .wt-reader-bar {
    padding: 6px 8px;
  }
  .wt-pack-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.14);
  color: rgb(var(--mdui-color-tertiary));
  font-size: 0.6875rem;
  white-space: nowrap;
}

.wt-pack-chip .material-icons-outlined {
  font-size: 0.8125rem;
}

.wt-scene-chip {
    display: none;
  }
  .wt-reader-scroll {
    padding: 0 10px;
  }
  .wt-private-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
}

.wt-private-bar mdui-select {
  min-width: 160px;
}

.wt-improve-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wt-improve-row {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 0.8125rem;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-improve-row.grew {
  color: rgb(var(--mdui-color-primary));
  font-weight: 600;
}

.wt-combatant {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  flex-wrap: wrap;
}

.wt-combatant.is-current {
  background: rgb(var(--mdui-color-primary-container));
}

.wt-combatant-name {
  font-size: 0.8125rem;
  min-width: 56px;
}

.wt-hpbar {
  flex: 1;
  min-width: 60px;
  height: 6px;
  border-radius: 3px;
  background: rgb(var(--mdui-color-surface-container-highest));
  overflow: hidden;
}

.wt-hpbar i {
  display: block;
  height: 100%;
  background: rgb(var(--mdui-color-error));
}

.wt-check-bar {
  max-width: var(--wt-reader-width);
  margin: 16px auto 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-check-bar-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-no-choices {
  max-width: var(--wt-reader-width);
  margin: 16px auto 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.8125rem;
}

.wt-raw {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 10px;
  background: rgb(var(--mdui-color-surface-container));
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.wt-turn-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-turn-strip.is-mine {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}

.wt-ability-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}

.wt-ability-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  background: transparent;
  color: rgb(var(--mdui-color-on-surface));
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.wt-ability-chip .material-icons-outlined {
  font-size: 16px;
}

.wt-ability-chip:hover {
  border-color: rgb(var(--mdui-color-primary));
}

.wt-ability-chip.is-active {
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
  border-color: rgb(var(--mdui-color-primary));
}

.wt-ability-chip.is-locked {
  opacity: 0.45;
  cursor: not-allowed;
}

.wt-composer {
    padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
  }
  .wt-composer-inner {
    gap: 6px;
  }
}
</style>


