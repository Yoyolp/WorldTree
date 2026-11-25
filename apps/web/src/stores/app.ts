import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { setColorScheme, setTheme } from 'mdui';
import { api } from '@/api';
import { resolveSeed } from '@/theme/palette';

export interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  /** 调色板 id，或 'auto'（跟随世界封面色） */
  palette: string;
  color: string;
  fontScale: number;
  readerWidth: number;
  streamEnabled: boolean;
  showMeta: boolean;
  /** Material Icons 变体 */
  iconStyle: 'outlined' | 'filled' | 'round';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  palette: 'auto',
  color: '#4f6f52',
  fontScale: 1,
  readerWidth: 760,
  streamEnabled: true,
  showMeta: false,
  iconStyle: 'outlined',
};

export const useAppStore = defineStore('app', () => {
  const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
  const loaded = ref(false);
  const drawerOpen = ref(false);
  /** 当前世界的封面色（用于 palette=auto） */
  const worldColor = ref<string | null>(null);

  /** 实际生效的源色 */
  const activeSeed = computed(() => resolveSeed(prefs.value.palette, worldColor.value ?? prefs.value.color));

  /** 应用到 DOM */
  function apply() {
    const p = prefs.value;
    try {
      setTheme(p.theme);
      setColorScheme(activeSeed.value);
    } catch {
      /* mdui 未就绪 */
    }
    const root = document.documentElement;
    root.style.setProperty('--wt-font-scale', String(p.fontScale));
    root.style.setProperty('--wt-reader-width', `${p.readerWidth}px`);
    root.dataset.iconStyle = p.iconStyle;
    root.dataset.palette = p.palette;
  }

  async function load() {
    try {
      const raw = (await api.getPrefs()) as Partial<Prefs>;
      prefs.value = { ...DEFAULT_PREFS, ...raw };
    } catch {
      /* 服务不可用时用默认值 */
    } finally {
      loaded.value = true;
      apply();
    }
  }

  async function save(patch: Partial<Prefs>) {
    prefs.value = { ...prefs.value, ...patch };
    apply();
    try {
      await api.savePrefs(patch as unknown as Record<string, unknown>);
    } catch {
      /* 本地已生效 */
    }
  }

  /** 进入某个世界时切换主题源色 */
  function setWorldColor(hex: string | null) {
    worldColor.value = hex;
    apply();
  }

  const isDark = computed(() => {
    if (prefs.value.theme === 'dark') return true;
    if (prefs.value.theme === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  watch(activeSeed, apply);

  return { prefs, loaded, drawerOpen, worldColor, activeSeed, load, save, apply, setWorldColor, isDark };
});
