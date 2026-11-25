import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RulePack } from '@worldtree/shared';
import { api } from '@/api';

/**
 * 规则包元数据缓存。
 *
 * 规则包现在可以由插件以任意 id 注册（不再固定四种），
 * 所以前端不能再用 { coc7: 'COC 7 版' } 这样的静态映射表，
 * 一律从 `/api/rulepacks` 读 name / icon / description。
 */
export const useRulePackStore = defineStore('rulepacks', () => {
  const list = ref<RulePack[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

  async function load(force = false) {
    if (loading.value) return;
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      list.value = await api.listRulePacks();
      loaded.value = true;
    } catch {
      // 拉不到就保持空表，UI 走兜底文案，不阻塞页面
    } finally {
      loading.value = false;
    }
  }

  function byId(id?: string | null): RulePack | undefined {
    if (!id) return undefined;
    return list.value.find((p) => p.id === id);
  }

  function nameOf(id?: string | null): string {
    return byId(id)?.name ?? id ?? '未知规则';
  }

  function iconOf(id?: string | null): string {
    return byId(id)?.icon ?? 'extension';
  }

  /** 某模式下的推荐规则包（用于世界编辑器的模式切换） */
  function defaultForMode(mode: string): string {
    if (mode === 'story') return 'narrative';
    return 'coc7';
  }

  return { list, loaded, loading, load, byId, nameOf, iconOf, defaultForMode };
});
