/**
 * 推演回合（流式）composable。
 *
 * 从 PlayView 里抽出来的核心：负责「乐观插入玩家消息 → 发起 SSE →
 * 逐事件更新界面 → 收尾清理」。抽取动机是这块逻辑最长、最容易出错，
 * 和模板纠缠在一起时改一次要读 150 行。
 *
 * 设计上不直接依赖路由：会话 id / 房间 id 等由调用方经 ref 注入，
 * 返回的 send() 只关心「把这一回合跑完」。
 */
import { ref, type Ref } from 'vue';
import { shortId, type ChatIntent, type Message, type Session } from '@worldtree/shared';
import { streamChat } from '@/api';
import { toast } from '@/utils/ui';

export interface SendOptions {
  skill?: string;
  formula?: string;
  difficulty?: 'regular' | 'hard' | 'extreme';
}

export interface UseTurnStreamDeps {
  session: Ref<Session | null>;
  messages: Ref<Message[]>;
  roomId: Ref<string>;
  memberId: Ref<string>;
  /** 当前选中的能力（发送时带上，成功后清空） */
  activeAbility: Ref<string>;
  /** 只发给某个成员（KP 耳语） */
  privateTo: Ref<string>;
  /** 收到 state 事件时回调（页面据此刷新面板） */
  onState?: (state: Session['state']) => void;
  /** 滚动到底部 */
  scrollToBottom: (smooth?: boolean) => Promise<void> | void;
}

export function useTurnStream(deps: UseTurnStreamDeps) {
  const { session, messages, roomId, memberId, activeAbility, privateTo, scrollToBottom } = deps;

  const busy = ref(false);
  const streamingText = ref('');
  const abortCtrl = ref<AbortController | null>(null);

  /** 统一发送入口 */
  async function send(
    intent: ChatIntent,
    content = '',
    choiceId?: string,
    roll?: SendOptions,
    goto?: string,
  ): Promise<void> {
    if (!session.value || busy.value) return;
    busy.value = true;
    streamingText.value = '';
    const ctrl = new AbortController();
    abortCtrl.value = ctrl;

    const payloadText = content || (intent === 'continue' ? '（继续）' : '');

    // 乐观插入玩家消息，让界面立刻有反馈
    const userMsg: Message = {
      id: shortId('tmp'),
      sessionId: session.value.id,
      role: 'user',
      content: payloadText,
      meta: {},
      createdAt: Date.now(),
    };
    if (intent !== 'continue') messages.value.push(userMsg);
    await scrollToBottom();

    let assistantDraft: Message | null = null;

    try {
      await streamChat(
        {
          sessionId: session.value.id,
          content: payloadText,
          intent,
          choiceId,
          roll,
          roomId: roomId.value || undefined,
          memberId: memberId.value || undefined,
          useAbility: activeAbility.value || undefined,
          goto,
          privateTo: privateTo.value || undefined,
        },
        {
          signal: ctrl.signal,
          onEvent: (ev) => {
            switch (ev.type) {
              case 'start':
                assistantDraft = {
                  id: ev.messageId,
                  sessionId: session.value!.id,
                  role: 'assistant',
                  content: '',
                  meta: {},
                  createdAt: Date.now(),
                };
                messages.value.push(assistantDraft);
                break;
              case 'token':
                streamingText.value += ev.text;
                if (assistantDraft) assistantDraft.content = streamingText.value;
                scrollToBottom(false);
                break;
              case 'rolls':
                if (assistantDraft) assistantDraft.meta = { ...assistantDraft.meta, rolls: ev.rolls };
                break;
              case 'checks':
                if (assistantDraft) assistantDraft.meta = { ...assistantDraft.meta, checks: ev.checks };
                break;
              case 'events':
                if (assistantDraft) assistantDraft.meta = { ...assistantDraft.meta, events: ev.events };
                break;
              case 'choices':
                if (assistantDraft) assistantDraft.meta = { ...assistantDraft.meta, choices: ev.choices };
                break;
              case 'state':
                if (session.value) session.value.state = ev.state;
                deps.onState?.(ev.state);
                break;
              case 'ability':
                if (assistantDraft) assistantDraft.meta = { ...assistantDraft.meta, ability: ev.ability };
                toast(`使用能力：${ev.log}`);
                activeAbility.value = '';
                break;
              case 'notice':
                toast(ev.text);
                break;
              case 'done':
                if (session.value) session.value = ev.session;
                {
                  const idx = messages.value.findIndex((m) => m.id === ev.message.id);
                  if (idx >= 0) messages.value[idx] = ev.message;
                  else if (assistantDraft) Object.assign(assistantDraft, ev.message);
                }
                break;
              case 'error':
                toast(ev.message);
                break;
            }
          },
          onError: (msg) => toast(msg),
        },
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast((err as Error).message);
    } finally {
      // 收尾：草稿已有内容则保留；空草稿（请求失败）移除
      if (assistantDraft) {
        const draft = assistantDraft as Message;
        const idx = messages.value.findIndex((m) => m.id === draft.id);
        if (idx >= 0 && !messages.value[idx].content && !messages.value[idx].meta?.rolls) {
          messages.value.splice(idx, 1);
        }
      }
      busy.value = false;
      streamingText.value = '';
      abortCtrl.value = null;
      await scrollToBottom();
    }
  }

  function stopStreaming() {
    abortCtrl.value?.abort();
    busy.value = false;
  }

  return { busy, streamingText, abortCtrl, send, stopStreaming };
}
