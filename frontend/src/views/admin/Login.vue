<script setup>
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { requestJson, createRequestScope, errorMessage, isAbortError } from '@/lib/http.js'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const loginScope = createRequestScope()

async function login() {
  if (loading.value) return
  const current = loginScope.begin()
  error.value = ''
  loading.value = true
  try {
    await requestJson('/api/admin/login', {
      method: 'POST',
      json: { username: username.value, password: password.value },
      signal: current.signal,
    })
    if (current.isCurrent()) router.push('/admin')
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

onUnmounted(() => loginScope.cancel())
</script>

<template>
  <div class="login-page">
    <div class="login-card card">
      <h2>管理后台登录</h2>
      <form @submit.prevent="login">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" :disabled="loading" type="text" required autocomplete="username">
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" :disabled="loading" type="password" required autocomplete="current-password">
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="submit" class="btn-primary" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page { display: flex; justify-content: center; align-items: center; min-height: 60vh; }
.login-card { width: 100%; max-width: 380px; }
.login-card h2 { margin-bottom: 1.5rem; text-align: center; }
.field { margin-bottom: 1rem; }
.field label { display: block; margin-bottom: 0.3rem; font-size: 0.9rem; color: var(--text-muted); }
.error { color: var(--danger); font-size: 0.85rem; margin-bottom: 0.5rem; }
button[type="submit"] { width: 100%; padding: 0.7rem; font-size: 1rem; }
</style>
