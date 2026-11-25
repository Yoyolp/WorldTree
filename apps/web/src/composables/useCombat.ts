/**
 * 战斗面板逻辑 composable。
 *
 * 从 PlayView 抽出：开始/攻击/下一回合/结束，以及「我是哪个参战单位」
 * 「现在轮到谁」这类派生状态。都属于同一个关注点，放一起。
 */
import { computed, ref, type Ref } from 'vue';
import type { Session } from '@worldtree/shared';
import { combatApi } from '@/api';
import { toast } from '@/utils/ui';

export function useCombat(session: Ref<Session | null>, memberId: Ref<string>) {
  const combatBusy = ref(false);
  const combatWeapon = ref('拳头');
  const combatDefense = ref<'dodge' | 'fightBack'>('dodge');

  const combat = computed(() => session.value?.state?.combat ?? null);

  /** 当前玩家对应的参战单位 id（多人按 memberId 找，单人用 m_player） */
  const myCombatantId = computed(() => {
    const c = combat.value;
    if (!c) return null;
    const byMember = c.combatants.find((x) => x.memberId && x.memberId === memberId.value);
    if (byMember) return byMember.id;
    return c.combatants.find((x) => x.id === 'm_player')?.id ?? c.combatants[0]?.id ?? null;
  });

  /** 现在轮到谁行动 */
  const currentActor = computed(() => {
    const c = combat.value;
    if (!c) return null;
    const id = c.order[c.turnIndex];
    return c.combatants.find((x) => x.id === id) ?? null;
  });

  async function attack(defenderId: string) {
    const sid = session.value?.id;
    const attackerId = myCombatantId.value;
    if (!sid || !attackerId || combatBusy.value) return;
    combatBusy.value = true;
    try {
      const res = await combatApi.attack(sid, {
        attackerId,
        defenderId,
        weapon: combatWeapon.value,
        defense: combatDefense.value,
      });
      if (session.value) session.value.state = res.state;
      for (const line of res.log ?? []) toast(line);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      combatBusy.value = false;
    }
  }

  async function next() {
    const sid = session.value?.id;
    if (!sid) return;
    try {
      const res = await combatApi.next(sid);
      if (session.value) session.value.state = res.state;
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function end() {
    const sid = session.value?.id;
    if (!sid) return;
    try {
      const res = await combatApi.end(sid);
      if (session.value) session.value.state = res.state;
      toast('战斗结束');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return {
    combatBusy,
    combatWeapon,
    combatDefense,
    combat,
    myCombatantId,
    currentActor,
    attack,
    next,
    end,
  };
}
