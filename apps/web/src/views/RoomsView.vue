<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, roomsApi, legaciesApi, type LegacyCandidate, type RoomListItem } from '@/api';
import type { CharacterCard, World } from '@worldtree/shared';
import { evValue, evValueRaw, toast } from '@/utils/ui';
import WtLoader from '@/components/WtLoader.vue';

const router = useRouter();

const loading = ref(true);
const rooms = ref<RoomListItem[]>([]);
const worlds = ref<World[]>([]);
const characters = ref<CharacterCard[]>([]);
const candidates = ref<LegacyCandidate[]>([]);

const creating = ref(false);
const joining = ref(false);
const showCreate = ref(false);
const showJoin = ref(true);

const createForm = reactive({
  worldId: '',
  hostName: '',
  hostRole: 'kp' as 'kp' | 'player',
  kpMode: 'human' as 'human' | 'ai',
  characterId: '',
  passcode: '',
  legacyId: '',
});

const joinForm = reactive({
  code: '',
  name: '',
  characterId: '',
  role: 'player' as 'kp' | 'player',
  passcode: '',
});

const selectedWorld = computed(() => worlds.value.find((w) => w.id === createForm.worldId));

async function load() {
  loading.value = true;
  try {
    const [r, w, c] = await Promise.all([roomsApi.list(), api.listWorlds(), api.listCharacters()]);
    rooms.value = r.items;
    worlds.value = w.items.map((x) => x.world);
    characters.value = c.items;
    if (!createForm.worldId && worlds.value.length) createForm.worldId = worlds.value[0].id;
  } catch (err) {
    toast((err as Error).message);
  } finally {
    loading.value = false;
  }
}

/** 选了世界才去拉它能接的继承存档 */
async function loadLegacies() {
  candidates.value = [];
  createForm.legacyId = '';
  if (!createForm.worldId) return;
  try {
    const res = await legaciesApi.forWorld(createForm.worldId);
    candidates.value = res.candidates.filter((c) => c.accepted);
  } catch {
    /* 没有继承规则就是空 */
  }
}

async function create() {
  if (!createForm.worldId) return toast('先选一个世界');
  if (!createForm.hostName.trim()) return toast('给自己起个名字');
  creating.value = true;
  try {
    const res = await roomsApi.create({
      worldId: createForm.worldId,
      hostName: createForm.hostName.trim(),
      hostRole: createForm.hostRole,
      kpMode: createForm.kpMode,
      characterId: createForm.characterId || undefined,
      passcode: createForm.passcode || undefined,
      legacyId: createForm.legacyId || undefined,
    });
    // 记住自己是谁
    localStorage.setItem(`wt.room.${res.room.id}.member`, res.room.hostMemberId);
    toast(`房间已创建，加入码 ${res.room.code}`);
    router.push(`/rooms/${res.room.id}`);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    creating.value = false;
  }
}

async function join() {
  const code = joinForm.code.trim().toUpperCase();
  if (code.length !== 6) return toast('加入码是 6 位');
  if (!joinForm.name.trim()) return toast('给自己起个名字');
  joining.value = true;
  try {
    const res = await roomsApi.join({
      code,
      name: joinForm.name.trim(),
      role: joinForm.role,
      characterId: joinForm.characterId || undefined,
      passcode: joinForm.passcode || undefined,
    });
    localStorage.setItem(`wt.room.${res.room.id}.member`, res.member.id);
    toast(`已加入「${res.room.code}」`);
    router.push(`/rooms/${res.room.id}`);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    joining.value = false;
  }
}

function openRoom(r: RoomListItem) {
  router.push(`/rooms/${r.id}`);
}

function statusLabel(s: string) {
  return s === 'lobby' ? '等待开始' : s === 'playing' ? '进行中' : '已结束';
}

onMounted(async () => {
  await load();
  await loadLegacies();
});
</script>

