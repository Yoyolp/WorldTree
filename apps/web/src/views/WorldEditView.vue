<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PlayMode, RulePack, RulePackId, World } from '@worldtree/shared';
import { api } from '@/api';
import { useCatalogStore } from '@/stores/catalog';
import { COVER_ICONS, MODE_LABELS, askConfirm, toast, evValue } from '@/utils/ui';
import { useRulePackStore } from '@/stores/rulepacks';
import WtLoader from '@/components/WtLoader.vue';

const route = useRoute();
const router = useRouter();
const catalog = useCatalogStore();
const rulePackStore = useRulePackStore();

const isNew = computed(() => route.name === 'world-new');
const worldId = computed(() => (route.params.id ? String(route.params.id) : null));

const form = reactive({
  title: '',
  subtitle: '',
  description: '',
  coverIcon: 'auto_stories',
  coverColor: '#4f6f52',
  tagsText: '',
  author: '佚名',
  mode: 'story' as PlayMode,
  rulePackId: 'narrative' as RulePackId,
  opening: '',
  setting: '',
  style: '',
  directivesText: '',
  allowFreeInput: true,
  choiceCount: 3,
  autoAdvance: false,
  autoCheck: true,
  failForward: false,
  worldBookId: '' as string,
  characterIds: [] as string[],
  playerCardMode: 'open' as 'open' | 'fixed',
  sheetRulePrecedence: 'character' as 'character' | 'world',
  scriptFile: '' as string,
  systemPromptOverride: '',
});

const rulePacks = computed<RulePack[]>(() => rulePackStore.list);
const loading = ref(true);
const saving = ref(false);
const activeTab = ref('basic');

const coverColors = ['#4f6f52', '#3f5b6b', '#5a4a63', '#7a4a3a', '#3a5a7a', '#6b5b3a', '#4a4a5a', '#7a3a4a', '#2f6f6b', '#3d4e8a'];

const castOptions = computed(() =>
  catalog.charactersList.map((c) => ({ id: c.id, label: `${c.name}${c.isPlayer ? '（玩家）' : ''}`, icon: c.avatarIcon })),
);

const scripts = ref<{ id: string; file: string; title: string; nodeCount: number; errors: string[] }[]>([]);

const scriptValid = computed(() => {
  const s = scripts.value.find((x) => x.file === form.scriptFile);
  return s ? s.errors.length === 0 : null;
});

/** 模式切换时，自动套用推荐规则包 */
function setMode(m: PlayMode) {
  form.mode = m;
  form.rulePackId = rulePackStore.defaultForMode(m);
}

