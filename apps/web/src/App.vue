<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useRulePackStore } from '@/stores/rulepacks';

const app = useAppStore();
const auth = useAuthStore();
const rulePacks = useRulePackStore();
const route = useRoute();
const router = useRouter();

const narrow = ref(false);
const drawerOpen = ref(false);
const userMenuOpen = ref(false);

const navItems = [
  { path: '/', icon: 'auto_stories', label: '书库', key: 'library' },
  { path: '/sessions', icon: 'bookmarks', label: '存档', key: 'sessions' },
  { path: '/worldbooks', icon: 'menu_book', label: '世界书', key: 'worldbooks' },
  { path: '/characters', icon: 'person', label: '角色卡', key: 'characters' },
  { path: '/rooms', icon: 'groups', label: '跑团', key: 'rooms' },
  { path: '/legacies', icon: 'history_edu', label: '继承', key: 'legacies' },
  { path: '/scripts', icon: 'account_tree', label: '剧本', key: 'scripts' },
  { path: '/codex', icon: 'school', label: '百科', key: 'codex' },
  { path: '/settings', icon: 'settings', label: '设置', key: 'settings' },
];

const activeKey = computed(() => {
  const p = route.path;
  if (p === '/' || p.startsWith('/play') || p.startsWith('/worlds')) return 'library';
  if (p.startsWith('/sessions')) return 'sessions';
  if (p.startsWith('/worldbooks')) return 'worldbooks';
  if (p.startsWith('/characters')) return 'characters';
  if (p.startsWith('/rooms')) return 'rooms';
  if (p.startsWith('/legacies')) return 'legacies';
  if (p.startsWith('/scripts')) return 'scripts';
  if (p.startsWith('/codex')) return 'codex';
  if (p.startsWith('/settings')) return 'settings';
  return '';
});

/** 阅读器与登录页用全屏布局（不套侧栏与顶栏） */
const immersive = computed(() => route.name === 'play' || route.name === 'login');

function onResize() {
  narrow.value = window.innerWidth < 840;
  if (!narrow.value) drawerOpen.value = false;
}

function go(path: string) {
  drawerOpen.value = false;
  router.push(path);
}

async function doLogout() {
  userMenuOpen.value = false;
  await auth.logout();
  router.replace('/login');
}

onMounted(async () => {
  onResize();
  window.addEventListener('resize', onResize);
  // 视觉偏好存在服务端，需要登录态。未登录时不请求 ——
  // 否则登录页会先吃一个 401（无害但吵闹，也会触发「登录失效」提示）。
  if (auth.isLoggedIn) {
    await app.load();
    // 规则包清单几乎每个页面都要用（名称/图标），登录后预热一次
    void rulePacks.load();
  }
});

// 登录成功后再拉一次偏好（登录页 → 首页的切换时机）
watch(
  () => auth.isLoggedIn,
  async (loggedIn) => {
    if (loggedIn) await app.load();
  },
);

watch(() => route.fullPath, () => {
  drawerOpen.value = false;
  userMenuOpen.value = false;
});
</script>

<template>
  <router-view v-if="immersive" />

  <div v-else class="wt-shell">
    <mdui-top-app-bar class="wt-appbar">
      <mdui-button-icon v-if="narrow" icon="menu" @click="drawerOpen = true" aria-label="菜单" />
      <mdui-top-app-bar-title class="wt-brand">
        <span class="material-icons-outlined wt-brand-icon">park</span>
        <span class="wt-brand-text">世界树</span>
      </mdui-top-app-bar-title>
      <div class="wt-spacer"></div>
      <mdui-tooltip content="新建世界">
        <mdui-button-icon icon="add" @click="router.push('/worlds/new')" aria-label="新建世界" />
      </mdui-tooltip>
      <mdui-tooltip content="明暗主题">
        <mdui-button-icon
          :icon="app.isDark ? 'light_mode' : 'dark_mode'"
          @click="app.save({ theme: app.isDark ? 'light' : 'dark' })"
          aria-label="切换主题"
        />
      </mdui-tooltip>

      <!-- 账号菜单 -->
      <div class="wt-user-wrap">
        <button class="wt-user-btn" :aria-label="auth.user?.displayName ?? '账号'" @click="userMenuOpen = !userMenuOpen">
          <span class="wt-user-avatar">{{ (auth.user?.displayName ?? '?').slice(0, 1) }}</span>
        </button>
        <transition name="wt-pop">
          <div v-if="userMenuOpen" class="wt-user-menu">
            <div class="wt-user-meta">
              <div class="wt-user-name">{{ auth.user?.displayName }}</div>
              <div class="wt-muted wt-small">
                @{{ auth.user?.username }}
                <span v-if="auth.isAdmin" class="wt-admin-tag">管理员</span>
              </div>
            </div>
            <button class="wt-user-item" @click="go('/settings'); userMenuOpen = false">
              <span class="material-icons-outlined">settings</span>设置
            </button>
            <button class="wt-user-item wt-user-danger" @click="doLogout">
              <span class="material-icons-outlined">logout</span>退出登录
            </button>
          </div>
        </transition>
      </div>
    </mdui-top-app-bar>

    <div class="wt-body">
      <aside v-if="!narrow" class="wt-sidebar">
        <nav class="wt-nav">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="wt-nav-item"
            :class="{ active: activeKey === item.key }"
            @click="go(item.path)"
          >
            <span class="material-icons-outlined wt-nav-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </nav>
        <div class="wt-sidebar-footer">
          <div class="wt-muted wt-small">用剧本驱动 AI<br />写下属于你的世界线</div>
        </div>
      </aside>

      <main class="wt-main">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>

    <mdui-navigation-drawer :open="drawerOpen" modal @close="drawerOpen = false" class="wt-drawer">
      <div class="wt-drawer-head">
        <div class="wt-drawer-logo">
          <span class="material-icons-outlined">park</span>
        </div>
        <div>
          <div class="wt-drawer-title">世界树</div>
          <div class="wt-muted wt-small">AI 互动阅读平台</div>
        </div>
      </div>
      <mdui-list>
        <mdui-list-item
          v-for="item in navItems"
          :key="item.key"
          :icon="item.icon"
          :active="activeKey === item.key"
          rounded
          @click="go(item.path)"
        >
          {{ item.label }}
        </mdui-list-item>
      </mdui-list>
    </mdui-navigation-drawer>

    <nav v-if="narrow" class="wt-bottom-nav">
      <button
        v-for="item in navItems.slice(0, 4)"
        :key="item.key"
        class="wt-bottom-item"
        :class="{ active: activeKey === item.key }"
        @click="go(item.path)"
      >
        <span class="material-icons-outlined">{{ item.icon }}</span>
        <span class="wt-bottom-label">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.wt-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--mdui-color-background));
}

