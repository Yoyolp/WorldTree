<script setup lang="ts">
/**
 * 登录页。
 *
 * 设计上刻意做得像「一扇门」而不是一个表单：整屏居中、大标题、
 * 单一主操作。M3 Expressive 的味道靠超大圆角与动效，而不是装饰。
 */
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const showPassword = ref(false);

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!username.value.trim() || !password.value) {
    error.value = '请输入账号和密码';
    return;
  }
  busy.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    const redirect = String(route.query.redirect ?? '/');
    router.replace(redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wt-login">
    <div class="wt-login-orb wt-login-orb-a"></div>
    <div class="wt-login-orb wt-login-orb-b"></div>

    <form class="wt-login-card" @submit.prevent="submit">
      <div class="wt-login-logo">
        <span class="material-icons-round">park</span>
      </div>
      <h1 class="wt-login-title">世界树</h1>
      <p class="wt-login-sub">剧本驱动的 AI 互动阅读</p>

      <label class="wt-login-field">
        <span class="material-icons-round">person</span>
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          placeholder="账号"
          :disabled="busy"
          autofocus
        />
      </label>

      <label class="wt-login-field">
        <span class="material-icons-round">lock</span>
        <input
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="密码"
          :disabled="busy"
        />
        <button
          type="button"
          class="wt-login-eye"
          :aria-label="showPassword ? '隐藏密码' : '显示密码'"
          @click="showPassword = !showPassword"
        >
          <span class="material-icons-round">{{ showPassword ? 'visibility_off' : 'visibility' }}</span>
        </button>
      </label>

      <p v-if="error" class="wt-login-error">
        <span class="material-icons-round">error</span>{{ error }}
      </p>

      <button type="submit" class="wt-login-submit" :disabled="busy">
        <span v-if="busy" class="wt-login-spinner"></span>
        <span v-else>进入</span>
      </button>

      <p class="wt-login-hint">
        账号由管理员创建。忘记密码请联系管理员重置。
      </p>
    </form>
  </div>
</template>

<style scoped>
.wt-login {
  position: relative;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: rgb(var(--mdui-color-surface));
}

/* 两个大而柔的色块，给纯色背景一点层次（Expressive 的「大形状」） */
.wt-login-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.5;
  pointer-events: none;
}

.wt-login-orb-a {
  width: 46vmax;
  height: 46vmax;
  top: -18vmax;
  left: -14vmax;
  background: rgb(var(--mdui-color-primary-container));
  animation: wt-float 18s ease-in-out infinite;
}

.wt-login-orb-b {
  width: 38vmax;
  height: 38vmax;
  bottom: -16vmax;
  right: -12vmax;
  background: rgb(var(--mdui-color-tertiary-container));
  animation: wt-float 22s ease-in-out infinite reverse;
}

@keyframes wt-float {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(3vmax, -2vmax, 0) scale(1.06); }
}

.wt-login-card {
  position: relative;
  z-index: 1;
  width: min(92vw, 400px);
  padding: 40px 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Expressive：超大圆角 + 柔和投影 */
  border-radius: 36px;
  background: rgb(var(--mdui-color-surface-container-high) / 0.86);
  backdrop-filter: blur(24px) saturate(1.4);
  box-shadow:
    0 2px 8px rgba(var(--mdui-color-shadow), 0.1),
    0 24px 64px rgba(var(--mdui-color-shadow), 0.16);
  animation: wt-rise 480ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes wt-rise {
  from { opacity: 0; transform: translateY(18px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

.wt-login-logo {
  width: 62px;
  height: 62px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
  align-self: center;
}

.wt-login-logo .material-icons-round {
  font-size: 2rem;
}

.wt-login-title {
  margin: 4px 0 0;
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgb(var(--mdui-color-on-surface));
}

.wt-login-sub {
  margin: 0 0 10px;
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-login-field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 16px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container-highest));
  border: 1px solid transparent;
  transition: border-color 160ms ease, background 160ms ease;
}

.wt-login-field:focus-within {
  border-color: rgb(var(--mdui-color-primary));
  background: rgb(var(--mdui-color-surface-container-lowest));
}

.wt-login-field .material-icons-round {
  font-size: 1.25rem;
  color: rgb(var(--mdui-color-on-surface-variant));
}

.wt-login-field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 1rem;
  color: rgb(var(--mdui-color-on-surface));
}

.wt-login-field input::placeholder {
  color: rgb(var(--mdui-color-on-surface-variant) / 0.7);
}

.wt-login-eye {
  border: none;
  background: transparent;
  padding: 4px;
  cursor: pointer;
  color: rgb(var(--mdui-color-on-surface-variant));
  display: grid;
  place-items: center;
}

.wt-login-eye .material-icons-round {
  font-size: 1.2rem;
}

.wt-login-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 0.8125rem;
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
  animation: wt-shake 320ms ease;
}

.wt-login-error .material-icons-round {
  font-size: 1.05rem;
}

@keyframes wt-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.wt-login-submit {
  height: 56px;
  margin-top: 6px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  background: rgb(var(--mdui-color-primary));
  color: rgb(var(--mdui-color-on-primary));
  display: grid;
  place-items: center;
  transition: transform 140ms cubic-bezier(0.2, 0, 0, 1), box-shadow 200ms ease, opacity 160ms ease;
  box-shadow: 0 4px 14px rgba(var(--mdui-color-primary), 0.32);
}

.wt-login-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(var(--mdui-color-primary), 0.36);
}

.wt-login-submit:active:not(:disabled) {
  transform: scale(0.97);
}

.wt-login-submit:disabled {
  opacity: 0.7;
  cursor: default;
}

.wt-login-spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(var(--mdui-color-on-primary) / 0.35);
  border-top-color: rgb(var(--mdui-color-on-primary));
  animation: wt-spin 700ms linear infinite;
}

@keyframes wt-spin {
  to { transform: rotate(360deg); }
}

.wt-login-hint {
  margin: 8px 0 0;
  text-align: center;
  font-size: 0.75rem;
  line-height: 1.6;
  color: rgb(var(--mdui-color-on-surface-variant) / 0.8);
}
</style>
