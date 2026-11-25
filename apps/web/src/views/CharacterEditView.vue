<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  createSheetFromSchema,
  computeDerived,
  computeResourceMax,
  computeSkillBase,
  getSheetSchema,
  migrateSheet,
  resourceMax,
  resourceValue,
  withResource,
  withResourceMax,
  type CharacterAbility,
  type CharacterCard,
  type CocSheet,
  type RulePack,
} from '@worldtree/shared';
import { api } from '@/api';
import { useCatalogStore } from '@/stores/catalog';
import { useRulePackStore } from '@/stores/rulepacks';
import { ABILITY_KINDS, ABILITY_KIND_ICONS, CHARACTER_ICONS, askConfirm, toast, evChecked, evValueRaw, evValue } from '@/utils/ui';
import { uploadImage } from '@/utils/image';
import WtAvatar from '@/components/WtAvatar.vue';
import WtLoader from '@/components/WtLoader.vue';

const route = useRoute();
const router = useRouter();
const catalog = useCatalogStore();
const rulePacks = useRulePackStore();

const form = reactive<CharacterCard>({
  id: '',
  spec: 'chara_card_v2',
  specVersion: '2.0',
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMes: '',
  mesExample: '',
  creatorNotes: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: [],
  creator: '',
  characterVersion: '1.0',
  extensions: {},
  characterBookId: null,
  avatarIcon: 'person',
  avatarColor: '#4f6f52',
  avatarImage: null,
  isPlayer: false,
  sheet: undefined,
  createdAt: 0,
  updatedAt: 0,
});

const tagsText = ref('');
const altGreetingsText = ref('');
const loading = ref(true);
const saving = ref(false);
const activeTab = ref('basic');

/** 头像图片上传 */
const avatarFileInput = ref<HTMLInputElement | null>(null);
const avatarUploading = ref(false);

async function onPickAvatar(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  avatarUploading.value = true;
  try {
    // 头像给 512 足够，太大只会拖慢列表
    form.avatarImage = await uploadImage(file, { prefix: 'chr', maxEdge: 512 });
    toast('头像已上传');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    avatarUploading.value = false;
    // 清空 value，否则连续选同一个文件不触发 change
    input.value = '';
  }
}

function clearAvatar(): void {
  form.avatarImage = null;
}

const avatarColors = ['#4f6f52', '#3f5b6b', '#5a4a63', '#7a4a3a', '#3a5a7a', '#6b5b3a', '#4a4a5a', '#7a3a4a'];

/* ------------------------------------------------------------------ */
/* 面板：结构由规则书声明，这里只做渲染与编辑                            */
/* ------------------------------------------------------------------ */

/**
 * 当前面板用哪本规则书。
 *
 * 存在 `form.sheet.rulePackId` 上，跟着角色卡一起保存 ——
 * 这样这张卡被放进任何世界，平台都知道该按什么结构渲染它。
 */
const sheetPackId = ref<string | null>(null);

/** 有面板结构的规则书（没声明 schema 的规则不进这个列表） */
const sheetPacks = computed(() => rulePacks.list.filter((p) => p.sheetSchema));

const sheetPack = computed<RulePack | null>(() => {
  const id = sheetPackId.value ?? form.sheet?.rulePackId ?? null;
  return (id ? rulePacks.byId(id) : undefined) ?? rulePacks.byId('coc7') ?? null;
});

const schema = computed(() => getSheetSchema(sheetPack.value));

/** 属性编辑项：按 schema 顺序 + 中文标签 + 范围 */
const sheetAttrs = computed(() => {
  const s = schema.value;
  if (!s?.attributes?.length) return [];
  return s.attributes.map((d) => ({
    key: d.key,
    label: d.label || d.key,
    abbr: d.abbr ?? d.key,
    min: d.min ?? 1,
    max: d.max ?? 99,
    hint: d.hint,
    value: form.sheet?.attributes[d.key] ?? d.default ?? 0,
  }));
});