.wt-appbar {
  --mdui-color-surface: var(--mdui-color-surface-container-low);
  border-bottom: 1px solid rgba(var(--mdui-color-outline-variant), 0.28);
}

.wt-brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.wt-brand-icon {
  font-size: 1.5rem;
  color: rgb(var(--mdui-color-primary));
}

.wt-brand-text {
  font-weight: 700;
  font-size: 1.0625rem;
  letter-spacing: 0.14em;
}

.wt-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.wt-sidebar {
  width: var(--wt-sidebar-width);
  flex-shrink: 0;
  background: rgb(var(--mdui-color-surface-container-low));
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
}

.wt-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wt-nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: none;
  border-radius: var(--wt-shape-full);
  background: transparent;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-size: 0.9375rem;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background var(--wt-dur-fast) var(--wt-ease-emph),
    color var(--wt-dur-fast) var(--wt-ease-emph),
    border-radius var(--wt-dur) var(--wt-ease-spring),
    transform var(--wt-dur) var(--wt-ease-spring);
}

.wt-nav-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.06);
  transform: translateX(2px);
}

/* 选中态：形状变成更大的胶囊 + 色块，Expressive 的「状态变形」 */
.wt-nav-item.active {
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
  font-weight: 600;
  border-radius: var(--wt-shape-full);
}

.wt-nav-icon {
  font-size: 1.25rem;
}

.wt-sidebar-footer {
  margin-top: auto;
  padding: 16px;
  line-height: 1.7;
}

.wt-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.wt-drawer {
  --mdui-color-surface: var(--mdui-color-surface-container-low);
  width: 280px;
}

.wt-drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 20px 12px;
}

.wt-drawer-logo {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}

.wt-drawer-title {
  font-weight: 600;
  letter-spacing: 0.06em;
}

.wt-bottom-nav {
  display: flex;
  border-top: 1px solid rgba(var(--mdui-color-outline-variant), 0.4);
  background: rgb(var(--mdui-color-surface-container-low));
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom));
}

.wt-bottom-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: rgb(var(--mdui-color-on-surface-variant));
  font-family: inherit;
  font-size: 0.6875rem;
  padding: 6px 0;
  cursor: pointer;
}

.wt-bottom-item.active {
  color: rgb(var(--mdui-color-primary));
}

.wt-bottom-item .material-icons-outlined {
  font-size: 1.25rem;
}

.wt-bottom-label {
  line-height: 1;
}

/* ---------- 账号菜单 ---------- */
.wt-user-wrap {
  position: relative;
}

.wt-user-btn {
  width: 36px;
  height: 36px;
  margin-left: 4px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: grid;
  place-items: center;
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
  transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
}

.wt-user-btn:hover {
  transform: scale(1.06);
}

.wt-user-avatar {
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1;
}

.wt-user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  z-index: 30;
  width: 232px;
  padding: 8px;
  border-radius: 24px;
  background: rgb(var(--mdui-color-surface-container-high));
  box-shadow:
    0 2px 8px rgba(var(--mdui-color-shadow), 0.12),
    0 18px 40px rgba(var(--mdui-color-shadow), 0.18);
  transform-origin: top right;
}

.wt-pop-enter-active,
.wt-pop-leave-active {
  transition: opacity 160ms ease, transform 200ms cubic-bezier(0.2, 0, 0, 1);
}

.wt-pop-enter-from,
.wt-pop-leave-to {
  opacity: 0;
  transform: scale(0.94) translateY(-6px);
}

.wt-user-meta {
  padding: 12px 14px 10px;
}

.wt-user-name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: rgb(var(--mdui-color-on-surface));
}

.wt-admin-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 600;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}

.wt-user-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.875rem;
  color: rgb(var(--mdui-color-on-surface));
  text-align: left;
  transition: background 140ms ease;
}

.wt-user-item:hover {
  background: rgba(var(--mdui-color-on-surface), 0.07);
}

.wt-user-item .material-icons-outlined {
  font-size: 1.15rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-user-danger {
  color: rgb(var(--mdui-color-error));
}

.wt-user-danger .material-icons-outlined {
  color: rgb(var(--mdui-color-error));
}
</style>
