import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CharacterCard, World, WorldBook } from '@worldtree/shared';
import { api } from '@/api';

/** 编辑器共享数据：世界书与角色列表，供多个页面下拉选择 */
export const useCatalogStore = defineStore('catalog', () => {
  const books = ref<WorldBook[]>([]);
  const charactersList = ref<CharacterCard[]>([]);
  const loaded = ref(false);

  async function load(force = false) {
    if (loaded.value && !force) return;
    const [b, c] = await Promise.allSettled([api.listBooks(), api.listCharacters()]);
    if (b.status === 'fulfilled') books.value = b.value.items;
    if (c.status === 'fulfilled') charactersList.value = c.value.items;
    loaded.value = true;
  }

  function bookName(id?: string | null): string {
    if (!id) return '未绑定';
    return books.value.find((b) => b.id === id)?.name ?? '未知世界书';
  }

  function characterById(id: string): CharacterCard | undefined {
    return charactersList.value.find((c) => c.id === id);
  }

  return { books, charactersList, loaded, load, bookName, characterById };
});

/** 世界详情页的本地状态（不需要全局缓存） */
export interface WorldDetailState {
  world: World;
  characters: CharacterCard[];
  worldBook: WorldBook | null;
  sessions: import('@worldtree/shared').Session[];
}
