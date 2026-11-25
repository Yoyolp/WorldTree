<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CharacterCard, ScriptNode, Session, StoryScript, World } from '@worldtree/shared';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import {
  MODE_ICONS,
  MODE_LABELS,
  askConfirm,
  askText,
  formatTime,
  toast,
  evValue,
} from '@/utils/ui';
import { useRulePackStore } from '@/stores/rulepacks';
import StartSessionDialog from '@/components/StartSessionDialog.vue';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const rulePackStore = useRulePackStore();

const world = ref<World | null>(null);
const cast = ref<CharacterCard[]>([]);
const sessions = ref<Session[]>([]);
const script = ref<StoryScript | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const showStart = ref(false);
const starting = ref(false);
const tab = ref('about');
const bookName = ref('未绑定');

const sortedSessions = computed(() => [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt));
const roots = computed(() => sortedSessions.value.filter((s) => !s.parentId));
const childrenOf = (id: string) => sortedSessions.value.filter((s) => s.parentId === id);
const npcCount = computed(() => cast.value.filter((c) => !c.isPlayer).length);

const scriptStats = computed(() => {
  if (!script.value) return null;
  return {
    nodes: script.value.nodes.length,
    events:
      script.value.events.length + script.value.nodes.reduce((a, n) => a + n.events.length, 0),
    endNodes: script.value.nodes.filter((n) => n.ending).length,
  };
});

/** 进入世界时切换主题源色（palette=auto 时生效） */
watch(world, (w) => {
  if (w) appStore.setWorldColor(w.coverColor);
});

