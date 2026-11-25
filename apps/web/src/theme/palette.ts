/**
 * Material You 配色
 *
 * mdui 内置 `setColorScheme(hex)`，会用 material-color-utilities
 * 从单一源色生成完整调色板（primary / secondary / tertiary / surface 全色阶）。
 *
 * 所以这里的「多套预设」只是若干精选源色；「按世界封面动态生成」
 * 就是把该世界的 coverColor 传给同一个函数。
 */

export interface PalettePreset {
  id: string;
  name: string;
  /** 源色 */
  seed: string;
  description: string;
}

export const PALETTES: PalettePreset[] = [
  { id: 'forest', name: '护林绿', seed: '#4f6f52', description: '沉稳、自然，适合叙事与奇幻' },
  { id: 'harbor', name: '雾港蓝', seed: '#3f5b6b', description: '潮湿的冷调，适合悬疑与克苏鲁' },
  { id: 'violet', name: '暮紫', seed: '#5a4a63', description: '低饱和紫，适合循环与梦境题材' },
  { id: 'coral', name: '珊瑚', seed: '#a4534b', description: '温暖的警示色，适合紧张情节' },
  { id: 'amber', name: '琥珀', seed: '#8a6a33', description: '旧纸与灯光，适合年代与图书馆' },
  { id: 'teal', name: '青碧', seed: '#2f6f6b', description: '清透，适合海洋与治愈' },
  { id: 'indigo', name: '靛青', seed: '#3d4e8a', description: '深夜与星空，适合科幻' },
  { id: 'rose', name: '玫瑰灰', seed: '#8a5560', description: '柔和，适合情感向作品' },
  { id: 'moss', name: '苔藓', seed: '#5c6b3a', description: '湿润的绿，适合荒野与探索' },
  { id: 'plum', name: '梅子', seed: '#6d3f5b', description: '成熟的暗紫，适合权谋与宫廷' },
];

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

export function paletteById(id: string): PalettePreset | undefined {
  return BY_ID.get(id);
}

/** 判断一个字符串是否合法的 6 位十六进制色 */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** 解析 'auto' 时应该用哪个源色 */
export function resolveSeed(paletteId: string, worldColor?: string): string {
  if (paletteId === 'auto') {
    return isHexColor(worldColor ?? '') ? (worldColor as string) : '#4f6f52';
  }
  const p = BY_ID.get(paletteId);
  return p?.seed ?? '#4f6f52';
}
