<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { LlmConfig } from '@worldtree/shared';
import { api, type AccountUser, type SafetySettings } from '@/api';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { showAlert, toast, evValue, evChecked, askConfirm, askText } from '@/utils/ui';
import { PALETTES } from '@/theme/palette';

const ui = useAppStore();
const auth = useAuthStore();

const isAdmin = computed(() => auth.isAdmin);
const me = computed(() => auth.user);

const themeMode = computed(() => ui.prefs.theme);
const accentColor = computed(() => ui.prefs.color);
const fontScale = computed(() => ui.prefs.fontScale);
const readerWidth = computed(() => ui.prefs.readerWidth);
const showMeta = computed(() => ui.prefs.showMeta);
const paletteId = computed(() => ui.prefs.palette);
const iconStyle = computed(() => ui.prefs.iconStyle);

const cfg = reactive<LlmConfig>({
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 2048,
  contextWindow: 12288,
  numCtx: 12288,
  disableThinking: true,
  presencePenalty: 0.1,
  frequencyPenalty: 0.1,
  contextBudget: 24000,
  timeoutMs: 120000,
  extraHeaders: '',
  extraBody: '',
  stream: true,
});

const providers = ref<{ id: string; name: string; baseUrl: string; model: string; hint: string }[]>([]);
const models = ref<string[]>([]);
const testing = ref(false);
const saving = ref(false);
const testResult = ref<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
const detecting = ref(false);
const probe = ref<{ window: number; source: string } | null>(null);
const loading = ref(true);
const activeTab = ref('model');

const colors = ['#4f6f52', '#3f5b6b', '#5a4a63', '#7a4a3a', '#3a5a7a', '#6b5b3a', '#4a4a5a', '#7a3a4a'];

/* ---------------- 账号管理（admin） ---------------- */
const users = ref<AccountUser[]>([]);
const usersLoading = ref(false);
const newUser = ref({ username: '', password: '', displayName: '', role: 'user' as 'admin' | 'user' });

/* ---------------- 内容安全（admin） ---------------- */
const safety = ref<SafetySettings>({
  allowMature: false,
  allowExplicit: false,
  customRedLines: [],
  showToPlayer: false,
});
const redLinesText = ref('');
const safetySaving = ref(false);

/* ---------------- 改自己的密码 ---------------- */
const pw = ref({ oldPassword: '', newPassword: '', confirm: '' });
const pwSaving = ref(false);

async function loadUsers() {
  if (!isAdmin.value) return;
  usersLoading.value = true;
  try {
    const res = await api.listUsers();
    users.value = res.items;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    usersLoading.value = false;
  }
}

async function loadSafety() {
  try {
    const s = await api.getSafety();
    Object.assign(safety.value, s);
    redLinesText.value = (s.customRedLines ?? []).join('\n');
  } catch {
    /* 读接口失败不影响页面其余部分 */
  }
}

async function createAccount() {
  if (!newUser.value.username.trim() || !newUser.value.password) {
    toast('账号和密码都要填');
    return;
  }
  try {
    await api.createUser({
      username: newUser.value.username.trim(),
      password: newUser.value.password,
      role: newUser.value.role,
      displayName: newUser.value.displayName.trim() || undefined,
    });
    toast('账号已创建');
    newUser.value.username = '';
    newUser.value.password = '';
    newUser.value.displayName = '';
    newUser.value.role = 'user';
    await loadUsers();
  } catch (err) {
    toast((err as Error).message);
  }
}

async function toggleUser(u: AccountUser) {
  try {
    await api.updateUser(u.id, { disabled: !u.disabled });
    await loadUsers();
  } catch (err) {
    toast((err as Error).message);
  }
}

async function resetUserPassword(u: AccountUser) {
  const next = await askText(`重置「${u.username}」的密码`, '', '至少 6 位。重置后该账号会被强制下线。');
  if (!next) return;
  try {
    await api.updateUser(u.id, { password: next });
    toast('密码已重置');
  } catch (err) {
    toast((err as Error).message);
  }
}

async function removeUser(u: AccountUser) {
  const ok = await askConfirm(`删除账号「${u.username}」？`, '账号会被删除，但它创建的世界线与存档会保留（变为无主）。');
  if (!ok) return;
  try {
    await api.deleteUser(u.id);
    await loadUsers();
  } catch (err) {
    toast((err as Error).message);
  }
}

