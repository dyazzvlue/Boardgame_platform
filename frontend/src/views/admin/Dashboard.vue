<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const stats = ref({ posts: 0, categories: 0 })
const admin = ref(null)

onMounted(async () => {
  const meRes = await fetch('/api/admin/me')
  if (!meRes.ok) { router.push('/admin/login'); return }
  admin.value = await meRes.json()

  const postsRes = await fetch('/api/admin/posts')
  if (postsRes.ok) {
    const posts = await postsRes.json()
    stats.value.posts = posts.length
  }
  const catRes = await fetch('/api/blog/categories')
  if (catRes.ok) {
    const cats = await catRes.json()
    stats.value.categories = cats.length
  }
})

async function logout() {
  await fetch('/api/admin/logout', { method: 'POST' })
  router.push('/admin/login')
}
</script>

<template>
  <div class="admin-dashboard">
    <header class="admin-header">
      <h1>管理后台</h1>
      <div class="admin-actions">
        <span v-if="admin">{{ admin.username }}</span>
        <button @click="logout" class="btn-danger">登出</button>
      </div>
    </header>
    <nav class="admin-nav">
      <router-link to="/admin/posts">文章管理</router-link>
      <router-link to="/admin/posts/new">写文章</router-link>
      <router-link to="/admin/categories">分类管理</router-link>
      <router-link to="/">返回前台</router-link>
    </nav>
    <div class="stats-grid">
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
</style>
