/**
 * 多人房间 composable。
 *
 * 从 PlayView 抽出：房间状态、我是否轮到我、SSE 订阅与清理、
 * 以及「跳过/让位」这类房主操作。
 */
import { computed, ref, type Ref } from 'vue';
import type { CharacterAbility, Room, Session } from '@worldtree/shared';
import { roomsApi } from '@/api';
import { toast } from '@/utils/ui';

export function useRoom(memberId: Ref<string>) {
  const roomId = ref('');
  const room = ref<Room | null>(null);
  let closeStream: (() => void) | null = null;

  /** 是否轮到我在这一轮说话 */
  const myTurn = computed(() => {
    if (!room.value) return true;
    if (!room.value.turnBased) return true;
    return room.value.turnMemberId === memberId.value;
  });

  const turnName = computed(() => {
    if (!room.value) return '';
    const m = room.value.members.find((x) => x.id === room.value?.turnMemberId);
    return m?.name ?? '其他人';
  });

  const isHost = computed(() => !!room.value && room.value.hostMemberId === memberId.value);

  /** 我是真人 KP 吗（KP 的输入是导演指令，不占玩家回合） */
  const isKp = computed(
    () =>
      room.value?.kpMode === 'human' &&
      room.value?.members.find((m) => m.id === memberId.value)?.role === 'kp',
  );

  /** 我这一手能用的能力：优先用房间里绑定的角色卡，其次用继承来的 */
  function abilitiesOf(session: Session | { state?: unknown } | null): CharacterAbility[] {
    const m = room.value?.members.find((x) => x.id === memberId.value);
    if (m?.abilities?.length) return m.abilities;
    const legacy = (session as Session | null)?.state?.legacy?.abilities;
    return legacy ?? [];
  }

  /** 载入房间并订阅实时事件 */
  async function loadRoom(id?: string): Promise<void> {
    if (id !== undefined) roomId.value = id;
    if (!roomId.value) return;
    try {
      const res = await roomsApi.get(roomId.value);
      room.value = res.room;
      // 没有显式指定成员时，尝试从本地缓存恢复（刷新页面后仍认得出自己）
      if (!memberId.value) {
        const stored = localStorage.getItem(`wt.room.${roomId.value}.member`);
        if (stored && res.room.members.some((m) => m.id === stored)) memberId.value = stored;
      }
      closeStream?.();
      closeStream = roomsApi.events(
        roomId.value,
        (raw) => {
          const ev = raw as { type: string; room?: Room };
          if (ev.type === 'room' && ev.room) room.value = ev.room;
        },
        undefined,
        memberId.value || undefined,
      );
    } catch {
      /* 非多人模式，静默忽略 */
    }
  }

  async function passTurn(): Promise<void> {
    if (!room.value || !isHost.value) return;
    try {
      room.value = await roomsApi.next(room.value.id, memberId.value);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function dispose(): void {
    closeStream?.();
    closeStream = null;
  }

  return {
    roomId,
    room,
    myTurn,
    turnName,
    isHost,
    isKp,
    abilitiesOf,
    loadRoom,
    passTurn,
    dispose,
  };
}