async function saveSafetySettings() {
  safetySaving.value = true;
  try {
    safety.value.customRedLines = redLinesText.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const next = await api.saveSafety(safety.value);
    Object.assign(safety.value, next);
    toast('内容安全设置已保存');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    safetySaving.value = false;
  }
}

async function changeMyPassword() {
  if (pw.value.newPassword.length < 6) {
    toast('新密码至少 6 位');
    return;
  }
  if (pw.value.newPassword !== pw.value.confirm) {
    toast('两次输入的新密码不一致');
    return;
  }
  pwSaving.value = true;
  try {
    await auth.changePassword(pw.value.oldPassword, pw.value.newPassword);
    await showAlert('密码已修改', '所有设备上的登录都已失效，请用新密码重新登录。');
    location.href = '/login';
  } catch (err) {
    toast((err as Error).message);
  } finally {
    pwSaving.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const tasks: Promise<unknown>[] = [api.getProviders().then((p) => (providers.value = p))];
    // 模型配置只有 admin 能读：普通用户跳过，避免 403 刷错误提示
    if (isAdmin.value) {
      tasks.push(
        api.getLlm().then((c) => {
          Object.assign(cfg, c);
          const withProbe = c as typeof c & { probe?: { window: number; source: string } | null };
          if (withProbe.probe) probe.value = withProbe.probe;
        }),
      );
    }
    tasks.push(loadSafety());
    await Promise.all(tasks);
    await loadUsers();
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function applyPreset(id: string) {
  const p = providers.value.find((x) => x.id === id);
  if (!p) return;
  cfg.provider = p.id;
  cfg.baseUrl = p.baseUrl;
  if (!cfg.model || cfg.model.startsWith('gpt-4o')) cfg.model = p.model;
  toast(`已套用 ${p.name} 预设，别忘了填写 API Key`);
}

async function detectWindow() {
  detecting.value = true;
  try {
    const res = await api.detectLlmContext();
    probe.value = res.probe;
    if (res.probe) {
      toast(`真实可用上下文：${res.probe.window} tokens（${res.probe.source}）`);
      if (res.effective !== res.declared) {
        toast(`提示词预算已按探测结果收到 ${res.effective} tokens`);
      }
    } else {
      toast('没识别出本地推理服务的上下文，请手动填写');
    }
  } catch (err) {
    toast((err as Error).message);
  } finally {
    detecting.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    await api.saveLlm({ ...cfg });
    toast('模型配置已保存');
  } catch (err) {
    toast((err as Error).message);
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    await api.saveLlm({ ...cfg });
    const res = await api.testLlm({ ...cfg });
    testResult.value = { ok: res.ok, message: res.message, latencyMs: res.latencyMs };
    if (res.models?.length) models.value = res.models;
  } catch (err) {
    testResult.value = { ok: false, message: (err as Error).message };
  } finally {
    testing.value = false;
  }
}

async function fetchModels() {
  try {
    const res = await api.listModels({ ...cfg });
    models.value = res.models;
    toast(`获取到 ${res.models.length} 个模型`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function savePrefs(patch: Record<string, unknown>) {
  await ui.save(patch as never);
}

async function showHelp() {
  await showAlert(
    '如何接入模型？',
    `远程：填 Base URL（如 https://api.deepseek.com/v1）、API Key、模型名。
本地：Ollama 用 http://127.0.0.1:11434/v1，LM Studio 用 http://127.0.0.1:1234/v1，Key 可留空。
任何兼容 OpenAI /chat/completions 协议的服务都可以直接填。`,
  );
}

onMounted(load);
</script>

<template>
  <div class="wt-page">
    <div class="wt-container-narrow">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">设置</h1>
          <p class="wt-muted">模型接入、阅读体验与账号。</p>
        </div>
      </header>

      <mdui-tabs :value="activeTab" variant="secondary" class="wt-tabs" @change="activeTab = evValue($event)">
        <mdui-tab v-if="isAdmin" value="model">模型接入</mdui-tab>
        <mdui-tab value="reading">阅读体验</mdui-tab>
        <mdui-tab value="account">账号</mdui-tab>
        <mdui-tab v-if="isAdmin" value="safety">内容安全</mdui-tab>
        <mdui-tab value="about">关于</mdui-tab>
      </mdui-tabs>

      <!-- 模型 -->
      <section v-if="activeTab === 'model' && isAdmin" class="wt-form">
        <div class="wt-card">
          <div class="wt-row">
            <div>
              <strong>服务商预设</strong>
              <p class="wt-small wt-muted" style="margin: 2px 0 0">
                选一个预设会自动填好 Base URL 与常用模型名，你可以随意改。
              </p>
            </div>
            <div class="wt-spacer"></div>
            <mdui-button variant="text" icon="help" @click="showHelp">怎么填？</mdui-button>
          </div>
          <div class="wt-preset-grid">
            <button
              v-for="p in providers"
              :key="p.id"
              class="wt-preset"
              :class="{ active: cfg.provider === p.id }"
              @click="applyPreset(p.id)"
            >
              <strong>{{ p.name }}</strong>
              <span class="wt-small wt-muted">{{ p.hint }}</span>
            </button>
          </div>
        </div>

        <div class="wt-card wt-form">
          <mdui-text-field
            v-model="cfg.baseUrl"
            label="Base URL"
            variant="outlined"
            helper="例如 https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1"
          ></mdui-text-field>
          <mdui-text-field
            v-model="cfg.apiKey"
            label="API Key"
            variant="outlined"
            type="password"
            toggle-password
            helper="本地模型可以留空"
          ></mdui-text-field>
          <div class="wt-row">
            <mdui-text-field v-model="cfg.model" label="模型名" variant="outlined" class="wt-flex1"></mdui-text-field>
            <mdui-button variant="outlined" icon="download" @click="fetchModels">获取列表</mdui-button>
          </div>
          <mdui-select
            v-if="models.length"
            :value="cfg.model"
            label="从可用模型中选择"
            variant="outlined"
            @change="cfg.model = evValue($event)"
          >
            <mdui-menu-item v-for="m in models" :key="m" :value="m">{{ m }}</mdui-menu-item>
          </mdui-select>
          <div class="wt-row">
            <mdui-button variant="filled" icon="save" :loading="saving" @click="saveConfig">保存配置</mdui-button>
            <mdui-button variant="tonal" icon="wifi_tethering" :loading="testing" @click="testConnection">
              测试连接
            </mdui-button>
          </div>
          <div v-if="testResult" class="wt-test-result" :class="testResult.ok ? 'ok' : 'bad'">
            <span class="material-icons-outlined">{{ testResult.ok ? 'check_circle' : 'error' }}</span>
            <div>
              <strong>{{ testResult.ok ? '连接成功' : '连接失败' }}</strong>
              <div class="wt-small">{{ testResult.message }}</div>
              <div v-if="testResult.latencyMs" class="wt-small wt-muted">耗时 {{ testResult.latencyMs }} ms</div>
            </div>
          </div>
        </div>

        <div class="wt-card wt-form">
          <div class="wt-label">生成参数</div>
          <div class="wt-slider-row">
            <span>温度 {{ cfg.temperature.toFixed(2) }}</span>
            <mdui-slider
              :value="cfg.temperature"
              min="0"
              max="2"
              step="0.05"
              @change="cfg.temperature = Number(($event.target as HTMLInputElement).value)"
            ></mdui-slider>
          </div>
          <div class="wt-slider-row">
            <span>Top P {{ cfg.topP.toFixed(2) }}</span>
            <mdui-slider
              :value="cfg.topP"
              min="0"
              max="1"
              step="0.05"
              @change="cfg.topP = Number(($event.target as HTMLInputElement).value)"
            ></mdui-slider>
          </div>
          <div class="wt-form-row">
            <mdui-text-field
              v-model.number="cfg.maxTokens"
              type="number"
              label="最大输出 tokens"
              variant="outlined"
              helper="建议不超过上下文窗口的 1/3"
            ></mdui-text-field>
            <mdui-text-field
              v-model.number="cfg.contextWindow"
              type="number"
              label="模型上下文窗口（tokens）"
              variant="outlined"
              helper="提示词预算按这个值裁剪。Ollama 用户请同时填下面的 num_ctx，两边一致才不会截断。"
            ></mdui-text-field>
            <mdui-text-field
              v-model.number="cfg.numCtx"
              type="number"
              label="Ollama num_ctx（仅本地 Ollama）"
              variant="outlined"
              helper="走 /api/chat 原生接口下发，真正决定服务端分配多少上下文。留空则沿用上面的上下文窗口。"
            ></mdui-text-field>
            <mdui-text-field
              v-model.number="cfg.contextBudget"
              type="number"
              label="上下文字符预算"
              variant="outlined"
            ></mdui-text-field>
            <mdui-text-field
              v-model.number="cfg.timeoutMs"
              type="number"
              label="超时（毫秒）"
              variant="outlined"
            ></mdui-text-field>
          </div>
          <div class="wt-probe-row">
            <mdui-button variant="tonal" :loading="detecting" @click="detectWindow">
              <span class="material-icons-outlined" slot="icon">radar</span>
              探测真实上下文
            </mdui-button>
            <div v-if="probe" class="wt-small wt-muted">
              {{ probe.source }} → 每个请求实际可用 <strong>{{ probe.window }}</strong> tokens
            </div>
            <div v-else class="wt-small wt-muted">
              探测不到本地推理服务（llama.cpp / Ollama）。云端模型忽略此项。
            </div>
          </div>
          <mdui-switch :checked="cfg.stream" @change="cfg.stream = evChecked($event)">
            启用流式输出
          </mdui-switch>
          <mdui-switch
            :checked="!!cfg.disableThinking"
            helper="推理模型（Qwen3 / DeepSeek-R1 等）的思考 token 会吃掉输出预算，导致 JSON 写不完、选项丢失。建议保持开启。"
            @change="cfg.disableThinking = evChecked($event)"
          >
            关闭模型思考链
          </mdui-switch>
          <mdui-text-field
            v-model="cfg.extraHeaders"
            label="额外请求头（JSON，可选）"
            variant="outlined"
            rows="2"
            autosize
          ></mdui-text-field>
          <mdui-text-field
            v-model="cfg.extraBody"
            label="额外请求体字段（JSON，可选）"
            variant="outlined"
            rows="2"
            autosize
          ></mdui-text-field>
        </div>
      </section>

      <!-- 阅读体验 -->
      <section v-else-if="activeTab === 'reading'" class="wt-form">
        <div class="wt-card wt-form">
          <div class="wt-label">主题</div>
          <div class="wt-theme-row">
            <button
              v-for="t in [
                { k: 'light', label: '浅色', icon: 'light_mode' },
                { k: 'dark', label: '深色', icon: 'dark_mode' },
                { k: 'auto', label: '跟随系统', icon: 'brightness_auto' },
              ]"
              :key="t.k"
              class="wt-theme-btn"
              :class="{ active: themeMode === t.k }"
              @click="savePrefs({ theme: t.k })"
            >
              <span class="material-icons-outlined">{{ t.icon }}</span>
              {{ t.label }}
            </button>
          </div>

          <div class="wt-label" style="margin-top: 12px">Material You 配色</div>
          <p class="wt-small wt-muted" style="margin: 2px 0 8px">
            选一个源色，mdui 会据此生成完整的 Material You 调色板。
          </p>
          <div class="wt-palette-row">
            <button
              class="wt-palette"
              :class="{ active: paletteId === 'auto' }"
              @click="savePrefs({ palette: 'auto' })"
            >
              <span class="wt-palette-dot auto" :style="{ background: accentColor }"></span>
              <span class="wt-palette-name">跟随世界封面色</span>
            </button>
            <button
              v-for="p in PALETTES"
              :key="p.id"
              class="wt-palette"
              :class="{ active: paletteId === p.id }"
              :title="p.description"
              @click="savePrefs({ palette: p.id })"
            >
              <span class="wt-palette-dot" :style="{ background: p.seed }"></span>
              <span class="wt-palette-name">{{ p.name }}</span>
            </button>
          </div>

          <div class="wt-label" style="margin-top: 16px">自定义源色</div>
          <div class="wt-color-row">
            <button
              v-for="c in colors"
              :key="c"
              class="wt-swatch"
              :class="{ active: accentColor === c }"
              :style="{ background: c }"
              @click="savePrefs({ palette: 'custom', color: c })"
            ></button>
            <input
              class="wt-color-input"
              type="color"
              :value="accentColor"
              @change="savePrefs({ palette: 'custom', color: ($event.target as HTMLInputElement).value })"
            />
          </div>

          <div class="wt-label" style="margin-top: 16px">图标风格（Material Icons）</div>
          <div class="wt-iconstyle-row">
            <button
              v-for="s in [
                { k: 'outlined', label: 'Outlined', cls: 'material-icons-outlined' },
                { k: 'filled', label: 'Filled', cls: 'material-icons' },
                { k: 'round', label: 'Round', cls: 'material-icons-outlined' },
              ]"
              :key="s.k"
              class="wt-iconstyle"
              :class="{ active: iconStyle === s.k }"
              @click="savePrefs({ iconStyle: s.k })"
            >
              <span :class="s.cls">auto_stories</span>
              <span class="wt-small">{{ s.label }}</span>
            </button>
          </div>

          <div class="wt-slider-row" style="margin-top: 16px">
            <span>正文字号 {{ Math.round(fontScale * 100) }}%</span>
            <mdui-slider
              :value="fontScale"
              min="0.8"
              max="1.5"
              step="0.05"
              @change="savePrefs({ fontScale: Number(($event.target as HTMLInputElement).value) })"
            ></mdui-slider>
          </div>
          <div class="wt-slider-row">
            <span>正文宽度 {{ readerWidth }}px</span>
            <mdui-slider
              :value="readerWidth"
              min="560"
              max="1100"
              step="20"
              @change="savePrefs({ readerWidth: Number(($event.target as HTMLInputElement).value) })"
            ></mdui-slider>
          </div>

          <label class="wt-switch-row">
            <div>
              <strong>显示元数据</strong>
              <div class="wt-small wt-muted">显示每轮命中的世界书条目与错误信息</div>
            </div>
            <mdui-switch :checked="showMeta" @change="savePrefs({ showMeta: evChecked($event) })"></mdui-switch>
          </label>
        </div>

        <div class="wt-card wt-preview-card">
          <div class="wt-label">预览</div>
          <p class="wt-prose">
            雾在凌晨两点漫过旧码头的铁轨。你踩在湿滑的木板上，手电的光柱被雾吞掉一半，只能照亮三米。远处传来一声汽笛——低沉、悠长，不属于任何一艘靠港的船。
          </p>
        </div>
      </section>

      <!-- 账号 -->
      <section v-else-if="activeTab === 'account'" class="wt-form">
        <div class="wt-card wt-form">
          <div>
            <strong>我的账号</strong>
            <p class="wt-small wt-muted" style="margin: 2px 0 0">
              {{ me?.displayName }}（@{{ me?.username }}）
              <span v-if="isAdmin" class="wt-pill" style="margin-left: 6px">管理员</span>
            </p>
          </div>
          <div class="wt-form-row">
            <mdui-text-field
              v-model="pw.oldPassword"
              type="password"
              variant="outlined"
              label="当前密码"
              toggle-password
            ></mdui-text-field>
            <mdui-text-field
              v-model="pw.newPassword"
              type="password"
              variant="outlined"
              label="新密码（至少 6 位）"
              toggle-password
            ></mdui-text-field>
            <mdui-text-field
              v-model="pw.confirm"
              type="password"
              variant="outlined"
              label="再输一次新密码"
              toggle-password
            ></mdui-text-field>
          </div>
          <div class="wt-row">
            <div class="wt-spacer"></div>
            <mdui-button variant="filled" :loading="pwSaving" @click="changeMyPassword">修改密码</mdui-button>
          </div>
        </div>

        <div v-if="isAdmin" class="wt-card wt-form">
          <div>
            <strong>账号管理</strong>
            <p class="wt-small wt-muted" style="margin: 2px 0 0">
              只有管理员能创建账号。没有自助注册——这样至少知道自己这台机器上有谁在用。
            </p>
          </div>

          <div class="wt-form-row">
            <mdui-text-field v-model="newUser.username" variant="outlined" label="账号（3-24 位字母数字）"></mdui-text-field>
            <mdui-text-field v-model="newUser.displayName" variant="outlined" label="显示名（可选）"></mdui-text-field>
            <mdui-text-field v-model="newUser.password" type="password" variant="outlined" label="初始密码" toggle-password></mdui-text-field>
            <mdui-select v-model="newUser.role" variant="outlined" label="角色">
              <mdui-menu-item value="user">普通用户</mdui-menu-item>
              <mdui-menu-item value="admin">管理员</mdui-menu-item>
            </mdui-select>
          </div>
          <div class="wt-row">
            <div class="wt-spacer"></div>
            <mdui-button variant="tonal" icon="person_add" @click="createAccount">创建账号</mdui-button>
          </div>

          <div class="wt-divider"></div>

          <div v-if="usersLoading" class="wt-small wt-muted">加载中…</div>
          <div v-else class="wt-user-list">
            <div v-for="u in users" :key="u.id" class="wt-user-row" :class="{ disabled: u.disabled }">
              <div class="wt-user-initial">{{ (u.displayName || u.username).slice(0, 1) }}</div>
              <div class="wt-user-info">
                <div class="wt-user-line">
                  <strong>{{ u.displayName || u.username }}</strong>
                  <span class="wt-small wt-muted">@{{ u.username }}</span>
                  <span v-if="u.role === 'admin'" class="wt-pill">管理员</span>
                  <span v-if="u.disabled" class="wt-pill wt-pill-off">已停用</span>
                </div>
                <div class="wt-small wt-muted">
                  创建于 {{ new Date(u.createdAt).toLocaleDateString() }}
                  <span v-if="u.lastLoginAt"> · 最近登录 {{ new Date(u.lastLoginAt).toLocaleString() }}</span>
                </div>
              </div>
              <div class="wt-user-actions">
                <mdui-button variant="text" @click="resetUserPassword(u)">重置密码</mdui-button>
                <mdui-button variant="text" @click="toggleUser(u)">{{ u.disabled ? '启用' : '停用' }}</mdui-button>
                <mdui-button variant="text" @click="removeUser(u)">删除</mdui-button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 内容安全 -->
      <section v-else-if="activeTab === 'safety' && isAdmin" class="wt-form">
        <div class="wt-card wt-form">
          <div>
            <strong>叙事尺度</strong>
            <p class="wt-small wt-muted" style="margin: 2px 0 0">
              这里控制的是「模型能写多放开」，会作为红线注入系统提示。这是给作者用的旋钮，不是内容审核系统。
            </p>
          </div>

          <mdui-switch :checked="safety.allowMature" @change="safety.allowMature = evChecked($event)">
            允许较大尺度（暴力 / 恐怖 / 成人向主题）
          </mdui-switch>
          <mdui-switch
            :checked="safety.allowExplicit"
            :disabled="!safety.allowMature"
            @change="safety.allowExplicit = evChecked($event)"
          >
            允许露骨性描写（需先打开上一项）
          </mdui-switch>
          <mdui-switch :checked="safety.showToPlayer" @change="safety.showToPlayer = evChecked($event)">
            让玩家也能看到这些红线
          </mdui-switch>

          <mdui-text-field
            v-model="redLinesText"
            variant="outlined"
            label="自定义红线（每行一条）"
            rows="4"
            textarea
          ></mdui-text-field>

          <p class="wt-small wt-muted">
            无论怎么设置，以下底线始终生效：涉及未成年人的性内容、以及任何真实人物的性化描写，一律禁止。
          </p>

          <div class="wt-row">
            <div class="wt-spacer"></div>
            <mdui-button variant="filled" :loading="safetySaving" @click="saveSafetySettings">保存</mdui-button>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section v-else class="wt-form">
        <div class="wt-card wt-about">
          <div class="wt-about-logo">
            <span class="material-icons-round">park</span>
          </div>
          <h2>世界树 · WorldTree</h2>
          <p class="wt-muted">剧本驱动的 AI 互动阅读与跑团平台</p>
          <div class="wt-about-grid">
            <div>
              <div class="wt-label">前端</div>
              <div>Vue 3 + TypeScript + Vite</div>
              <div class="wt-small wt-muted">Material 3 / mdui 组件库</div>
            </div>
            <div>
              <div class="wt-label">后端</div>
              <div>Node.js + TypeScript + Fastify</div>
              <div class="wt-small wt-muted">SQLite（node:sqlite）本地存储</div>
            </div>
            <div>
              <div class="wt-label">模型</div>
              <div>OpenAI 兼容 / Anthropic</div>
              <div class="wt-small wt-muted">支持 Ollama、LM Studio 等本地小模型</div>
            </div>
          </div>
          <p class="wt-small wt-muted wt-about-foot">
            所有剧本、角色卡、世界书与世界线都保存在本机，不会上传到任何地方——除了你自己填的模型接口。
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  margin-bottom: 20px;
}

.wt-page-title {
  font-size: 1.5rem;
  margin: 0 0 4px;
}

.wt-page-head p {
  margin: 0;
  font-size: 0.875rem;
}

.wt-tabs {
  margin-bottom: 20px;
}

/* ---------- 账号管理 ---------- */
.wt-user-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--wt-shape-md);
  transition: background var(--wt-dur-fast) var(--wt-ease-emph);
}

