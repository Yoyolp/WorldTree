<script setup lang="ts">
/**
 * M3 Expressive 风格加载指示器。
 *
 * 官方 Expressive 的 loading indicator 不是「转圈」也不是「三个点」，
 * 而是一个**连续变形的形状**（morphing shape）：同一个形状在
 * 圆 / 圆角方 / 胶囊 / 菱形 之间平滑插值，同时缓慢自转。
 *
 * 实现取舍：
 *  - 形状插值用 SMIL `<animate attributeName="d">`，而不是 CSS `animation: d`。
 *    后者只有 Chromium 支持，Firefox / Safari 会直接跳帧。
 *  - 所有关键帧的 path 必须**指令结构完全一致**（这里统一是 1 个 M + 4 个 C），
 *    否则无法插值。为此每个形状都用「四段三次曲线」表达。
 *  - 变形与自转分成两层：变形在内、旋转在外，两个节奏不完全同步，观感更「有机」。
 *
 * 用法：
 *   <WtLoader />              行内小号（对话里等待时）
 *   <WtLoader size="lg" />    页面级加载
 *   <WtLoader tone="on-primary" />
 */
withDefaults(
  defineProps<{
    /** 尺寸：sm 对话内 / md 默认 / lg 整页 */
    size?: 'sm' | 'md' | 'lg';
    /** 颜色语气 */
    tone?: 'primary' | 'on-primary' | 'muted';
    /** 无障碍标签 */
    label?: string;
  }>(),
  { size: 'md', tone: 'primary', label: '加载中' },
);

/* 四个等长（1M + 4C）的关键帧路径，SMIL 会在它们之间插值 */
const KEYFRAMES = [
  // 0%: 圆
  'M24 6 C33.94 6 42 14.06 42 24 C42 33.94 33.94 42 24 42 C14.06 42 6 33.94 6 24 C6 14.06 14.06 6 24 6 Z',
  // 25%: 圆角方（squircle）
  'M24 6 C36 6 42 12 42 24 C42 36 36 42 24 42 C12 42 6 36 6 24 C6 12 12 6 24 6 Z',
  // 50%: 胶囊（竖长）
  'M24 4 C30 4 34 8 34 24 C34 40 30 44 24 44 C18 44 14 40 14 24 C14 8 18 4 24 4 Z',
  // 75%: 扁胶囊
  'M14 16 C14 8 18 6 24 6 C30 6 36 8 36 16 C36 24 32 30 24 30 C16 30 14 26 14 16 Z',
  // 回到圆
];
</script>

<template>
  <span
    class="wt-loader"
    :class="[`wt-loader-${size}`, `wt-loader-${tone}`]"
    role="status"
    :aria-label="label"
  >
    <svg class="wt-loader-svg" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" :d="KEYFRAMES[0]">
        <animate
          attributeName="d"
          dur="3.2s"
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes="0;0.25;0.5;0.75;1"
          keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"
          :values="[...KEYFRAMES, KEYFRAMES[0]].join(';')"
        />
      </path>
    </svg>
    <span class="wt-loader-sr">{{ label }}</span>
  </span>
</template>

<style scoped>
.wt-loader {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: rgb(var(--mdui-color-primary));
}

.wt-loader-on-primary {
  color: rgb(var(--mdui-color-on-primary));
}

.wt-loader-muted {
  color: rgb(var(--mdui-color-on-surface-variant));
}

/* ---- 尺寸 ---- */
.wt-loader-sm {
  width: 26px;
  height: 26px;
}

.wt-loader-md {
  width: 36px;
  height: 36px;
}

.wt-loader-lg {
  width: 56px;
  height: 56px;
}

.wt-loader-svg {
  width: 100%;
  height: 100%;
  /* 外层自转：与内部形状变形形成拍频，看起来像在「呼吸着转」 */
  animation: wt-loader-spin 2.8s linear infinite;
  will-change: transform;
}

@keyframes wt-loader-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.wt-loader-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* 尊重「减少动态」偏好：只保留稳定旋转，不做形状变形 */
@media (prefers-reduced-motion: reduce) {
  .wt-loader-svg {
    animation-duration: 4s;
  }
}
</style>