async function load() {
  loading.value = true;
  void rulePackStore.load();
  error.value = null;
  try {
    const detail = await api.getWorld(String(route.params.id));
    world.value = detail.world;
    cast.value = detail.characters;
    sessions.value = detail.sessions;
    script.value = detail.script;
    bookName.value = detail.worldBook?.name ?? '未绑定';
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function doStart(payload: { playerCharacterId: string | null; characterIds: string[] }) {
  if (!world.value) return;
  starting.value = true;
  try {
    const res = await api.createSession(world.value.id, {
      characterIds: payload.characterIds,
      playerCharacterId: payload.playerCharacterId,
    });
    showStart.value = false;
    router.push(`/play/${res.session.id}`);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    starting.value = false;
  }
}

async function renameSession(s: Session) {
  const v = await askText('重命名世界线', s.title);
  if (!v) return;
  await api.updateSession(s.id, { title: v });
  await load();
}

async function archiveSession(s: Session) {
  await api.updateSession(s.id, { archived: !s.archived });
  await load();
  toast(s.archived ? '已取消归档' : '已归档');
}

async function removeSession(s: Session) {
  const kids = childrenOf(s.id).length;
  const desc = kids
    ? `「${s.title}」及其 ${kids} 条分叉世界线都会被删除，无法恢复。`
    : `「${s.title}」的 ${s.messageCount} 条记录会被删除，无法恢复。`;
  if (!(await askConfirm('删除这条世界线？', desc))) return;
  try {
    const res = await api.deleteSession(s.id);
    await load();
    toast((res.deleted ?? 1) > 1 ? `已删除 ${res.deleted ?? 1} 条世界线` : '已删除');
  } catch (err) {
    toast((err as Error).message);
  }
}

async function removeWorld() {
  if (!world.value) return;
  const ok = await askConfirm('删除这个世界？', '所有角色、世界线与设定都会被删除。');
  if (!ok) return;
  await api.deleteWorld(world.value.id);
  router.push('/');
}

function nodeName(id?: string): string {
  if (!id) return '';
  return script.value?.nodes.find((n) => n.id === id)?.title ?? id;
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div v-if="loading" class="wt-container">
      <div class="wt-skeleton-lg"></div>
    </div>

    <div v-else-if="error" class="wt-empty">
      <div class="material-icons-outlined wt-empty-emoji">cloud_off</div>
      <div>{{ error }}</div>
      <mdui-button variant="tonal" @click="router.push('/')">返回书库</mdui-button>
    </div>

    <div v-else-if="world" class="wt-container">
      <section class="wt-banner wt-enter" :style="{ '--cover': world.coverColor }">
        <div class="wt-banner-bg"></div>
        <div class="wt-banner-content">
          <div class="wt-banner-icon">
            <span class="material-icons-outlined">{{ world.coverIcon }}</span>
          </div>
          <div class="wt-banner-info">
            <div class="wt-row wt-gap-8">
              <span class="wt-mode-pill">
                <span class="material-icons-outlined">{{ MODE_ICONS[world.mode] }}</span>
                {{ MODE_LABELS[world.mode] }}
              </span>
              <span class="wt-rule-pill">
                <span class="material-icons-outlined">{{ rulePackStore.iconOf(world.rulePackId) }}</span>
                {{ rulePackStore.nameOf(world.rulePackId) }}
              </span>
              <span class="wt-muted wt-small">{{ world.author }}</span>
            </div>
            <h1 class="wt-banner-title">{{ world.title }}</h1>
            <p class="wt-banner-sub">{{ world.subtitle }}</p>
            <div class="wt-chip-row">
              <span v-for="t in world.tags" :key="t" class="wt-tag">{{ t }}</span>
            </div>
          </div>
          <div class="wt-banner-actions">
            <mdui-button variant="filled" icon="play_arrow" @click="showStart = true">开始新世界线</mdui-button>
            <mdui-button variant="outlined" icon="edit" @click="router.push(`/worlds/${world.id}/edit`)">
              编辑设定
            </mdui-button>
            <mdui-button-icon icon="delete" @click="removeWorld" aria-label="删除" />
          </div>
        </div>
      </section>

      <div class="wt-detail-grid">
        <div class="wt-detail-main">
          <mdui-tabs :value="tab" variant="secondary" class="wt-tabs" @change="tab = evValue($event)">
            <mdui-tab value="about">设定</mdui-tab>
            <mdui-tab value="cast">角色（{{ cast.length }}）</mdui-tab>
            <mdui-tab v-if="script" value="script">剧本</mdui-tab>
            <mdui-tab value="lines">世界线（{{ sessions.length }}）</mdui-tab>
          </mdui-tabs>

          <div v-if="tab === 'about'" class="wt-tab-body">
            <section class="wt-card">
              <div class="wt-label">开场</div>
              <p class="wt-prose wt-opening">{{ world.opening || '（未填写开场）' }}</p>
            </section>
            <section class="wt-card">
              <div class="wt-label">世界设定</div>
              <p class="wt-prose wt-setting">{{ world.setting || '（未填写设定）' }}</p>
            </section>
            <section class="wt-card">
              <div class="wt-label">规则包</div>
              <div class="wt-rule-detail">
                <div class="wt-row wt-gap-8">
                  <span class="material-icons-outlined">{{ rulePackStore.iconOf(world.rulePackId) }}</span>
                  <strong>{{ rulePackStore.nameOf(world.rulePackId) }}</strong>
                </div>
                <div class="wt-rule-flags">
                  <span>自动检定：{{ world.rules?.autoCheck ? '开' : '关' }}</span>
                  <span>失败推进：{{ world.rules?.failForward ? '开' : '关' }}</span>
                  <span>自由输入：{{ world.rules?.allowFreeInput ? '开' : '关' }}</span>
                  <span>选项数：{{ world.rules?.choiceCount ?? 3 }}</span>
                </div>
                <p v-if="world.rules?.style" class="wt-small wt-muted">文风：{{ world.rules.style }}</p>
                <ul v-if="world.rules?.directives?.length" class="wt-rule-list">
                  <li v-for="d in world.rules.directives" :key="d">{{ d }}</li>
                </ul>
              </div>
            </section>
          </div>

          <div v-else-if="tab === 'cast'" class="wt-tab-body">
            <div class="wt-cast-grid">
              <article
                v-for="c in cast"
                :key="c.id"
                class="wt-cast-card wt-clickable"
                @click="router.push(`/characters/${c.id}`)"
              >
                <div class="wt-cast-avatar" :style="{ background: c.avatarColor }">
                  <span class="material-icons-outlined">{{ c.avatarIcon }}</span>
                </div>
                <div class="wt-cast-body">
                  <div class="wt-row wt-gap-6">
                    <strong>{{ c.name }}</strong>
                    <span v-if="c.isPlayer" class="wt-badge">玩家</span>
                  </div>
                  <div class="wt-muted wt-small">{{ c.creatorNotes || '—' }}</div>
                  <p class="wt-cast-desc">{{ c.description }}</p>
                </div>
              </article>
            </div>
            <div v-if="!cast.length" class="wt-empty">
              <div class="material-icons-outlined wt-empty-emoji">person</div>
              <div>这个世界还没有角色卡</div>
              <mdui-button variant="tonal" @click="router.push('/characters')">去创建角色</mdui-button>
            </div>
          </div>

          <div v-else-if="tab === 'script'" class="wt-tab-body">
            <div v-if="scriptStats" class="wt-script-summary">
              <div class="wt-script-stat">
                <div class="wt-stat-num">{{ scriptStats.nodes }}</div>
                <div class="wt-small wt-muted">节点</div>
              </div>
              <div class="wt-script-stat">
                <div class="wt-stat-num">{{ scriptStats.events }}</div>
                <div class="wt-small wt-muted">事件</div>
              </div>
              <div class="wt-script-stat">
                <div class="wt-stat-num">{{ scriptStats.endNodes }}</div>
                <div class="wt-small wt-muted">结局</div>
              </div>
              <div class="wt-spacer"></div>
              <mdui-button
                variant="tonal"
                icon="edit"
                @click="router.push(`/scripts/${world.scriptFile?.replace('scripts/', '').replace('.md', '')}`)"
              >
                编辑剧本
              </mdui-button>
            </div>

            <div class="wt-script-flow">
              <div v-for="n in script?.nodes ?? []" :key="n.id" class="wt-script-node">
                <div class="wt-row wt-gap-8">
                  <span class="wt-node-id">{{ n.id }}</span>
                  <strong>{{ n.title }}</strong>
                  <span v-if="n.ending" class="wt-badge-end">结局</span>
                  <span v-if="n.id === script?.startNodeId" class="wt-badge-start">起始</span>
                  <span v-if="n.events.length" class="wt-badge-event">
                    <span class="material-icons-outlined">bolt</span>{{ n.events.length }}
                  </span>
                </div>
                <p class="wt-script-content">{{ n.content }}</p>
                <div class="wt-chip-row">
                  <span v-for="c in n.choices" :key="c.id" class="wt-choice-chip">
                    {{ c.text }}
                    <span v-if="c.next" class="wt-choice-next">→ {{ nodeName(c.next) }}</span>
                  </span>
                </div>
              </div>
            </div>

            <section v-if="script?.events.length" class="wt-card">
              <div class="wt-label">全局事件</div>
              <div v-for="ev in script.events" :key="ev.id" class="wt-global-event">
                <div class="wt-row wt-gap-6">
                  <span class="material-icons-outlined">bolt</span>
                  <strong class="wt-small">{{ ev.name }}</strong>
                  <span class="wt-event-chance">{{ Math.round(ev.chance * 100) }}%</span>
                  <span class="wt-tag wt-mono">{{ ev.trigger }}</span>
                  <span v-if="ev.cooldown" class="wt-tag">CD {{ ev.cooldown }}</span>
                  <span v-if="ev.once" class="wt-tag">一次性</span>
                </div>
                <p v-if="ev.narrative" class="wt-small wt-muted">{{ ev.narrative }}</p>
              </div>
            </section>
          </div>

          <div v-else class="wt-tab-body">
            <div v-if="sortedSessions.length" class="wt-line-list">
              <div v-for="s in roots" :key="s.id" class="wt-line-group">
                <article class="wt-line-card wt-clickable" @click="router.push(`/play/${s.id}`)">
                  <span class="material-icons-outlined wt-line-icon">
                    {{ s.archived ? 'inventory_2' : s.parentId ? 'call_split' : 'explore' }}
                  </span>
                  <div class="wt-line-body">
                    <div class="wt-row wt-gap-8">
                      <strong>{{ s.title }}</strong>
                      <span class="wt-badge-soft">{{ s.branchLabel }}</span>
                    </div>
                    <div class="wt-muted wt-small">
                      共 {{ s.messageCount }} 条记录 · 更新于 {{ formatTime(s.updatedAt) }}
                      <span v-if="s.state?.scene"> · {{ s.state.scene }}</span>
                    </div>
                  </div>
                  <div class="wt-line-actions" @click.stop>
                    <mdui-button-icon icon="edit" @click="renameSession(s)" aria-label="重命名" />
                    <mdui-button-icon icon="archive" @click="archiveSession(s)" aria-label="归档" />
                    <mdui-button-icon icon="delete" @click="removeSession(s)" aria-label="删除" />
                  </div>
                </article>

                <div v-if="childrenOf(s.id).length" class="wt-forks">
                  <div v-for="child in childrenOf(s.id)" :key="child.id" class="wt-fork-item">
                    <span class="material-icons-outlined wt-fork-icon">call_split</span>
                    <div class="wt-line-body wt-clickable" @click="router.push(`/play/${child.id}`)">
                      <strong class="wt-small">{{ child.title }}</strong>
                      <div class="wt-muted wt-small">{{ child.messageCount }} 条 · {{ formatTime(child.updatedAt) }}</div>
                    </div>
                    <mdui-button-icon icon="delete" @click.stop="removeSession(child)" aria-label="删除" />
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="wt-empty">
              <div class="material-icons-outlined wt-empty-emoji">explore</div>
              <div>还没有任何世界线</div>
              <mdui-button variant="filled" @click="showStart = true">开始第一条</mdui-button>
            </div>
          </div>
        </div>

        <aside class="wt-detail-side">
          <section class="wt-card">
            <div class="wt-label">基本信息</div>
            <div class="wt-meta-list">
              <div class="wt-meta-row"><span>推演模式</span><strong>{{ MODE_LABELS[world.mode] }}</strong></div>
              <div class="wt-meta-row"><span>规则包</span><strong>{{ rulePackStore.nameOf(world.rulePackId) }}</strong></div>
              <div class="wt-meta-row"><span>角色数量</span><strong>{{ cast.length }} 人（NPC {{ npcCount }}）</strong></div>
              <div class="wt-meta-row"><span>世界书</span><strong>{{ bookName }}</strong></div>
              <div class="wt-meta-row"><span>世界线</span><strong>{{ sessions.length }} 条</strong></div>
              <div class="wt-meta-row"><span>创建时间</span><strong>{{ formatTime(world.createdAt) }}</strong></div>
            </div>
          </section>

          <section class="wt-card wt-tip">
            <div class="wt-row wt-gap-8">
              <span class="material-icons-outlined">lightbulb</span>
              <strong>玩法提示</strong>
            </div>
            <p class="wt-small wt-muted">
              每条消息都是一个存档点。从任意一条消息分叉，就会长出一条新的世界线，原来的世界线不受影响。
              检定结果与事件触发都会写进该条消息，重演同一个存档结果不会变。
            </p>
          </section>
        </aside>
      </div>
    </div>

    <StartSessionDialog
      v-model:open="showStart"
      :world="world"
      :cast="cast"
      :starting="starting"
      @start="doStart"
    />
  </div>
</template>

<style scoped>
.wt-gap-8 { gap: 8px; }
.wt-gap-6 { gap: 6px; }

.wt-banner {
  position: relative;
  border-radius: 28px;
  overflow: hidden;
  margin-bottom: 24px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
}

.wt-banner-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(700px 260px at 12% 0%, color-mix(in srgb, var(--cover) 55%, transparent), transparent 72%),
    linear-gradient(140deg, color-mix(in srgb, var(--cover) 30%, transparent), transparent 62%);
  opacity: 0.55;
}

.wt-banner-content {
  position: relative;
  display: flex;
  gap: 22px;
  padding: 28px 30px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.wt-banner-icon {
  width: 84px;
  height: 84px;
  border-radius: 24px;
  display: grid;
  place-items: center;
  background: rgba(var(--mdui-color-surface-container-lowest), 0.78);
  backdrop-filter: blur(6px);
  box-shadow: var(--mdui-elevation-level1);
  flex-shrink: 0;
  color: rgb(var(--mdui-color-primary));
}

.wt-banner-icon .material-icons-outlined {
  font-size: 2.75rem;
}

.wt-banner-info {
  flex: 1;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-banner-title {
  font-size: 1.875rem;
  margin: 2px 0 0;
  font-weight: 600;
}

.wt-banner-sub {
  margin: 0;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-mode-pill,
.wt-rule-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.6875rem;
}

.wt-mode-pill {
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-rule-pill {
  background: rgba(var(--mdui-color-tertiary), 0.16);
  color: rgb(var(--mdui-color-tertiary));
}

.wt-mode-pill .material-icons-outlined,
.wt-rule-pill .material-icons-outlined {
  font-size: 0.875rem;
}

.wt-banner-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.wt-tag {
  font-size: 0.6875rem;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.08);
}

.wt-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 22px;
  align-items: start;
}

.wt-tabs {
  margin-bottom: 16px;
}

.wt-tab-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wt-opening,
.wt-setting {
  margin: 10px 0 0;
}

.wt-rule-detail {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-rule-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.75rem;
}

.wt-rule-flags span {
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.07);
}

.wt-rule-list {
  margin: 4px 0 0;
  padding-left: 20px;
  line-height: 1.85;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.875rem;
}

.wt-cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.wt-cast-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-cast-avatar {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 16px;
  display: grid;
  place-items: center;
  color: #fff;
}

.wt-cast-avatar .material-icons-outlined {
  font-size: 1.75rem;
}

.wt-cast-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wt-cast-desc {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: rgb(var(--mdui-color-on-surface-variant));
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wt-badge {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
}

.wt-badge-end {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-badge-start {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-primary), 0.16);
  color: rgb(var(--mdui-color-primary));
}

.wt-badge-event {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 0.625rem;
  color: rgb(var(--mdui-color-tertiary));
}

.wt-badge-event .material-icons-outlined {
  font-size: 0.75rem;
}

.wt-badge-soft {
  font-size: 0.625rem;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-primary), 0.1);
  color: rgb(var(--mdui-color-primary));
}