/** 资源编辑项：当前值 + 上限（上限也有公式时只读展示，可手动覆盖） */
const sheetResources = computed(() => {
  const s = schema.value;
  if (!s?.resources?.length || !form.sheet) return [];
  return s.resources.map((d) => ({
    key: d.key,
    label: d.label || d.key,
    hint: d.hint,
    cur: resourceValue(form.sheet, d.key),
    max: resourceMax(form.sheet, d.key),
    /** 有 maxFormula 说明上限由属性推导，改了属性就会跟着变 */
    derivedMax: !!d.maxFormula,
  }));
});

/** 派生展示值（只读） */
const sheetDerived = computed(() =>
  form.sheet && schema.value ? computeDerived(form.sheet, schema.value.derived) : [],
);

const skillMax = computed(() => schema.value?.skillMax ?? 99);
const freeSkills = computed(() => schema.value?.freeSkills !== false);

/** 切换规则书：把现有面板迁移到新结构（不丢字段） */
function switchSheetPack(id: string): void {
  const next = rulePacks.byId(id);
  if (!next?.sheetSchema) return;
  sheetPackId.value = id;
  if (!form.sheet) {
    form.sheet = createSheetFromSchema(next.sheetSchema, { rulePackId: id, name: form.name });
    return;
  }
  form.sheet = migrateSheet(form.sheet, next.sheetSchema, { rulePackId: id });
  toast(`面板已切换为「${next.name}」的结构`);
}

/** 跳到百科并定位到这本规则书 */
function openCodex(rulePackId?: string): void {
  router.push({ path: '/codex', query: rulePackId ? { pack: rulePackId } : {} });
}

/** 读/写资源（走 shared 的通用访问器，不直接摸 hp/mp/san 字段） */
function setRes(key: string, value: number): void {
  if (!form.sheet) return;
  form.sheet = withResource(form.sheet, key, Number(value) || 0);
}

function setResMax(key: string, value: number): void {
  if (!form.sheet) return;
  form.sheet = withResourceMax(form.sheet, key, Number(value) || 0);
}

function setAttr(key: string, value: number): void {
  if (!form.sheet) return;
  form.sheet.attributes = { ...form.sheet.attributes, [key]: Number(value) || 0 };
  syncDerived();
}