<template>
  <div class="wt-page">
    <div class="wt-container">
      <header class="wt-page-head">
        <div>
          <h1 class="wt-page-title">多人跑团</h1>
          <p class="wt-muted wt-small">同一个局域网就能一起玩：一个人当 KP，其他人带自己的角色卡进团。</p>
        </div>
        <div class="wt-spacer"></div>
        <mdui-button variant="tonal" icon="group_add" @click="showJoin = !showJoin">加入房间</mdui-button>
        <mdui-button variant="filled" icon="add" @click="showCreate = !showCreate">开个新团</mdui-button>
      </header>

      <div v-if="loading" class="wt-loading"><WtLoader size="lg" /></div>

      <template v-else>
        <!-- 加入 -->
        <section v-if="showJoin" class="wt-panel">
          <h2 class="wt-section-title">用加入码进团</h2>
          <div class="wt-join-row">
            <mdui-text-field
              :value="joinForm.code"
              label="6 位加入码"
              variant="outlined"
              maxlength="6"
              class="wt-code-field"
              @input="joinForm.code = evValueRaw($event).toUpperCase()"
            ></mdui-text-field>
            <mdui-text-field
              :value="joinForm.name"
              label="你的名字"
              variant="outlined"
              @input="joinForm.name = evValueRaw($event)"
            ></mdui-text-field>
            <mdui-select
              :value="joinForm.role"
              label="身份"
              variant="outlined"
              @change="joinForm.role = evValue($event) as any"
            >
              <mdui-menu-item value="player">玩家</mdui-menu-item>
              <mdui-menu-item value="kp">KP / 主持人</mdui-menu-item>
              <mdui-menu-item value="spectator">旁观</mdui-menu-item>
            </mdui-select>
            <mdui-select
              :value="joinForm.characterId"
              label="角色卡（可选）"
              variant="outlined"
              @change="joinForm.characterId = evValue($event)"
            >
              <mdui-menu-item value="">不绑定（随机生成面板）</mdui-menu-item>
              <mdui-menu-item v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</mdui-menu-item>
            </mdui-select>
            <mdui-text-field
              :value="joinForm.passcode"
              label="密码（如果房间有）"
              variant="outlined"
              @input="joinForm.passcode = evValueRaw($event)"
            ></mdui-text-field>
            <mdui-button variant="filled" icon="login" :loading="joining" @click="join">加入</mdui-button>
          </div>
        </section>

        <!-- 创建 -->
        <section v-if="showCreate" class="wt-panel">
          <h2 class="wt-section-title">开个新团</h2>
          <div class="wt-form-grid">
            <mdui-select
              :value="createForm.worldId"
              label="选择世界"
              variant="outlined"
              @change="createForm.worldId = evValue($event); loadLegacies()"
            >
              <mdui-menu-item v-for="w in worlds" :key="w.id" :value="w.id">{{ w.title }}</mdui-menu-item>
            </mdui-select>
            <mdui-text-field
              :value="createForm.hostName"
              label="你的名字"
              variant="outlined"
              @input="createForm.hostName = evValueRaw($event)"
            ></mdui-text-field>
            <mdui-select
              :value="createForm.hostRole"
              label="你当什么"
              variant="outlined"
              @change="createForm.hostRole = evValue($event) as any"
            >
              <mdui-menu-item value="kp">KP / 主持人</mdui-menu-item>
              <mdui-menu-item value="player">玩家</mdui-menu-item>
            </mdui-select>
            <mdui-select
              :value="createForm.kpMode"
              label="KP 由谁担任"
              variant="outlined"
              helper="真人 KP 的输入是导演指令，不占玩家回合；AI 当 KP 会尽量把故事拉长。"
              @change="createForm.kpMode = evValue($event) as any"
            >
              <mdui-menu-item value="human">真人当 KP（我或某位成员）</mdui-menu-item>
              <mdui-menu-item value="ai">AI 当 KP（无主持人）</mdui-menu-item>
            </mdui-select>
            <mdui-select
              :value="createForm.characterId"
              label="你的角色卡（可选）"
              variant="outlined"
              @change="createForm.characterId = evValue($event)"
            >
              <mdui-menu-item value="">不绑定</mdui-menu-item>
              <mdui-menu-item v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</mdui-menu-item>
            </mdui-select>
            <mdui-text-field
              :value="createForm.passcode"
              label="房间密码（可选）"
              variant="outlined"
              @input="createForm.passcode = evValueRaw($event)"
            ></mdui-text-field>
          </div>

          <div v-if="candidates.length" class="wt-legacy-pick">
            <div class="wt-small wt-muted">
              《{{ selectedWorld?.title }}》支持继承。可以把上一部作品的结局带进来：
            </div>
            <mdui-select
              :value="createForm.legacyId"
              label="继承存档（可选）"
              variant="outlined"
              @change="createForm.legacyId = evValue($event)"
            >
              <mdui-menu-item value="">不继承，从头开始</mdui-menu-item>
              <mdui-menu-item v-for="l in candidates" :key="l.id" :value="l.id">
                {{ l.characterName }} · {{ l.worldTitle }} · {{ l.ending.title || '结局' }}
              </mdui-menu-item>
            </mdui-select>
          </div>

          <div class="wt-actions">
            <mdui-button variant="filled" icon="play_arrow" :loading="creating" @click="create">创建房间</mdui-button>
          </div>
        </section>

        <!-- 列表 -->
        <section class="wt-panel">
          <h2 class="wt-section-title">局域网里的团</h2>
          <div v-if="!rooms.length" class="wt-empty-inline">
            还没有任何团。点右上角「开个新团」，把 6 位加入码告诉同一 Wi-Fi 下的朋友就行。
          </div>
          <div class="wt-room-grid">
            <article v-for="r in rooms" :key="r.id" class="wt-room-card" @click="openRoom(r)">
              <header>
                <span class="wt-room-code">{{ r.code }}</span>
                <span class="wt-chip">{{ statusLabel(r.status) }}</span>
              </header>
              <h3>{{ r.worldTitle }}</h3>
              <p class="wt-small wt-muted">
                {{ r.members.length }} 人 · {{ r.online }} 在线 · 第 {{ r.round }} 轮
              </p>
              <div class="wt-member-chips">
                <span v-for="m in r.members" :key="m.id" class="wt-chip wt-chip-sm">
                  {{ m.role === 'kp' ? 'KP ' : '' }}{{ m.name }}
                </span>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wt-page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.wt-page-title {
  font-size: 1.375rem;
  margin: 0;
}

