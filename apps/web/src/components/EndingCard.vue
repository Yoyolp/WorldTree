<script setup lang="ts">
/**
 * 结局卡片。
 *
 * 剧本走到结局节点时出现，让玩家选下一步：
 *  - 「收尾」：让模型写一段结尾，之后对话锁死
 *  - 「尾声」：继续自由对话（后日谈），但不再重复提示结局
 *
 * 为什么要有这张卡：以前结局被当成节点的静态属性，每回合重算，
 * 结果结局存档反复生成、提示每轮弹一次，玩家还能无限往下编——
 * 故事没有「结束」这个状态。
 */
import { computed } from 'vue';

const props = defineProps<{
  title?: string;
  /** 正在生成结尾（模型调用中） */
  busy?: boolean;
  /** 已经选过了，卡片转为只读展示 */
  chosen?: 'closed' | 'epilogue' | null;
}>();

const emit = defineEmits<{
  close: [];
  epilogue: [];
}>();

const isChosen = computed(() => !!props.chosen);
</script>

<template>
  <div class="wt-ending wt-enter" :class="{ 'is-chosen': isChosen }">
    <div class="wt-ending-icon">
      <span class="material-icons-round">{{ isChosen ? (chosen === 'closed' ? 'check_circle' : 'auto_stories') : 'flag' }}</span>
    </div>

    <div class="wt-ending-body">
      <h3 class="wt-ending-title">
        {{ isChosen ? '故事已经结束' : '故事走到了结局' }}
      </h3>
      <p v-if="title" class="wt-ending-name">「{{ title }}」</p>

      <p v-if="!isChosen" class="wt-ending-hint">
        接下来由你决定：给这个故事写一个收尾，或者留在尾声里再待一会儿。
      </p>
      <p v-else-if="chosen === 'closed'" class="wt-ending-hint">
        这条世界线到此为止。你可以回退到结局之前重写，或者开一条新的世界线。
      </p>
      <p v-else class="wt-ending-hint">
        你现在在尾声里。可以继续聊，但故事的主线已经结束。
      </p>

      <div v-if="!isChosen" class="wt-ending-actions">
        <button class="wt-ending-btn wt-ending-btn-primary" :disabled="busy" @click="emit('close')">
          <span v-if="busy" class="wt-ending-spinner"></span>
          <span v-else class="material-icons-round">done_all</span>
          <span>{{ busy ? '正在写结尾…' : '写一段结尾，就此结束' }}</span>
        </button>
        <button class="wt-ending-btn" :disabled="busy" @click="emit('epilogue')">
          <span class="material-icons-round">nightlight</span>
          <span>继续自由对话（尾声）</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wt-ending {
  max-width: var(--wt-reader-width);
  width: 100%;
  margin: 20px auto 8px;
  display: flex;
  gap: 16px;
  padding: 22px 24px;
  border-radius: var(--wt-shape-xl);
  background: rgb(var(--mdui-color-tertiary-container) / 0.55);
  animation: wt-fade-up var(--wt-dur-slow) var(--wt-ease-spring) both;
}

.wt-ending.is-chosen {
  background: rgb(var(--mdui-color-surface-container-high));
  opacity: 0.92;
}

.wt-ending-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--wt-shape-md);
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-ending.is-chosen .wt-ending-icon {
  background: rgb(var(--mdui-color-surface-container-lowest));
  color: rgb(var(--mdui-color-primary));
}

.wt-ending-icon .material-icons-round {
  font-size: 1.5rem;
}

.wt-ending-body {
  flex: 1;
  min-width: 0;
}

.wt-ending-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-ending.is-chosen .wt-ending-title {
  color: rgb(var(--mdui-color-on-surface));
}

.wt-ending-name {
  margin: 4px 0 0;
  font-size: 0.9375rem;
  color: rgb(var(--mdui-color-on-tertiary-container) / 0.85);
}

.wt-ending.is-chosen .wt-ending-name {
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-ending-hint {
  margin: 8px 0 0;
  font-size: 0.8125rem;
  line-height: 1.65;
  color: rgb(var(--mdui-color-on-tertiary-container) / 0.8);
}

.wt-ending.is-chosen .wt-ending-hint {
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-ending-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.wt-ending-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 11px 20px;
  border-radius: var(--wt-shape-full);
  border: 1px solid rgba(var(--mdui-color-outline), 0.4);
  background: transparent;
  font-family: inherit;
  font-size: 0.875rem;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  transition:
    transform var(--wt-dur-fast) var(--wt-ease-spring),
    background var(--wt-dur-fast) var(--wt-ease-emph);
}

.wt-ending-btn:hover:not(:disabled) {
  background: rgba(var(--mdui-color-on-surface), 0.06);
}

.wt-ending-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.wt-ending-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.wt-ending-btn .material-icons-round {
  font-size: 1.0625rem;
}

.wt-ending-btn-primary {
  border-color: transparent;
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
  font-weight: 550;
}

.wt-ending-btn-primary:hover:not(:disabled) {
  background: rgb(var(--mdui-color-primary));
  filter: brightness(1.06);
}

.wt-ending-spinner {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgba(var(--mdui-color-on-primary) / 0.35);
  border-top-color: rgb(var(--mdui-color-on-primary));
  animation: wt-ending-spin 700ms linear infinite;
}

@keyframes wt-ending-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes wt-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 720px) {
  .wt-ending {
    flex-direction: column;
    gap: 12px;
    padding: 18px;
  }
}
</style>