/** 属性变了以后按 schema 重算所有带公式的上限 */
function syncDerived(): void {
  const s = schema.value;
  if (!form.sheet || !s) return;
  for (const def of s.resources) {
    if (!def.maxFormula) continue;
    const oldMax = resourceMax(form.sheet, def.key);
    const oldCur = resourceValue(form.sheet, def.key);
    // 用最新属性重算上限
    const fresh = computeResourceMax(form.sheet, def);
    if (fresh === undefined) continue;
    form.sheet = withResourceMax(form.sheet, def.key, fresh);
    // 当前值按比例缩放，避免出现「120 / 10」
    const ratio = oldMax > 0 ? oldCur / oldMax : 1;
    const cur = Math.max(0, Math.min(fresh, Math.round(fresh * ratio)));
    form.sheet = withResource(form.sheet, def.key, cur);
  }
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([catalog.load(true), rulePacks.load()]);
    const c = await api.getCharacter(String(route.params.id));
    Object.assign(form, c);
    tagsText.value = c.tags.join('、');
    altGreetingsText.value = c.alternateGreetings.join('\n---\n');
    if (!form.abilities) form.abilities = [];
    // 老卡没有规则书标记：有面板就按 COC 结构认（历史默认），没面板就留空
    sheetPackId.value = c.sheet?.rulePackId ?? (c.sheet ? 'coc7' : null);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!form.name.trim()) {
    toast('请填写角色名');
    activeTab.value = 'basic';
    return;
  }
  saving.value = true;
  try {
    // 面板带上它归属的规则书，这样它被放进任何世界都知道该怎么渲染
    const sheet = form.sheet
      ? { ...form.sheet, rulePackId: sheetPackId.value ?? form.sheet.rulePackId ?? undefined }
      : undefined;
    const next = await api.updateCharacter(form.id, {
      ...form,
      sheet,
      tags: tagsText.value
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      alternateGreetings: altGreetingsText.value
        .split(/\n---\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    Object.assign(form, next);
    toast('已保存');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function removeChar() {
  const ok = await askConfirm('删除这个角色？', form.name);
  if (!ok) return;
  await api.deleteCharacter(form.id);
  router.push('/characters');
}

/** 启用面板：按当前规则书的 schema 建一份 */
function enableSheet(): void {
  if (form.sheet) {
    form.sheet = undefined;
    return;
  }
  const s = schema.value;
  if (!s) {
    toast('当前规则书没有声明角色面板结构，无法启用面板');
    return;
  }
  form.sheet = createSheetFromSchema(s, { rulePackId: sheetPack.value?.id, name: form.name });
}

/** 按当前规则书的 schema 随机生成 */
async function rollSheet(): Promise<void> {
  try {
    form.sheet = await api.rollSheet(sheetPack.value?.id);
    toast(`已按「${sheetPack.value?.name ?? '规则书'}」随机生成`);
  } catch (err) {
    toast((err as Error).message);
  }
}

function addSkill(): void {
  if (!form.sheet) return;
  form.sheet.skills.push({ name: '新技能', value: 20 });
}

function removeSkill(i: number): void {
  form.sheet?.skills.splice(i, 1);
}

/** 把一个技能重置为 schema 声明的基准值 */
function resetSkill(i: number): void {
  const s = schema.value;
  const sheet = form.sheet;
  if (!s?.skills?.length || !sheet) return;
  const cur = sheet.skills[i];
  const def = s.skills.find((d) => d.label === cur.name || d.key === cur.name);
  if (!def) return;
  sheet.skills[i].value = computeSkillBase(sheet, def);
}

/* ------------------------------------------------------------------ */
/* 能力（金手指）                                                       */
/* ------------------------------------------------------------------ */

function addAbility() {
  if (!form.abilities) form.abilities = [];
  form.abilities.push({
    id: `ab_${Date.now().toString(36)}`,
    name: '',
    kind: 'cheat',
    description: '',
    effect: { checkBonus: [] },
    uses: undefined,
    unlocked: true,
    inheritable: true,
  });
}

function removeAbility(index: number) {
  form.abilities?.splice(index, 1);
}

function addBonus(ab: CharacterAbility) {
  if (!ab.effect.checkBonus) ab.effect.checkBonus = [];
  ab.effect.checkBonus.push({ skill: '', value: 1 });
}

function removeBonus(ab: CharacterAbility, index: number) {
  ab.effect.checkBonus?.splice(index, 1);
}

function setUses(ab: CharacterAbility, max: number) {
  if (!max) {
    ab.uses = undefined;
    return;
  }
  ab.uses = { max, recharge: ab.uses?.recharge ?? 'scene' };
}

function setRecharge(ab: CharacterAbility, recharge: string) {
  if (!ab.uses) return;
  ab.uses.recharge = recharge as CharacterAbility['uses'] extends undefined ? never : 'scene' | 'turn' | 'session';
}

function setCost(ab: CharacterAbility, key: 'san' | 'hp' | 'mp', value: number) {
  if (!ab.effect.cost) ab.effect.cost = {};
  if (!value) delete ab.effect.cost[key];
  else ab.effect.cost[key] = value;
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container-narrow">
      <header class="wt-page-head">
        <mdui-button-icon icon="arrow_back" @click="router.push('/characters')" />
        <div>
          <h1 class="wt-page-title">{{ form.name || '角色' }}</h1>
          <p class="wt-muted wt-small">字段与 SillyTavern V2 一一对应，可直接导入导出。</p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="text" icon="delete" @click="removeChar">删除</mdui-button>
        <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <template v-else>
        <mdui-tabs :value="activeTab" variant="secondary" class="wt-tabs" @change="activeTab = evValue($event)">
          <mdui-tab value="basic">基本</mdui-tab>
          <mdui-tab value="prompt">演出</mdui-tab>
          <mdui-tab value="greetings">问候语</mdui-tab>
          <mdui-tab value="sheet">跑团面板</mdui-tab>
          <mdui-tab value="abilities">能力</mdui-tab>
          <mdui-tab value="abilities">能力</mdui-tab>
        </mdui-tabs>

        <!-- 基本 -->
        <section v-if="activeTab === 'basic'" class="wt-form">
          <div class="wt-avatar-row">
            <div class="wt-avatar-preview-wrap">
              <WtAvatar
                :image="form.avatarImage"
                :icon="form.avatarIcon"
                :color="form.avatarColor"
                :size="96"
              />
              <input
                ref="avatarFileInput"
                type="file"
                accept="image/*"
                class="wt-hidden-file"
                @change="onPickAvatar"
              />
              <div class="wt-avatar-preview-actions">
                <mdui-button variant="tonal" :disabled="avatarUploading" @click="avatarFileInput?.click()">
                  {{ avatarUploading ? '上传中…' : form.avatarImage ? '换图片' : '上传图片' }}
                </mdui-button>
                <mdui-button v-if="form.avatarImage" variant="text" @click="clearAvatar">移除</mdui-button>
              </div>
              <p class="wt-small wt-muted wt-avatar-hint">
                有图片时优先显示图片；没有就用下面的图标 + 底色。
              </p>
            </div>
            <div class="wt-avatar-controls">
              <div class="wt-label">图标（Material Icons）</div>
              <div class="wt-icon-grid">
                <button
                  v-for="ic in CHARACTER_ICONS"
                  :key="ic"
                  class="wt-icon-opt"
                  :class="{ active: form.avatarIcon === ic }"
                  :title="ic"
                  @click="form.avatarIcon = ic"
                >
                  <span class="material-icons-outlined">{{ ic }}</span>
                </button>
              </div>
              <div class="wt-label" style="margin-top: 10px">底色</div>
              <div class="wt-color-row">
                <button
                  v-for="c in avatarColors"
                  :key="c"
                  class="wt-swatch"
                  :class="{ active: form.avatarColor === c }"
                  :style="{ background: c }"
                  @click="form.avatarColor = c"
                ></button>
              </div>
            </div>
          </div>

          <div class="wt-form-row">
            <mdui-text-field v-model="form.name" label="角色名" variant="outlined" required></mdui-text-field>
            <mdui-text-field v-model="form.creatorNotes" label="备注（creator_notes，仅作者可见）" variant="outlined"></mdui-text-field>
          </div>

          <mdui-text-field
            v-model="form.description"
            label="角色描述（description）"
            helper="外貌、身份、经历。这段会完整进入系统提示。"
            variant="outlined"
            rows="6"
            autosize
            max-rows="16"
          ></mdui-text-field>

          <div class="wt-form-row">
            <mdui-text-field v-model="form.creator" label="作者（creator）" variant="outlined"></mdui-text-field>
            <mdui-text-field v-model="form.characterVersion" label="版本" variant="outlined"></mdui-text-field>
          </div>

          <mdui-text-field v-model="tagsText" label="标签（顿号分隔）" variant="outlined"></mdui-text-field>

          <mdui-checkbox :checked="form.isPlayer" @change="form.isPlayer = ($event.target as any).checked">
            这是玩家角色（调查员）
          </mdui-checkbox>
        </section>

        <!-- 演出 -->
        <section v-else-if="activeTab === 'prompt'" class="wt-form">
          <mdui-text-field
            v-model="form.personality"
            label="性格（personality）"
            variant="outlined"
            rows="3"
            autosize
          ></mdui-text-field>
          <mdui-text-field
            v-model="form.scenario"
            label="处境（scenario）"
            variant="outlined"
            rows="3"
            autosize
          ></mdui-text-field>
          <mdui-text-field
            v-model="form.mesExample"
            label="台词示例（mes_example）"
            helper="用 <START> 分隔多段示例对话"
            variant="outlined"
            rows="6"
            autosize
            max-rows="16"
          ></mdui-text-field>
          <mdui-text-field
            v-model="form.systemPrompt"
            label="系统提示（system_prompt）"
            variant="outlined"
            rows="4"
            autosize
          ></mdui-text-field>
          <mdui-text-field
            v-model="form.postHistoryInstructions"
            label="历史后指令（post_history_instructions）"
            helper="追加在对话历史之后，用于强约束演出风格"
            variant="outlined"
            rows="3"
            autosize
          ></mdui-text-field>

          <div class="wt-field">
            <div class="wt-label">绑定世界书（character_book）</div>
            <mdui-select :value="form.characterBookId ?? ''" variant="outlined" placeholder="不绑定" @change="form.characterBookId = evValue($event) || null">
              <mdui-menu-item :value="null">不绑定</mdui-menu-item>
              <mdui-menu-item v-for="b in catalog.books" :key="b.id" :value="b.id">{{ b.name }}</mdui-menu-item>
            </mdui-select>
          </div>
        </section>

        <!-- 问候语 -->
        <section v-else-if="activeTab === 'greetings'" class="wt-form">
          <mdui-text-field
            v-model="form.firstMes"
            label="开场白（first_mes）"
            helper="创建世界线时作为第一条消息显示"
            variant="outlined"
            rows="5"
            autosize
            max-rows="14"
          ></mdui-text-field>
          <mdui-text-field
            v-model="altGreetingsText"
            label="备选开场（alternate_greetings，用 --- 分隔）"
            variant="outlined"
            rows="6"
            autosize
            max-rows="18"
          ></mdui-text-field>
        </section>

        <!-- 面板 -->
        <section v-else-if="activeTab === 'sheet'" class="wt-form">
          <div class="wt-row">
            <div>
              <strong>角色面板</strong>
              <p class="wt-small wt-muted" style="margin: 2px 0 0">
                面板的结构由规则书决定。换一本规则书，这里能填的字段就跟着变。
              </p>
            </div>
            <div class="wt-spacer"></div>
            <mdui-button v-if="!form.sheet" variant="tonal" icon="add" @click="enableSheet">启用面板</mdui-button>
            <template v-else>
              <mdui-button variant="outlined" icon="casino" @click="rollSheet">随机生成</mdui-button>
              <mdui-button variant="text" icon="close" @click="enableSheet">移除</mdui-button>
            </template>
          </div>

          <!-- 规则书选择器 -->
          <div class="wt-field">
            <div class="wt-label">使用的规则书</div>
            <p class="wt-small wt-muted" style="margin: 2px 0 8px">
              决定这份面板有哪些属性、资源与技能。切换时已有的值会尽量保留，不会清空。
            </p>
            <div class="wt-pack-select-row">
              <mdui-select
                :value="form.sheet?.rulePackId ?? sheetPackId ?? ''"
                variant="outlined"
                class="wt-pack-select"
                placeholder="选择规则书"
                @change="switchSheetPack(evValue($event))"
              >
                <mdui-menu-item v-for="p in sheetPacks" :key="p.id" :value="p.id">
                  {{ p.name }}
                </mdui-menu-item>
              </mdui-select>
              <mdui-button
                variant="text"
                icon="menu_book"
                @click="openCodex(form.sheet?.rulePackId ?? sheetPackId ?? undefined)"
              >
                查看规则
              </mdui-button>
            </div>
            <p v-if="sheetPack" class="wt-small wt-muted" style="margin: 6px 0 0">
              {{ sheetPack.description }}
            </p>
            <div v-if="!sheetPacks.length" class="wt-empty-inline">
              还没有声明角色面板的规则书。在 content/rulepacks/ 放一个带 sheetSchema 的插件，同步内容后就会出现在这里。
            </div>
          </div>

          <template v-if="form.sheet">
            <!-- 资源 -->
            <div v-if="sheetResources.length" class="wt-field">
              <div class="wt-label">{{ schema?.resourceLabel || '状态' }}</div>
              <div class="wt-res-grid">
                <div v-for="r in sheetResources" :key="r.key" class="wt-res-box">
                  <div class="wt-res-head">
                    <span class="wt-res-label">{{ r.label }}</span>
                    <span v-if="r.derivedMax" class="wt-res-derived" title="上限由属性推导，改属性会自动重算">自动</span>
                  </div>
                  <div class="wt-res-inputs">
                    <input
                      :value="r.cur"
                      type="number"
                      class="wt-num-input"
                      @change="setRes(r.key, ($event.target as HTMLInputElement).valueAsNumber)"
                    />
                    <span class="wt-res-slash">/</span>
                    <input
                      :value="r.max"
                      type="number"
                      class="wt-num-input"
                      @change="setResMax(r.key, ($event.target as HTMLInputElement).valueAsNumber)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- 属性 -->
            <div v-if="sheetAttrs.length" class="wt-field">
              <div class="wt-label">{{ schema?.attrLabel || '属性' }}</div>
              <div class="wt-attr-grid">
                <div v-for="a in sheetAttrs" :key="a.key" class="wt-attr-box" :title="a.hint">
                  <div class="wt-attr-label">{{ a.label }}<span class="wt-attr-key">{{ a.abbr }}</span></div>
                  <input
                    :value="a.value"
                    type="number"
                    :min="a.min"
                    :max="a.max"
                    class="wt-num-input"
                    @change="setAttr(a.key, ($event.target as HTMLInputElement).valueAsNumber)"
                  />
                </div>
              </div>
            </div>

            <!-- 派生项（只读） -->
            <div v-if="sheetDerived.length" class="wt-field">
              <div class="wt-label">衍生数值</div>
              <div class="wt-derived wt-small wt-muted">
                <span v-for="d in sheetDerived" :key="d.key" class="wt-derived-item">
                  {{ d.label }} <strong>{{ d.text }}</strong>
                </span>
              </div>
            </div>

            <!-- 技能 -->
            <div class="wt-field">
              <div class="wt-row">
                <div class="wt-label">技能</div>
                <div class="wt-spacer"></div>
                <mdui-button v-if="freeSkills" variant="text" icon="add" @click="addSkill">新增技能</mdui-button>
              </div>
              <div v-if="!form.sheet.skills.length" class="wt-empty-inline">
                这本规则书还没有技能条目，点「新增技能」加一条。
              </div>
              <div class="wt-skill-editor">
                <div v-for="(s, i) in form.sheet.skills" :key="i" class="wt-skill-row">
                  <input v-model="s.name" class="wt-text-input" />
                  <input
                    v-model.number="s.value"
                    type="number"
                    min="0"
                    :max="skillMax"
                    class="wt-num-input wt-num-sm"
                  />
                  <mdui-button-icon
                    icon="restart_alt"
                    small
                    title="重置为该技能的基准值"
                    @click="resetSkill(i)"
                  />
                  <mdui-button-icon icon="close" small @click="removeSkill(i)" />
                </div>
              </div>
            </div>

            <div class="wt-form-row">
              <mdui-text-field
                :model-value="form.sheet.conditions.join('、')"
                label="状态标签"
                variant="outlined"
                @input="form.sheet.conditions = ($event.target as any).value.split(/[、,，]+/).map((s: string) => s.trim()).filter(Boolean)"
              ></mdui-text-field>
            </div>
            <mdui-text-field
              :model-value="form.sheet.items.join('、')"
              label="随身物品"
              variant="outlined"
              @input="form.sheet.items = ($event.target as any).value.split(/[、,，]+/).map((s: string) => s.trim()).filter(Boolean)"
            ></mdui-text-field>
          </template>
        </section>

        <!-- 能力（金手指） -->
        <section v-else class="wt-form">
          <div class="wt-row">
            <div>
              <strong>能力 / 金手指</strong>
              <p class="wt-small wt-muted" style="margin: 2px 0 0">
                这里定义的能力会被引擎真正计算：检定加值会加进掷骰，代价会真的扣除，次数会真的消耗。
              </p>
            </div>
            <div class="wt-spacer"></div>
            <mdui-button variant="tonal" icon="add" @click="addAbility">新增能力</mdui-button>
          </div>

          <div v-if="!form.abilities?.length" class="wt-empty-inline">
            还没有能力。给这个角色加一条「金手指」，比如「蛇佬腔：能与蛇交谈，社交检定 +2，每场景 3 次」。
          </div>

          <article v-for="(ab, i) in form.abilities" :key="ab.id" class="wt-ability-card">
            <header class="wt-ability-head">
              <span class="material-icons-outlined">{{ ABILITY_KIND_ICONS[ab.kind] }}</span>
              <strong>{{ ab.name || '未命名能力' }}</strong>
              <div class="wt-spacer"></div>
              <mdui-button-icon icon="delete" @click="removeAbility(i)" aria-label="删除能力"></mdui-button-icon>
            </header>

            <div class="wt-grid-2">
              <mdui-text-field
                :value="ab.name"
                label="名称"
                variant="outlined"
                @input="ab.name = evValueRaw($event)"
              ></mdui-text-field>
              <mdui-select
                :value="ab.kind"
                label="类型"
                variant="outlined"
                @change="ab.kind = evValue($event) as any"
              >
                <mdui-menu-item v-for="k in ABILITY_KINDS" :key="k.value" :value="k.value">
                  {{ k.label }}
                </mdui-menu-item>
              </mdui-select>
            </div>

            <mdui-text-field
              :value="ab.description"
              label="说明（会写进提示词）"
              variant="outlined"
              rows="2"
              autosize
              max-rows="6"
              @input="ab.description = evValueRaw($event)"
            ></mdui-text-field>

            <div class="wt-sub-head">
              <span>检定加值</span>
              <mdui-button variant="text" icon="add" @click="addBonus(ab)">加一条</mdui-button>
            </div>
            <div v-for="(b, bi) in ab.effect.checkBonus" :key="bi" class="wt-bonus-row">
              <mdui-text-field
                :value="b.skill"
                label="技能（* 表示全部）"
                variant="outlined"
                @input="b.skill = evValueRaw($event)"
              ></mdui-text-field>
              <mdui-text-field
                type="number"
                :value="String(b.value)"
                label="加值"
                variant="outlined"
                @input="b.value = Number(evValueRaw($event)) || 0"
              ></mdui-text-field>
              <mdui-button-icon icon="remove" @click="removeBonus(ab, bi)" aria-label="删除"></mdui-button-icon>
            </div>

            <div class="wt-grid-3">
              <mdui-text-field
                type="number"
                :value="String(ab.uses?.max ?? 0)"
                label="次数上限（0=不限）"
                variant="outlined"
                @input="setUses(ab, Number(evValueRaw($event)) || 0)"
              ></mdui-text-field>
              <mdui-select
                :value="ab.uses?.recharge ?? 'scene'"
                label="恢复周期"
                variant="outlined"
                @change="setRecharge(ab, evValue($event))"
              >
                <mdui-menu-item value="scene">每场景</mdui-menu-item>
                <mdui-menu-item value="turn">每回合</mdui-menu-item>
                <mdui-menu-item value="session">每局</mdui-menu-item>
              </mdui-select>
              <mdui-text-field
                type="number"
                :value="String(ab.effect.cost?.san ?? 0)"
                label="代价：理智"
                variant="outlined"
                @input="setCost(ab, 'san', Number(evValueRaw($event)) || 0)"
              ></mdui-text-field>
            </div>

            <div class="wt-switch-row">
              <mdui-checkbox :checked="ab.unlocked" @change="ab.unlocked = evChecked($event)">已解锁</mdui-checkbox>
              <mdui-checkbox :checked="ab.inheritable !== false" @change="ab.inheritable = evChecked($event)">
                可被续作继承
              </mdui-checkbox>
            </div>
          </article>
        </section>

        <div class="wt-save-bar">
          <mdui-button variant="outlined" @click="router.push('/characters')">返回</mdui-button>
          <mdui-button variant="filled" icon="save" :loading="saving" @click="save">保存</mdui-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wt-ability-card {
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wt-ability-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wt-ability-head .material-icons-outlined {
  color: rgb(var(--mdui-color-primary));
}

.wt-sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-bonus-row {
  display: grid;
  grid-template-columns: 1fr 110px auto;
  gap: 8px;
  align-items: center;
}

.wt-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.wt-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.wt-switch-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.wt-empty-inline {
  padding: 24px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  border-radius: 14px;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.875rem;
  line-height: 1.7;
  text-align: center;
}
.wt-page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.wt-page-title {
  font-size: 1.375rem;
  margin: 0;
}

.wt-page-head p {
  margin: 2px 0 0;
}

.wt-tabs {
  margin-bottom: 20px;
}

.wt-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wt-form-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.wt-form-row > * {
  flex: 1;
  min-width: 130px;
}

.wt-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wt-avatar-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.wt-avatar-preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  width: 150px;
}

.wt-avatar-preview-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.wt-avatar-hint {
  text-align: center;
  line-height: 1.4;
}

.wt-hidden-file {
  display: none;
}

.wt-avatar-controls {
  flex: 1;
  min-width: 240px;
}

.wt-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.wt-icon-opt {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  display: grid;
  place-items: center;
}

.wt-icon-opt:hover {
  background: rgba(var(--mdui-color-on-surface), 0.06);
}

.wt-icon-opt.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.12);
  color: rgb(var(--mdui-color-primary));
}

.wt-icon-opt .material-icons-outlined {
  font-size: 1.125rem;
}

.wt-color-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.wt-swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.wt-swatch.active {
  border-color: rgb(var(--mdui-color-on-surface));
  box-shadow: 0 0 0 2px rgb(var(--mdui-color-surface));
}

.wt-attr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.wt-attr-box {
  background: rgb(var(--mdui-color-surface-container-low));
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-attr-label {
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  display: flex;
  justify-content: space-between;
}

.wt-attr-key {
  opacity: 0.5;
  font-size: 0.625rem;
}

.wt-num-input,
.wt-text-input {
  border: 1px solid rgba(var(--mdui-color-outline), 0.5);
  background: rgb(var(--mdui-color-surface));
  color: rgb(var(--mdui-color-on-surface));
  border-radius: 9px;
  padding: 6px 10px;
  font-family: inherit;
  font-size: 0.875rem;
  width: 100%;
  outline: none;
}

.wt-num-input:focus,
.wt-text-input:focus {
  border-color: rgb(var(--mdui-color-primary));
}

.wt-num-sm {
  max-width: 76px;
}

.wt-derived {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.wt-derived-item strong {
  color: rgb(var(--mdui-color-primary));
  font-variant-numeric: tabular-nums;
}

/* 规则书选择器 */
.wt-pack-select-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.wt-pack-select {
  flex: 1 1 260px;
  min-width: 200px;
}

/* 资源编辑 */
.wt-res-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.wt-res-box {
  background: rgb(var(--mdui-color-surface-container-low));
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-res-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-res-derived {
  font-size: 0.625rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--mdui-color-primary), 0.14);
  color: rgb(var(--mdui-color-primary));
}

.wt-res-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wt-res-slash {
  opacity: 0.4;
}

.wt-skill-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
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
</style>