async function load() {
  loading.value = true;
  try {
    await catalog.load(true);
    await rulePackStore.load(true);
    const s = await api.listScripts();
    scripts.value = s.items;

    if (!isNew.value && worldId.value) {
      const detail = await api.getWorld(worldId.value);
      const w: World = detail.world;
      Object.assign(form, {
        title: w.title,
        subtitle: w.subtitle,
        description: w.description,
        coverIcon: w.coverIcon,
        coverColor: w.coverColor,
        tagsText: w.tags.join('、'),
        author: w.author,
        mode: w.mode,
        rulePackId: w.rulePackId,
        opening: w.opening,
        setting: w.setting,
        style: w.rules?.style ?? '',
        directivesText: (w.rules?.directives ?? []).join('\n'),
        allowFreeInput: w.rules?.allowFreeInput ?? true,
        choiceCount: w.rules?.choiceCount ?? 3,
        autoAdvance: w.rules?.autoAdvance ?? false,
        autoCheck: w.rules?.autoCheck ?? true,
        failForward: w.rules?.failForward ?? false,
        worldBookId: w.worldBookId ?? '',
        characterIds: [...w.characterIds],
        playerCardMode: w.playerCardMode ?? 'open',
        sheetRulePrecedence: w.sheetRulePrecedence ?? 'character',
        scriptFile: w.scriptFile ?? '',
        systemPromptOverride: w.systemPromptOverride ?? '',
      });
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function buildPayload(): Partial<World> {
  return {
    title: form.title.trim(),
    subtitle: form.subtitle,
    description: form.description,
    coverIcon: form.coverIcon,
    coverColor: form.coverColor,
    tags: form.tagsText
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    author: form.author,
    mode: form.mode,
    rulePackId: form.rulePackId,
    opening: form.opening,
    setting: form.setting,
    rules: {
      style: form.style,
      directives: form.directivesText.split('\n').map((s) => s.trim()).filter(Boolean),
      allowFreeInput: form.allowFreeInput,
      choiceCount: Number(form.choiceCount) || 3,
      autoAdvance: form.autoAdvance,
      autoCheck: form.autoCheck,
      failForward: form.failForward,
    },
    worldBookId: form.worldBookId || null,
    characterIds: form.characterIds,
    playerCardMode: form.playerCardMode,
    sheetRulePrecedence: form.sheetRulePrecedence,
    scriptFile: form.scriptFile || undefined,
    systemPromptOverride: form.systemPromptOverride || undefined,
  };
}

async function save() {
  if (!form.title.trim()) {
    toast('请填写世界标题');
    activeTab.value = 'basic';
    return;
  }
  saving.value = true;
  try {
    if (isNew.value) {
      const created = await api.createWorld(buildPayload());
      toast('世界已创建');
      router.replace(`/worlds/${created.id}`);
    } else if (worldId.value) {
      await api.updateWorld(worldId.value, buildPayload());
      toast('已保存');
      const s = await api.listScripts();
      scripts.value = s.items;
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function removeWorld() {
  if (!worldId.value) return;
  const ok = await askConfirm('删除这个世界？', '对应的 content 文件与所有世界线都会删除。');
  if (!ok) return;
  await api.deleteWorld(worldId.value);
  router.push('/');
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container-narrow">
      <div class="wt-row wt-edit-head">
        <mdui-button-icon icon="arrow_back" @click="router.back()" />
        <div>
          <h1 class="wt-edit-title">{{ isNew ? '创造一个新世界' : '编辑世界设定' }}</h1>
          <p class="wt-muted wt-small">写下的内容会存进 content/ 目录，直接成为 AI 的世界设定与叙事指令。</p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button v-if="!isNew" variant="text" icon="delete" @click="removeWorld">删除</mdui-button>
        <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
      </div>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <template v-else>
        <mdui-tabs :value="activeTab" variant="secondary" class="wt-edit-tabs" @change="activeTab = evValue($event)">
          <mdui-tab value="basic">基本</mdui-tab>
          <mdui-tab value="content">设定与开场</mdui-tab>
          <mdui-tab value="rules">规则</mdui-tab>
          <mdui-tab value="cast">角色与世界书</mdui-tab>
          <mdui-tab v-if="form.mode === 'script'" value="script">剧本</mdui-tab>
        </mdui-tabs>

        <!-- 基本 -->
        <section v-if="activeTab === 'basic'" class="wt-form">
          <div class="wt-form-row">
            <mdui-text-field v-model="form.title" label="世界标题" variant="outlined" required></mdui-text-field>
            <mdui-text-field v-model="form.subtitle" label="副标题" variant="outlined"></mdui-text-field>
          </div>
          <mdui-text-field
            v-model="form.description"
            label="简介"
            variant="outlined"
            rows="3"
            autosize
            max-rows="6"
          ></mdui-text-field>

          <div class="wt-field">
            <div class="wt-label">推演模式</div>
            <div class="wt-mode-grid">
              <button
                v-for="m in (['story', 'script', 'coc'] as PlayMode[])"
                :key="m"
                class="wt-mode-card"
                :class="{ active: form.mode === m }"
                @click="setMode(m)"
              >
                <span class="material-icons-outlined">{{
                  m === 'story' ? 'auto_stories' : m === 'script' ? 'account_tree' : 'casino'
                }}</span>
                <strong>{{ MODE_LABELS[m] }}</strong>
                <span class="wt-mode-desc">
                  {{
                    m === 'story'
                      ? 'AI 自由推演，玩家用自然语言行动'
                      : m === 'script'
                        ? '按剧情节拍推进，选项由节点定义'
                        : '带角色面板、技能检定与理智值'
                  }}
                </span>
              </button>
            </div>
          </div>

          <div class="wt-form-row">
            <div class="wt-field wt-flex1">
              <div class="wt-label">封面图标（Material Icons）</div>
              <div class="wt-icon-grid">
                <button
                  v-for="ic in COVER_ICONS"
                  :key="ic"
                  class="wt-icon-opt"
                  :class="{ active: form.coverIcon === ic }"
                  :title="ic"
                  @click="form.coverIcon = ic"
                >
                  <span class="material-icons-outlined">{{ ic }}</span>
                </button>
              </div>
            </div>
            <div class="wt-field wt-flex1">
              <div class="wt-label">封面主色（用于生成 Material You 配色）</div>
              <div class="wt-color-grid">
                <button
                  v-for="c in coverColors"
                  :key="c"
                  class="wt-swatch"
                  :class="{ active: form.coverColor === c }"
                  :style="{ background: c }"
                  @click="form.coverColor = c"
                ></button>
              </div>
              <input v-model="form.coverColor" class="wt-color-input" type="color" />
            </div>
          </div>

          <div class="wt-form-row">
            <mdui-text-field v-model="form.tagsText" label="标签（顿号分隔）" variant="outlined"></mdui-text-field>
            <mdui-text-field v-model="form.author" label="作者署名" variant="outlined"></mdui-text-field>
          </div>
        </section>

        <!-- 设定 -->
        <section v-else-if="activeTab === 'content'" class="wt-form">
          <mdui-text-field
            v-model="form.opening"
            label="开场白（玩家进入世界看到的第一段文字）"
            variant="outlined"
            rows="6"
            autosize
            max-rows="14"
          ></mdui-text-field>
          <mdui-text-field
            v-model="form.setting"
            label="世界设定总纲"
            helper="这段会完整进入系统提示：世界观、时代、核心谜团、基调"
            variant="outlined"
            rows="10"
            autosize
            max-rows="22"
          ></mdui-text-field>
        </section>

        <!-- 规则 -->
        <section v-else-if="activeTab === 'rules'" class="wt-form">
          <div class="wt-field">
            <div class="wt-label">规则包</div>
            <div class="wt-rulepacks">
              <button
                v-for="p in rulePacks"
                :key="p.id"
                class="wt-rulepack"
                :class="{ active: form.rulePackId === p.id }"
                @click="form.rulePackId = p.id"
              >
                <div class="wt-row wt-gap-6">
                  <span class="material-icons-outlined">{{ p.icon || 'extension' }}</span>
                  <strong>{{ p.name }}</strong>
                </div>
                <p class="wt-small wt-muted">{{ p.description }}</p>
                <div class="wt-rulepack-tags">
                  <span>d{{ p.dieFaces }}</span>
                  <span v-if="p.difficulties">难度分级</span>
                  <span v-if="p.bonusPenalty">奖励骰</span>
                  <span v-if="p.luckSpend">幸运改判</span>
                  <span v-if="p.pushedRolls">孤注一掷</span>
                  <span v-if="p.failForward">失败也推进</span>
                </div>
              </button>
            </div>
          </div>

          <mdui-text-field v-model="form.style" label="文风描述" variant="outlined"></mdui-text-field>
          <mdui-text-field
            v-model="form.directivesText"
            label="叙事要求（每行一条）"
            variant="outlined"
            rows="6"
            autosize
            max-rows="14"
          ></mdui-text-field>

          <div class="wt-switch-list">
            <label class="wt-switch-row">
              <div>
                <strong>允许自由输入</strong>
                <div class="wt-small wt-muted">玩家可以自己写行动，而不只是点选项</div>
              </div>
              <mdui-switch :checked="form.allowFreeInput" @change="form.allowFreeInput = ($event.target as any).checked"></mdui-switch>
            </label>
            <label class="wt-switch-row">
              <div>
                <strong>自动检定</strong>
                <div class="wt-small wt-muted">从玩家行动里推断技能，自动掷骰</div>
              </div>
              <mdui-switch :checked="form.autoCheck" @change="form.autoCheck = ($event.target as any).checked"></mdui-switch>
            </label>
            <label class="wt-switch-row">
              <div>
                <strong>失败也推进（fail forward）</strong>
                <div class="wt-small wt-muted">检定失败时不卡住剧情，而是给出代价</div>
              </div>
              <mdui-switch :checked="form.failForward" @change="form.failForward = ($event.target as any).checked"></mdui-switch>
            </label>
            <label class="wt-switch-row">
              <div>
                <strong>AI 自主推进</strong>
                <div class="wt-small wt-muted">没有选项时让模型自行推进剧情</div>
              </div>
              <mdui-switch :checked="form.autoAdvance" @change="form.autoAdvance = ($event.target as any).checked"></mdui-switch>
            </label>
          </div>

          <mdui-text-field
            v-model.number="form.choiceCount"
            type="number"
            label="建议选项数量"
            variant="outlined"
            min="2"
            max="6"
          ></mdui-text-field>

          <mdui-text-field
            v-model="form.systemPromptOverride"
            label="追加系统指令（可选）"
            variant="outlined"
            rows="4"
            autosize
            max-rows="10"
          ></mdui-text-field>
        </section>

        <!-- 角色与世界书 -->
        <section v-else-if="activeTab === 'cast'" class="wt-form">
          <div class="wt-field">
            <div class="wt-label">绑定世界书</div>
            <div class="wt-row">
              <mdui-select :value="form.worldBookId" variant="outlined" placeholder="不绑定" @change="form.worldBookId = evValue($event)">
                <mdui-menu-item value="">不绑定</mdui-menu-item>
                <mdui-menu-item v-for="b in catalog.books" :key="b.id" :value="b.id">
                  {{ b.name }}（{{ b.entries.length }} 条）
                </mdui-menu-item>
              </mdui-select>
              <mdui-button variant="outlined" icon="add" @click="router.push('/worldbooks')">管理</mdui-button>
            </div>
          </div>

          <div class="wt-field">
            <div class="wt-label">登场角色</div>
            <div class="wt-check-chips">
              <button
                v-for="c in castOptions"
                :key="c.id"
                class="wt-check-chip"
                :class="{ picked: form.characterIds.includes(c.id) }"
                @click="
                  form.characterIds.includes(c.id)
                    ? form.characterIds.splice(form.characterIds.indexOf(c.id), 1)
                    : form.characterIds.push(c.id)
                "
              >
                <span class="material-icons-outlined">{{ c.icon }}</span>
                {{ c.label }}
              </button>
            </div>
            <div class="wt-row" style="margin-top: 10px">
              <mdui-button variant="text" icon="person_add" @click="router.push('/characters')">前往角色卡</mdui-button>
            </div>
          </div>

          <div class="wt-field">
            <div class="wt-label">玩家主角卡</div>
            <mdui-select
              :value="form.playerCardMode"
              variant="outlined"
              @change="form.playerCardMode = evValue($event) as 'open' | 'fixed'"
            >
              <mdui-menu-item value="open">玩家可以选自己的角色卡（默认）</mdui-menu-item>
              <mdui-menu-item value="fixed">只能用本世界的角色卡</mdui-menu-item>
            </mdui-select>
            <p class="wt-small wt-muted">
              选「只能」适合主角已经写死在剧本里的世界：开局时玩家只能在上面这些角色里挑，不能从角色库带卡进来。
              不填时按「可以选」处理。
            </p>
          </div>

          <div class="wt-field">
            <div class="wt-label">角色面板以哪本书为准</div>
            <mdui-select
              :value="form.sheetRulePrecedence"
              variant="outlined"
              @change="form.sheetRulePrecedence = evValue($event) as 'character' | 'world'"
            >
              <mdui-menu-item value="character">按角色卡自带的规则书（默认）</mdui-menu-item>
              <mdui-menu-item value="world">按本世界的规则书</mdui-menu-item>
            </mdui-select>
            <p class="wt-small wt-muted">
              只影响面板「有哪些字段、怎么显示」。掷骰判定永远用本世界的规则书，
              同一世界内不会出现两套成功率。拿一张 D&amp;D 卡进 COC 世界时，
              选「按角色卡」能看到 AC 和法术位，选「按本世界」则只显示 COC 那套。
            </p>
          </div>
        </section>

        <!-- 剧本 -->
        <section v-else class="wt-form">
          <div class="wt-card wt-script-tip">
            <span class="material-icons-outlined">account_tree</span>
            <div>
              <strong>剧本用 Markdown DSL 编写</strong>
              <p class="wt-small wt-muted">
                在「剧本」页面用 Markdown 编写，保存时自动编译为节点图。这里只需选择绑定哪个剧本文件。
              </p>
            </div>
          </div>

          <div class="wt-field">
            <div class="wt-label">绑定剧本</div>
            <div class="wt-row">
              <mdui-select :value="form.scriptFile" variant="outlined" placeholder="未绑定" @change="form.scriptFile = evValue($event)">
                <mdui-menu-item value="">未绑定</mdui-menu-item>
                <mdui-menu-item v-for="s in scripts" :key="s.id" :value="s.file">
                  {{ s.title }}（{{ s.nodeCount }} 节点{{ s.errors.length ? `，${s.errors.length} 错误` : '' }}）
                </mdui-menu-item>
              </mdui-select>
              <mdui-button
                variant="outlined"
                icon="edit"
                :disabled="!form.scriptFile"
                @click="
                  form.scriptFile &&
                    router.push(`/scripts/${scripts.find((s) => s.file === form.scriptFile)?.id}`)
                "
              >
                编辑
              </mdui-button>
            </div>
            <p v-if="scriptValid === false" class="wt-script-warn wt-small">
              <span class="material-icons-outlined">error</span>
              该剧本有编译错误，运行时会回落到离线旁白
            </p>
            <p v-else-if="scriptValid === true" class="wt-script-ok wt-small">
              <span class="material-icons-outlined">check_circle</span>
              剧本编译通过
            </p>
          </div>
        </section>

        <div class="wt-save-bar">
          <mdui-button variant="outlined" @click="router.back()">返回</mdui-button>
          <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wt-edit-head {
  margin-bottom: 20px;
  align-items: flex-start;
}

.wt-edit-title {
  font-size: 1.5rem;
  margin: 0 0 4px;
}

.wt-edit-tabs {
  margin-bottom: 20px;
}

.wt-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.wt-form-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.wt-form-row > * {
  flex: 1;
  min-width: 220px;
}

.wt-flex1 {
  flex: 1;
}

.wt-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.wt-mode-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  font-family: inherit;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms, background 160ms;
}

.wt-mode-card.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.08);
}

.wt-mode-card .material-icons-outlined {
  color: rgb(var(--mdui-color-primary));
}

.wt-mode-desc {
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  line-height: 1.5;
}

.wt-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wt-icon-opt {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  display: grid;
  place-items: center;
}

.wt-icon-opt.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.12);
  color: rgb(var(--mdui-color-primary));
}

.wt-color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wt-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.wt-swatch.active {
  border-color: rgb(var(--mdui-color-on-surface));
  box-shadow: 0 0 0 2px rgb(var(--mdui-color-surface));
}

.wt-color-input {
  margin-top: 6px;
  width: 100%;
  height: 32px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
}

.wt-rulepacks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.wt-rulepack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  font-family: inherit;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  text-align: left;
}

.wt-rulepack.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.08);
}

