import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { title: '登录', public: true },
    },
    {
      path: '/',
      name: 'library',
      component: () => import('./views/LibraryView.vue'),
      meta: { title: '书库' },
    },
    {
      path: '/worlds/new',
      name: 'world-new',
      component: () => import('./views/WorldEditView.vue'),
      meta: { title: '创建世界' },
    },
    {
      path: '/worlds/:id',
      name: 'world-detail',
      component: () => import('./views/WorldDetailView.vue'),
      meta: { title: '世界' },
    },
    {
      path: '/worlds/:id/edit',
      name: 'world-edit',
      component: () => import('./views/WorldEditView.vue'),
      meta: { title: '编辑世界' },
    },
    {
      path: '/play/:sessionId',
      name: 'play',
      component: () => import('./views/PlayView.vue'),
      meta: { title: '阅读' },
    },
    {
      path: '/scripts',
      name: 'scripts',
      component: () => import('./views/ScriptListView.vue'),
      meta: { title: '剧本' },
    },
    {
      path: '/scripts/:id',
      name: 'script-edit',
      component: () => import('./views/ScriptEditView.vue'),
      meta: { title: '编辑剧本' },
    },
    {
      path: '/worldbooks',
      name: 'worldbooks',
      component: () => import('./views/WorldBookListView.vue'),
      meta: { title: '世界书' },
    },
    {
      path: '/worldbooks/:id',
      name: 'worldbook-edit',
      component: () => import('./views/WorldBookEditView.vue'),
      meta: { title: '编辑世界书' },
    },
    {
      path: '/characters',
      name: 'characters',
      component: () => import('./views/CharacterListView.vue'),
      meta: { title: '角色卡' },
    },
    {
      path: '/characters/:id',
      name: 'character-edit',
      component: () => import('./views/CharacterEditView.vue'),
      meta: { title: '编辑角色' },
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: () => import('./views/SessionsView.vue'),
      meta: { title: '存档' },
    },
    {
      path: '/rooms',
      name: 'rooms',
      component: () => import('./views/RoomsView.vue'),
      meta: { title: '多人跑团' },
    },
    {
      path: '/rooms/:id',
      name: 'room',
      component: () => import('./views/RoomView.vue'),
      meta: { title: '房间' },
    },
    {
      path: '/legacies',
      name: 'legacies',
      component: () => import('./views/LegaciesView.vue'),
      meta: { title: '继承存档' },
    },
    {
      path: '/codex',
      name: 'codex',
      component: () => import('./views/CodexView.vue'),
      meta: { title: '规则百科' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { title: '设置' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  const t = (to.meta?.title as string) || '';
  document.title = t ? `${t} · 世界树` : '世界树 · WorldTree';
});

/**
 * 全局登录守卫。
 *
 * 用 settled 判断「是否已经问过服务端」：首次进入时先探测登录态，
 * 再决定放行还是跳登录页 —— 否则刷新页面会被误踢到 /login。
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (!auth.settled) {
    await auth.probe();
  }

  const isPublic = to.meta?.public === true;

  if (!auth.isLoggedIn && !isPublic) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }

  // 已登录还去登录页：直接回首页
  if (auth.isLoggedIn && isPublic) {
    return { path: '/' };
  }

  return true;
});

