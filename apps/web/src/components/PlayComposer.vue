<script setup lang="ts">
/**
 * 阅读器底部输入区。
 *
 * 从 PlayView 抽出：文本输入、发送/停止、掷骰按钮、能力选择条、
 * KP 私密发送条。它只负责「收集玩家想做什么」，然后 emit 出去，
 * 不直接发请求 —— 这样推演逻辑与输入 UI 互不牵扯。
 */
import { computed } from 'vue';
import type { CharacterAbility, PartyMember } from '@worldtree/shared';
import { evValue } from '@/utils/ui';

const props = defineProps<{
  input: string;
  busy: boolean;
  blocked: boolean;
  isKp: boolean;
  room: { members: PartyMember[] } | null;
  privateTo: string;
  abilities: CharacterAbility[];
  activeAbility: string;
  /** 结局状态：closed=已收尾（禁用输入），epilogue=尾声（可聊，但标明主线已结束） */
  endingMode?: 'closed' | 'epilogue' | null;
}>();

const emit = defineEmits<{
  'update:input': [value: string];
  'update:privateTo': [value: string];
  'update:activeAbility': [value: string];
  send: [];
  stop: [];
  rollDice: [];
}>();

const abilityIcons: Record<string, string> = {
  cheat: 'auto_awesome',
  skill: 'psychology',
  talent: 'stars',
  item: 'inventory_2',
  curse: 'warning',
};

const placeholder = computed(() => {
  if (props.endingMode === 'closed') return '故事已经结束。可以回退到结局之前，或开一条新的世界线。';
  if (props.endingMode === 'epilogue') return '尾声 · 继续聊聊之后发生了什么…';
  return props.isKp
    ? '以 KP 身份描述场景、扮演 NPC…这条不占玩家回合'
    : '描述你的行动，或直接说点什么…（Enter 发送，Shift+Enter 换行）';
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    emit('send');
  }
}

function toggleAbility(id: string) {
  emit('update:activeAbility', props.activeAbility === id ? '' : id);
}
</script>

<template>
  <footer class="wt-composer">
    <!-- 结局状态提示：尾声 / 已结束 -->
    <div v-if="endingMode" class="wt-ending-bar" :class="`is-${endingMode}`">
      <span class="material-icons-round">{{ endingMode === 'closed' ? 'check_circle' : 'auto_stories' }}</span>
      <span class="wt-small">
        {{ endingMode === 'closed'
          ? '这条世界线已经结束。想继续，请回退到结局之前，或开一条新的世界线。'
          : '尾声 · 故事的主线已经结束，你可以继续聊聊之后发生了什么。' }}
      </span>
    </div>

    <!-- KP 私密发送 -->
    <div v-if="isKp && room" class="wt-private-bar">
      <span class="wt-label">私密</span>
      <mdui-select
        :value="privateTo"
        label="只发给"
        variant="outlined"
        @change="emit('update:privateTo', evValue($event))"
      >
        <mdui-menu-item value="">所有人可见</mdui-menu-item>
        <mdui-menu-item v-for="m in room.members" :key="m.id" :value="m.id">{{ m.name }}</mdui-menu-item>
      </mdui-select>
      <span class="wt-small wt-muted">选中后，这条只有对方能看到</span>
    </div>

    <!-- 能力 -->
    <div v-if="abilities.length" class="wt-ability-bar">
      <span class="wt-label">能力</span>
      <button
        v-for="a in abilities"
        :key="a.id"
        class="wt-ability-chip"
        :class="{ 'is-active': activeAbility === a.id, 'is-locked': !a.unlocked }"
        :disabled="!a.unlocked"
        @click="toggleAbility(a.id)"
      >
        <span class="material-icons-outlined">{{ abilityIcons[a.kind] ?? 'auto_awesome' }}</span>
        {{ a.name }}
      </button>
      <span v-if="activeAbility" class="wt-small wt-muted">本回合将使用选中的能力</span>
    </div>

    <div class="wt-composer-inner">
      <mdui-text-field
        :value="input"
        variant="outlined"
        :placeholder="placeholder"
        rows="1"
        autosize
        :max-rows="5"
        :disabled="blocked"
        @input="emit('update:input', ($event.target as HTMLInputElement).value)"
        @keydown="onKeydown"
      ></mdui-text-field>
      <div class="wt-composer-actions">
        <mdui-tooltip content="掷 1d100">
          <mdui-button-icon icon="casino" :disabled="blocked" @click="emit('rollDice')" />
        </mdui-tooltip>
        <mdui-button v-if="!busy" variant="filled" icon="send" :disabled="!input.trim() || blocked" @click="emit('send')">
          发送
        </mdui-button>
        <mdui-button v-else variant="tonal" icon="stop" @click="emit('stop')">停止</mdui-button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.wt-composer {
  flex-shrink: 0;
  padding: 10px 20px calc(14px + env(safe-area-inset-bottom));
  background: rgb(var(--mdui-color-surface-container-low));
  border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.28);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-composer-inner {
  max-width: var(--wt-reader-width);
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.wt-composer-inner mdui-text-field {
  flex: 1;
  min-width: 0;
}

.wt-composer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding-bottom: 2px;
}

.wt-ability-bar {
  max-width: var(--wt-reader-width);
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wt-ability-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: var(--wt-shape-full);
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.7);
  background: transparent;
  font-family: inherit;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  cursor: pointer;
  transition: all var(--wt-dur-fast) var(--wt-ease-emph);
}

.wt-ability-chip .material-icons-outlined {
  font-size: 0.95rem;
}

.wt-ability-chip.is-active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}

.wt-ability-chip.is-locked {
  opacity: 0.45;
  cursor: not-allowed;
}

.wt-private-bar {
  max-width: var(--wt-reader-width);
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* 结局状态条：尾声 / 已结束 */
.wt-ending-bar {
  max-width: var(--wt-reader-width);
  width: 100%;
  margin: 0 auto 2px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px;
  border-radius: var(--wt-shape-md);
}

.wt-ending-bar.is-epilogue {
  background: rgb(var(--mdui-color-tertiary-container) / 0.6);
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-ending-bar.is-closed {
  background: rgb(var(--mdui-color-surface-container-high));
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-ending-bar .material-icons-round {
  font-size: 1.05rem;
  flex-shrink: 0;
}

.wt-private-bar mdui-select {
  min-width: 140px;
}

.wt-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-small {
  font-size: 0.8125rem;
}

.wt-muted {
  color: rgb(var(--mdui-color-on-surface-variant));
}
</style>
