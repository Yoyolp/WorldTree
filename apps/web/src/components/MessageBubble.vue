<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Message } from '@worldtree/shared';
import { assetUrl } from '@/utils/image';
import WtAvatar from './WtAvatar.vue';
import WtLoader from './WtLoader.vue';

const props = defineProps<{
  message: Message;
  streaming?: boolean;
  playerName?: string;
  playerAvatar?: string;
  /** 玩家头像图片（assets/xxx.png），有值时优先于 playerAvatar 图标 */
  playerAvatarImage?: string | null;
  /** 玩家头像底色 */
  playerAvatarColor?: string;
  /** 叙述者（AI）头像图片；不传则用默认图标 */
  narratorAvatar?: string | null;
  /** 叙述者图标与底色 */
  narratorIcon?: string;
  narratorColor?: string;
  showMeta?: boolean;
}>();

const isUser = computed(() => props.message.role === 'user');

/** 把文本按段落切分，保留换行结构 */
const paragraphs = computed(() =>
  (props.message.content || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean),
);

const rollSummary = computed(() => {
  const checks = props.message.meta?.checks;
  if (checks?.length) {
    const c = checks[0];
    return {
      label: c.skill,
      total: c.roll,
      detail: c.detail,
      success: c.success,
      level: c.label,
      formula: '1d100',
      target: c.target,
      candidates: c.candidates,
      pushed: c.pushed,
      luckSpent: c.luckSpent,
    };
  }
  const rolls = props.message.meta?.rolls;
  if (!rolls?.length) return null;
  const r = rolls[0];
  return {
    label: r.label,
    total: r.total,
    detail: r.detail,
    success: undefined as boolean | undefined,
    level: undefined as string | undefined,
    formula: r.formula,
    target: undefined as number | undefined,
    candidates: undefined as number[] | undefined,
    pushed: false,
    luckSpent: undefined as number | undefined,
  };
});

const events = computed(() => props.message.meta?.events ?? []);

/** 命中的世界书条目里，带配图的那几条 */
const loreImages = computed(() =>
  (props.message.meta?.loreHitDetails ?? []).filter((d) => !!d.image),
);

/** 点击缩略图放大（灯箱） */
const preview = ref<{ name: string; image?: string; caption?: string } | null>(null);

