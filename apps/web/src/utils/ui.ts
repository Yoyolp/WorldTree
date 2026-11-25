/** 常用 UI 工具的薄包装 */

import { alert, confirm, prompt, snackbar } from 'mdui';

export function toast(message: string, action?: string): void {
  snackbar({ message, placement: 'bottom', autoCloseDelay: 2600, action });
}

export async function askConfirm(headline: string, description?: string): Promise<boolean> {
  try {
    await confirm({ headline, description, confirmText: '确定', cancelText: '取消', icon: 'help' });
    return true;
  } catch {
    return false;
  }
}

export async function showAlert(headline: string, description?: string): Promise<void> {
  try {
    await alert({ headline, description, confirmText: '知道了' });
  } catch {
    /* 忽略 */
  }
}

export async function askText(headline: string, defaultValue = '', description?: string): Promise<string | null> {
  try {
    return await prompt({
      headline,
      description,
      confirmText: '确定',
      cancelText: '取消',
      textFieldOptions: { value: defaultValue, variant: 'outlined', label: '内容' },
    });
  } catch {
    return null;
  }
}

export function formatTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MODE_LABELS: Record<string, string> = {
  story: '自由叙事',
  script: '剧本驱动',
  coc: '克苏鲁跑团',
};

/** 统一使用 Material Icons 名称（不再用 emoji） */
export const MODE_ICONS: Record<string, string> = {
  story: 'auto_stories',
  script: 'account_tree',
  coc: 'casino',
};

/*
 * 规则包的标签与图标不再在前端硬编码。
 *
 * 规则书是可插拔的（content/rulepacks/ 下的可执行模块可以注册任意 id），
 * 静态的 { coc7: 'COC 7 版' } 映射对新规则包必然失效。
 * 统一由 stores/rulepacks.ts 从 /api/rulepacks 读取 name / icon。
 */

/** 封面可选图标（全部 Material Icons） */
export const COVER_ICONS = [
  'auto_stories',
  'menu_book',
  'local_library',
  'tsunami',
  'train',
  'forest',
  'nightlight',
  'castle',
  'public',
  'science',
  'cruelty_free',
  'local_fire_department',
  'water',
  'storm',
  'dark_mode',
  'diamond',
];

/** 角色卡可选图标 */
export const CHARACTER_ICONS = [
  'person',
  'face',
  'psychology',
  'visibility',
  'badge',
  'newspaper',
  'school',
  'local_police',
  'medical_services',
  'engineering',
  'music_note',
  'brush',
  'gavel',
  'water',
  'local_library',
  'savings',
];

/** 统计一组世界线里，某条线有多少条分叉后代 */
export function countDescendants(sessions: { id: string; parentId?: string | null }[], id: string): number {
  const byParent = new Map<string, string[]>();
  for (const s of sessions) {
    if (!s.parentId) continue;
    const list = byParent.get(s.parentId) ?? [];
    list.push(s.id);
    byParent.set(s.parentId, list);
  }
  let count = 0;
  const stack = [...(byParent.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    count++;
    stack.push(...(byParent.get(cur) ?? []));
  }
  return count;
}

/**
 * mdui 组件（Web Components）只派发 change 事件，不派发 input。
 * Vue 的 v-model 对自定义元素走「原生元素」分支（监听 input），因此
 * <mdui-tabs> / <mdui-select> 上的 v-model 会失效。
 * 统一用 :value + @change="x = evValue($event)" 替代。
 */
export function evValue(e: Event): string {
  const el = e.target as { value?: string } | null;
  return el?.value ?? '';
}

export function evChecked(e: Event): boolean {
  const el = e.target as { checked?: boolean } | null;
  return !!el?.checked;
}

export function evNumber(e: Event): number {
  return Number(evValue(e));
}

/* ------------------------------------------------------------------ */
/* mdui 事件取值                                                       */
/* ------------------------------------------------------------------ */

/** 读取 input 类事件的值（mdui-text-field 会把值放在 target.value） */
export function evValueRaw(e: Event): string {
  const el = e.target as { value?: string } | null;
  return el?.value ?? '';
}

/* ------------------------------------------------------------------ */
/* 能力                                                                */
/* ------------------------------------------------------------------ */

export const ABILITY_KINDS = [
  { value: 'cheat', label: '金手指' },
  { value: 'skill', label: '技能' },
  { value: 'talent', label: '天赋' },
  { value: 'item', label: '物品' },
  { value: 'curse', label: '诅咒' },
] as const;

export const ABILITY_KIND_ICONS: Record<string, string> = {
  cheat: 'auto_awesome',
  skill: 'psychology',
  talent: 'stars',
  item: 'inventory_2',
  curse: 'warning',
};

export const ABILITY_KIND_LABELS: Record<string, string> = {
  cheat: '金手指',
  skill: '技能',
  talent: '天赋',
  item: '物品',
  curse: '诅咒',
};