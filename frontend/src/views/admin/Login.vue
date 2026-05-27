<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function login() {
  error.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    })
    if (!res.ok) {
      const data = await res.json()
      error.value = data.detail || '登录失败'
      return
    }
    router.push('/admin')
  } catch (e) {
    error.value = '网络错误'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card card">
      <h2>管理后台登录</h2>
      <form @submit.prevent="login">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" type="text" required autocomplete="username">
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" required autocomplete="current-password">
        </div>
        <p v-if="error" class="error">{{ error }}</p>
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
