import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { http, setToken, setUnauthorizedHandler } from '@/api/http';

export interface CurrentUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  displayName: string;
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

interface LoginResponse {
  token: string;
  user: CurrentUser;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null);
  /** 是否已经问过服务端「我登录了吗」（避免刷新时闪一下登录页） */
  const settled = ref(false);

  const isLoggedIn = computed(() => !!user.value);
  const isAdmin = computed(() => user.value?.role === 'admin');

  /** 启动时探测登录态：有 token 就验，没有也问一次（服务端可能已失效） */
  async function probe(): Promise<void> {
    setUnauthorizedHandler(() => {
      user.value = null;
    });
    try {
      const res = await http.get<{ authed: boolean; user: CurrentUser | null }>('/api/auth/status');
      user.value = res.authed ? res.user : null;
    } catch {
      user.value = null;
    } finally {
      settled.value = true;
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await http.post<LoginResponse>('/api/auth/login', { username, password });
    setToken(res.token);
    user.value = res.user;
    settled.value = true;
  }

  async function logout(): Promise<void> {
    try {
      await http.post('/api/auth/logout');
    } catch {
      /* 忽略：本地照样清干净 */
    }
    setToken(null);
    user.value = null;
  }

  /** 改自己的密码 */
  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await http.post('/api/auth/password', { oldPassword, newPassword });
    // 服务端会把这个用户所有会话踢掉，本地也要重新登录
    setToken(null);
    user.value = null;
  }

  return { user, settled, isLoggedIn, isAdmin, probe, login, logout, changePassword };
});
