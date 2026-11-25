/**
 * 世界线树 composable。
 *
 * 后端 `/api/worlds/:id/sessions` 已经返回 tree（按 parentId 组织），
 * 这里只负责取数与「把树压平成带缩进的列表」。
 */
import { ref } from 'vue';
import type { Session } from '@worldtree/shared';
import { api } from '@/api';

export interface SessionTreeNode {
  session: Session;
  children: SessionTreeNode[];
}

export function useSessionTree() {
  const tree = ref<SessionTreeNode[]>([]);
  const loading = ref(false);

  async function load(worldId: string): Promise<void> {
    if (!worldId) {
      tree.value = [];
      return;
    }
    loading.value = true;
    try {
      const res = await api.listSessions(worldId);
      tree.value = (res.tree as SessionTreeNode[]) ?? [];
    } catch {
      tree.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** 压平成 [{node, depth}]，供列表渲染 */
  function flat(): { node: SessionTreeNode; depth: number }[] {
    const out: { node: SessionTreeNode; depth: number }[] = [];
    const walk = (nodes: SessionTreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ node: n, depth });
        walk(n.children ?? [], depth + 1);
      }
    };
    walk(tree.value, 0);
    return out;
  }

  return { tree, loading, load, flat };
}