.wt-panel {
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  border-radius: 18px;
  padding: 20px;
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wt-section-title {
  font-size: 1rem;
  margin: 0;
}

.wt-join-row {
  display: grid;
  grid-template-columns: 140px 1fr 140px 1fr 1fr auto;
  gap: 10px;
  align-items: center;
}

.wt-code-field {
  font-family: ui-monospace, monospace;
  letter-spacing: 0.18em;
}

.wt-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.wt-actions {
  display: flex;
  justify-content: flex-end;
}

.wt-legacy-pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgb(var(--mdui-color-surface-container));
}

.wt-room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.wt-room-card {
  border: 1px solid rgb(var(--mdui-color-outline-variant));
  border-radius: 16px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}

.wt-room-card:hover {
  border-color: rgb(var(--mdui-color-primary));
  transform: translateY(-2px);
}

.wt-room-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.wt-room-code {
  font-family: ui-monospace, monospace;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgb(var(--mdui-color-primary));
}

.wt-room-card h3 {
  font-size: 1rem;
  margin: 0 0 4px;
}

.wt-member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.wt-chip {
  font-size: 0.75rem;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}

.wt-chip-sm {
  font-size: 0.6875rem;
}

.wt-empty-inline {
  padding: 28px;
  border: 1px dashed rgb(var(--mdui-color-outline-variant));
  border-radius: 14px;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.875rem;
  line-height: 1.7;
  text-align: center;
}

.wt-loading {
  display: grid;
  place-items: center;
  padding: 80px;
}
</style>
