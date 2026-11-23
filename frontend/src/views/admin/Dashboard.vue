<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { requestJson, createRequestScope, expectArray, errorMessage, isAbortError } from '@/lib/http.js'

const router = useRouter()
const stats = ref(null)
const admin = ref(null)
const loading = ref(true)
const error = ref('')
const logoutError = ref('')
const loggingOut = ref(false)
const readScope = createRequestScope()
const logoutScope = createRequestScope()

async function fetchDashboard() {
  const current = readScope.begin()
  loading.value = true
  error.value = ''
  stats.value = null
  try {
    const me = await requestJson('/api/admin/me', { signal: current.signal })
    if (!me || typeof me.username !== 'string') throw new Error('账户数据格式不正确，请重试')
    if (!current.isCurrent()) return
    admin.value = me
    const [posts, categories] = await Promise.all([
      requestJson('/api/admin/posts', { signal: current.signal }),
      requestJson('/api/blog/categories', { signal: current.signal }),
    ])
    expectArray(posts)
    expectArray(categories)
    if (current.isCurrent()) stats.value = { posts: posts.length, categories: categories.length }
  } catch (failure) {
    if (!current.isCurrent() || isAbortError(failure)) return
    if (failure.status === 401 || failure.status === 403) router.replace('/admin/login')
    else error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

async function logout() {
  if (loggingOut.value) return
  const current = logoutScope.begin()
  loggingOut.value = true
  logoutError.value = ''
  try {
    await requestJson('/api/admin/logout', { method: 'POST', signal: current.signal })
    if (current.isCurrent()) router.push('/admin/login')
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) logoutError.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loggingOut.value = false
  }
}

onMounted(fetchDashboard)
onUnmounted(() => { readScope.cancel(); logoutScope.cancel() })
</script>

<template>
  <div class="admin-dashboard">
    <header class="admin-header">
      <h1>管理后台</h1>
      <div class="admin-actions">
        <span v-if="admin">{{ admin.username }}</span>
        <button @click="logout" :disabled="loggingOut" class="btn-danger">{{ loggingOut ? '登出中…' : '登出' }}</button>
      </div>
    </header>
    <nav class="admin-nav">
      <router-link to="/admin/posts">文章管理</router-link>
      <router-link to="/admin/posts/new">写文章</router-link>
      <router-link to="/admin/categories">分类管理</router-link>
      <router-link to="/">返回前台</router-link>
    </nav>
    <p v-if="logoutError" class="request-error" role="alert">{{ logoutError }}；请重试登出。</p>
    <p v-if="loading" role="status">正在加载统计…</p>
    <div v-else-if="error" class="request-error" role="alert">
      <p>{{ error }}</p>
      <button @click="fetchDashboard">重新加载统计</button>
    </div>
    <div v-else-if="stats" class="stats-grid">
      <div class="stat-card card">
        <div class="stat-num">{{ stats.posts }}</div>
        <div class="stat-label">文章</div>
      </div>
      <div class="stat-card card">
        <div class="stat-num">{{ stats.categories }}</div>
        <div class="stat-label">分类</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.admin-actions { display: flex; gap: 1rem; align-items: center; }
.admin-nav { display: flex; gap: 1.5rem; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
.admin-nav a { color: var(--text-muted); }
.admin-nav a.router-link-active { color: var(--accent); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; }
.stat-card { text-align: center; }
.stat-num { font-size: 2rem; font-weight: 700; color: var(--accent); }
.stat-label { color: var(--text-muted); margin-top: 0.3rem; }
.request-error { color: var(--danger); margin-bottom: 1rem; }
</style>
