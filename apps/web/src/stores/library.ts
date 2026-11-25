import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WorldSummary } from '@worldtree/shared';
import { api } from '@/api';

export const useLibraryStore = defineStore('library', () => {
  const worlds = ref<WorldSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.listWorlds();
      worlds.value = res.items;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  return { worlds, loading, error, load };
});