.wt-rulepack .material-icons-outlined {
  font-size: 1.125rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-rulepack p {
  margin: 0;
  line-height: 1.55;
}

.wt-rulepack-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wt-rulepack-tags span {
  font-size: 0.625rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-on-surface), 0.07);
}

.wt-switch-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wt-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px dashed rgba(var(--mdui-color-outline-variant), 0.5);
  cursor: pointer;
}

.wt-check-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wt-check-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.7);
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
}

.wt-check-chip .material-icons-outlined {
  font-size: 0.9375rem;
}

.wt-check-chip.picked {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.12);
  color: rgb(var(--mdui-color-primary));
}

.wt-script-tip {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.wt-script-tip .material-icons-outlined {
  color: rgb(var(--mdui-color-primary));
}

.wt-script-tip p {
  margin: 6px 0 0;
  line-height: 1.65;
}

.wt-script-warn,
.wt-script-ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 0;
}

.wt-script-warn {
  color: rgb(var(--mdui-color-error));
}

.wt-script-ok {
  color: #2e7d32;
}

.wt-script-warn .material-icons-outlined,
.wt-script-ok .material-icons-outlined {
  font-size: 0.9375rem;
}

.wt-save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 0;
  background: linear-gradient(transparent, rgb(var(--mdui-color-background)) 40%);
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}

.wt-gap-6 {
  gap: 6px;
}

@media (max-width: 720px) {
  .wt-form-row > * {
    min-width: 100%;
  }
}
</style>