.wt-user-row:hover {
  background: rgba(var(--mdui-color-on-surface), 0.04);
}

.wt-user-row.disabled {
  opacity: 0.55;
}

.wt-user-initial {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--wt-shape-sm);
  font-weight: 700;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-user-info {
  flex: 1;
  min-width: 0;
}

.wt-user-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wt-user-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.wt-pill-off {
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}

/* ---------- 表单 ---------- */
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
  min-width: 150px;
}

.wt-probe-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.wt-flex1 {
  flex: 1;
}

.wt-card.wt-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wt-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.wt-preset {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--wt-shape-sm);
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  font-family: inherit;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--wt-dur-fast) var(--wt-ease-emph),
    background var(--wt-dur-fast) var(--wt-ease-emph),
    border-radius var(--wt-dur) var(--wt-ease-spring);
}

.wt-preset:hover {
  border-radius: var(--wt-shape-md);
}

.wt-preset.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.08);
}

.wt-preset .wt-small {
  line-height: 1.4;
}

.wt-test-result {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--wt-shape-sm);
}

.wt-test-result.ok {
  background: #4caf5024;
  color: #2e7d32;
}

.wt-test-result.bad {
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}

.wt-slider-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-theme-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.wt-theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: var(--wt-shape-full);
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.7);
  background: transparent;
  color: rgb(var(--mdui-color-on-surface));
  font-family: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--wt-dur-fast) var(--wt-ease-emph);
}