.wt-script-summary {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  border-radius: 18px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-script-stat {
  text-align: center;
}

.wt-stat-num {
  font-size: 1.375rem;
  font-weight: 600;
  color: rgb(var(--mdui-color-primary));
  line-height: 1.1;
}

.wt-script-flow {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-script-node {
  padding: 16px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-node-id {
  font-family: Consolas, monospace;
  font-size: 0.6875rem;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(var(--mdui-color-on-surface), 0.07);
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-script-content {
  margin: 8px 0 10px;
  font-size: 0.875rem;
  line-height: 1.75;
  color: rgb(var(--mdui-color-on-surface-variant));
  white-space: pre-wrap;
}

.wt-choice-chip {
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-secondary-container), 0.7);
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-choice-next {
  opacity: 0.6;
  margin-left: 4px;
}

.wt-global-event {
  padding: 10px 0;
  border-bottom: 1px dashed rgba(var(--mdui-color-outline-variant), 0.5);
}

.wt-global-event:last-child {
  border-bottom: none;
}

.wt-global-event .material-icons-outlined {
  font-size: 0.9375rem;
  color: rgb(var(--mdui-color-tertiary));
}

.wt-global-event p {
  margin: 4px 0 0;
  line-height: 1.6;
}

.wt-event-chance {
  font-size: 0.6875rem;
  font-weight: 600;
  color: rgb(var(--mdui-color-tertiary));
}

.wt-line-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-line-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-line-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-low));
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.35);
}

.wt-line-icon {
  font-size: 1.5rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-line-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-line-actions {
  display: flex;
  gap: 2px;
}

.wt-forks {
  margin-left: 26px;
  padding-left: 14px;
  border-left: 2px dashed rgba(var(--mdui-color-primary), 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-fork-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 12px;
}

.wt-fork-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.04);
}

.wt-fork-icon {
  font-size: 1rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-detail-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: 8px;
}

.wt-meta-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.wt-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.8125rem;
}

.wt-meta-row span {
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-tip p {
  margin: 10px 0 0;
  line-height: 1.7;
}

.wt-tip .material-icons-outlined {
  font-size: 1.1rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-empty-emoji {
  font-size: 2.5rem;
}

.wt-skeleton-lg {
  height: 320px;
  border-radius: 28px;
  background: rgb(var(--mdui-color-surface-container));
}

@media (max-width: 1080px) {
  .wt-detail-grid {
    grid-template-columns: 1fr;
  }
  .wt-detail-side {
    position: static;
  }
}
</style>




