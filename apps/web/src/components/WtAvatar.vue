<script setup lang="ts">
/**
 * 统一头像：有图片就显示图片，没有就回落到 Material 图标 + 底色。
 *
 * 之所以做成一个组件而不是在各处写 v-if：头像出现在角色列表、开局选卡、
 * 消息气泡、面板等至少六处，条件判断散开很容易漏掉某处。
 */
import { computed, ref, watch } from 'vue';
import { assetUrl } from '@/utils/image';

const props = withDefaults(
  defineProps<{
    /** 图片相对路径（assets/xxx.png），优先显示 */
    image?: string | null;
    /** 回落图标（Material Icons 名） */
    icon?: string;
    /** 回落底色 */
    color?: string;
    /** 尺寸：数字按 px，也可以传 '2.4rem' 这类字符串 */
    size?: number | string;
    /** 圆角：'full' 圆形，'round' 圆角方形 */
    shape?: 'full' | 'round';
  }>(),
  { icon: 'person', color: '#4f6f52', size: 40, shape: 'full' },
);

/** 图片加载失败时回落到图标，避免出现裂图 */
const broken = ref(false);
watch(
  () => props.image,
  () => {
    broken.value = false;
  },
);

const src = computed(() => (props.image && !broken.value ? assetUrl(props.image) : ''));

const px = computed(() => {
  if (typeof props.size === 'number') return `${props.size}px`;
  return props.size;
});

/** 图标字号取头像边长的一半左右 */
const iconFont = computed(() => {
  if (typeof props.size === 'number') return `${Math.round(props.size * 0.52)}px`;
  return '0.9em';
});
</script>

<template>
  <span
    class="wt-avatar"
    :class="[`wt-avatar-${shape}`, { 'wt-avatar-img': !!src }]"
    :style="{
      width: px,
      height: px,
      background: src ? 'transparent' : color,
      '--wt-icon-size': iconFont,
    }"
  >
    <img v-if="src" :src="src" alt="" @error="broken = true" />
    <span v-else class="material-icons-outlined">{{ icon }}</span>
  </span>
</template>

<style scoped>
.wt-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  overflow: hidden;
  color: #fff;
  user-select: none;
}
.wt-avatar-full {
  border-radius: 50%;
}
.wt-avatar-round {
  border-radius: 28%;
}
.wt-avatar-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.wt-avatar .material-icons-outlined {
  font-size: var(--wt-icon-size, 20px);
  line-height: 1;
}
</style>