const timeText = computed(() =>
  new Date(props.message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
);
</script>

<template>
  <div class="wt-msg" :class="{ 'wt-msg-user': isUser, 'wt-enter': !streaming }">
    <!-- 玩家这一侧留头像；叙述者（AI）也用头像，让对话有「说话的人」 -->
    <WtAvatar
      v-if="isUser"
      class="wt-msg-avatar"
      :image="playerAvatarImage"
      :icon="playerAvatar || 'person'"
      :color="playerAvatarColor || '#4f6f52'"
      :size="34"
    />
    <WtAvatar
      v-else
      class="wt-msg-avatar wt-msg-avatar-narrator"
      :image="narratorAvatar"
      :icon="narratorIcon || 'auto_stories'"
      :color="narratorColor || '#3f5b6b'"
      :size="34"
    />
    <div class="wt-msg-main">
      <div class="wt-msg-head" v-if="isUser">
        <span class="wt-msg-name">{{ playerName || '你' }}</span>
        <span class="wt-msg-time">{{ timeText }}</span>
      </div>

      <!-- 理智检定 -->
      <div v-if="message.meta?.sanCheck" class="wt-roll wt-roll-san">
        <span class="material-icons-outlined wt-roll-icon">psychology_alt</span>
        <div class="wt-roll-body">
          <div class="wt-roll-title">
            <strong>理智检定</strong>
            <span class="wt-roll-formula">{{ message.meta.sanCheck.expression }}</span>
            <span class="wt-roll-result" :class="message.meta.sanCheck.permanentInsane ? 'bad' : 'warn'">
              失去 {{ message.meta.sanCheck.loss }} 点 · 剩余 {{ message.meta.sanCheck.sanAfter }}
            </span>
          </div>
          <div class="wt-roll-detail wt-muted wt-small">{{ message.meta.sanCheck.detail }}</div>
          <div v-if="message.meta.sanCheck.bout" class="wt-roll-detail wt-small" style="color: rgb(var(--mdui-color-error))">
            疯狂发作：{{ message.meta.sanCheck.bout }}
          </div>
          <div v-if="message.meta.sanCheck.permanentInsane" class="wt-roll-detail wt-small" style="color: rgb(var(--mdui-color-error))">
            永久疯狂
          </div>
        </div>
      </div>

      <!-- 检定卡片 -->
      <div v-if="rollSummary" class="wt-roll">
        <span class="material-icons-outlined wt-roll-icon">casino</span>
        <div class="wt-roll-body">
          <div class="wt-roll-title">
            <strong>{{ rollSummary.label }}</strong>
            <span class="wt-roll-formula">{{ rollSummary.formula }}</span>
            <span v-if="rollSummary.target" class="wt-roll-formula">目标 {{ rollSummary.target }}</span>
            <span
              v-if="rollSummary.success !== undefined"
              class="wt-roll-result"
              :class="rollSummary.success ? 'ok' : 'bad'"
            >
              {{ rollSummary.level ?? (rollSummary.success ? '成功' : '失败') }}
            </span>
            <span v-if="rollSummary.pushed" class="wt-roll-tag">孤注一掷</span>
            <span v-if="rollSummary.luckSpent" class="wt-roll-tag">消耗幸运 {{ rollSummary.luckSpent }}</span>
          </div>
          <div class="wt-roll-detail wt-muted wt-small">
            {{ rollSummary.detail }}
          </div>
        </div>
      </div>

      <!-- 事件卡片 -->
      <div v-if="events.length" class="wt-events">
        <div v-for="ev in events" :key="ev.eventId" class="wt-event">
          <span class="material-icons-outlined">bolt</span>
          <span class="wt-event-name">{{ ev.name }}</span>
          <span v-if="ev.chance < 1" class="wt-event-odds">{{ Math.round(ev.chance * 100) }}%</span>
        </div>
      </div>

      <div class="wt-msg-body" :class="{ 'wt-prose': !isUser }">
        <p v-for="(p, i) in paragraphs" :key="i" class="wt-para">{{ p }}</p>
        <!-- 等待模型开口时用 M3E 变形加载指示器，替掉原来的三点跳动 -->
        <div v-if="streaming" class="wt-typing">
          <WtLoader size="sm" />
        </div>
      </div>

      <div v-if="showMeta && message.meta?.loreHits?.length" class="wt-lore-hit wt-small wt-muted">
        <span class="material-icons-round">auto_awesome</span>
        世界书：{{ message.meta.loreHits.join('、') }}
      </div>

      <!--
        命中的世界书条目配图。
        只在「作者给了图」时出现，且默认折叠成缩略图，不打断阅读。
      -->
      <div v-if="loreImages.length" class="wt-lore-images">
        <figure v-for="(img, i) in loreImages" :key="i" class="wt-lore-figure">
          <img :src="assetUrl(img.image)" :alt="img.name" loading="lazy" @click="preview = img" />
          <figcaption v-if="img.caption" class="wt-small wt-muted">{{ img.caption }}</figcaption>
        </figure>
      </div>

      <div v-if="message.meta?.error" class="wt-msg-error wt-small">
        <span class="material-icons-round">cloud_off</span>
        {{ message.meta.error }}
      </div>

      <div class="wt-msg-tools">
        <slot name="tools" />
      </div>
    </div>

    <!-- 配图灯箱：点一下缩略图看大图 -->
    <div v-if="preview" class="wt-lore-lightbox" @click="preview = null">
      <img :src="assetUrl(preview.image)" :alt="preview.name" />
      <div v-if="preview.caption" class="wt-lore-lightbox-cap">{{ preview.caption }}</div>
    </div>
  </div>
</template>

<style scoped>
.wt-msg {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  max-width: var(--wt-reader-width);
  margin: 0 auto;
  width: 100%;
}

.wt-msg-user {
  justify-content: flex-end;
  flex-direction: row;
}

.wt-msg-avatar {
  flex-shrink: 0;
  margin-top: 2px;
}

/* 叙述者头像同样参与布局，只是排在气泡左侧 */
.wt-msg-avatar-narrator {
  align-self: flex-start;
}

.wt-msg-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-msg-user .wt-msg-main {
  flex: 0 1 auto;
  max-width: 82%;
  align-items: flex-end;
}

.wt-msg-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-msg-name {
  font-weight: 500;
}

.wt-msg-body {
  font-size: 0.9375rem;
  line-height: 1.85;
  color: rgb(var(--mdui-color-on-surface));
}

.wt-msg-user .wt-msg-body {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
  padding: 12px 16px;
  border-radius: 18px 18px 4px 18px;
  white-space: pre-wrap;
}

.wt-para {
  margin: 0 0 0.85em;
}

.wt-para:last-child {
  margin-bottom: 0;
}

.wt-typing {
  display: inline-flex;
  align-items: center;
  padding: 4px 0 2px;
  opacity: 0.9;
}

.wt-msg-tools {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 160ms ease;
}

.wt-msg:hover .wt-msg-tools {
  opacity: 1;
}

.wt-roll-san {
  border-left: 3px solid rgb(var(--mdui-color-tertiary));
}

.wt-roll-result.warn {
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-roll {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
  align-self: flex-start;
}

.wt-roll-icon {
  font-size: 1.25rem;
  opacity: 0.8;
}

.wt-roll-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-roll-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
}

.wt-roll-formula {
  font-family: Consolas, monospace;
  opacity: 0.7;
  font-size: 0.75rem;
}

.wt-roll-result {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
}

.wt-roll-result.ok {
  background: rgba(76, 175, 80, 0.28);
}

.wt-roll-result.bad {
  background: rgba(244, 67, 54, 0.28);
}

.wt-lore-hit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
}

.wt-lore-hit .material-icons-round {
  font-size: 0.875rem;
}

.wt-msg-error {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgb(var(--mdui-color-error));
}

.wt-msg-error .material-icons-round {
  font-size: 0.875rem;
}
.wt-roll-tag {
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.12);
}

.wt-events {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-self: flex-start;
  margin-bottom: 4px;
}

.wt-event {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-tertiary), 0.14);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-event .material-icons-outlined {
  font-size: 0.8125rem;
}

.wt-event-odds {
  opacity: 0.7;
  font-weight: 600;
}

/* ---- 世界书配图 ---- */
.wt-lore-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.wt-lore-figure {
  margin: 0;
  max-width: 160px;
}

.wt-lore-figure img {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: 12px;
  cursor: zoom-in;
  display: block;
  background: rgb(var(--mdui-color-surface-container-high));
}

.wt-lore-figure figcaption {
  margin-top: 3px;
  line-height: 1.4;
}

.wt-lore-lightbox {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgb(0 0 0 / 78%);
  display: grid;
  place-items: center;
  padding: 24px;
  cursor: zoom-out;
}

.wt-lore-lightbox img {
  max-width: min(92vw, 1100px);
  max-height: 86vh;
  border-radius: 14px;
  box-shadow: 0 12px 48px rgb(0 0 0 / 45%);
}

.wt-lore-lightbox-cap {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 0.85rem;
  max-width: 80vw;
  text-align: center;
}</style>
