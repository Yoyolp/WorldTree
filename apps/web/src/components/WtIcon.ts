/**
 * 图标组件：统一使用 Material Icons（字体图标）
 *
 * 通过 <span class="material-icons-outlined|round">name</span> 渲染，
 * 变体由 app store 的 iconStyle 决定（root[data-icon-style]）。
 */

import { computed, defineComponent, h, type PropType } from 'vue';

const ICON_CLASS: Record<string, string> = {
  outlined: 'material-icons-outlined',
  filled: 'material-icons',
  round: 'material-icons-round',
};

export default defineComponent({
  name: 'WtIcon',
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 20 },
    /** 覆盖全局变体 */
    variant: { type: String as PropType<'outlined' | 'filled' | 'round'>, default: undefined },
  },
  setup(props) {
    const cls = computed(() => {
      if (props.variant) return ICON_CLASS[props.variant] ?? ICON_CLASS.outlined;
      const rootStyle = document.documentElement.dataset.iconStyle ?? 'outlined';
      return ICON_CLASS[rootStyle] ?? ICON_CLASS.outlined;
    });

    return () =>
      h('span', {
        class: [cls.value, 'wt-icon'],
        style: {
          fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size,
        },
        'aria-hidden': 'true',
      }, props.name);
  },
});