.wt-theme-btn.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.1);
  color: rgb(var(--mdui-color-primary));
}

.wt-palette-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}

.wt-palette {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--wt-shape-sm);
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.6);
  background: rgb(var(--mdui-color-surface-container-low));
  font-family: inherit;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
  text-align: left;
}

.wt-palette.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.08);
}

.wt-palette-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex-shrink: 0;
}

.wt-palette-dot.auto {
  background: conic-gradient(from 0deg, #4f6f52, #3f5b6b, #5a4a63, #7a4a3a, #4f6f52);
}

.wt-palette-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-color-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  align-items: center;
}

.wt-swatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform var(--wt-dur-fast) var(--wt-ease-spring);
}

.wt-swatch:hover {
  transform: scale(1.12);
}

.wt-swatch.active {
  border-color: rgb(var(--mdui-color-on-surface));
  box-shadow: 0 0 0 2px rgb(var(--mdui-color-surface));
}

.wt-color-input {
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.wt-iconstyle-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.wt-iconstyle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--wt-shape-full);
  border: 1px solid rgba(var(--mdui-color-outline-variant), 0.7);
  background: transparent;
  font-family: inherit;
  color: rgb(var(--mdui-color-on-surface));
  cursor: pointer;
}

.wt-iconstyle.active {
  border-color: rgb(var(--mdui-color-primary));
  background: rgba(var(--mdui-color-primary), 0.1);
  color: rgb(var(--mdui-color-primary));
}

.wt-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
  cursor: pointer;
}

.wt-preview-card p {
  margin: 10px 0 0;
}

/* ---------- 关于 ---------- */
.wt-about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 24px;
  text-align: center;
}

.wt-about-logo {
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: var(--wt-shape-xl);
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}

.wt-about-logo .material-icons-round {
  font-size: 2.25rem;
}

.wt-about h2 {
  margin: 0;
  font-size: 1.5rem;
  letter-spacing: 0.08em;
}

.wt-about-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 18px;
  width: 100%;
  margin-top: 22px;
  text-align: left;
}

.wt-about-foot {
  max-width: 520px;
  margin-top: 24px;
  line-height: 1.7;
}
</style>
