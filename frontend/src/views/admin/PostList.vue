<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const posts = ref([])

async function fetchPosts() {
  const res = await fetch('/api/admin/posts')
  if (res.ok) posts.value = await res.json()
}

async function deletePost(id) {
  if (!confirm('确认删除？')) return
  await fetch(`/api/admin/posts/${id}`, { method: 'DELETE' })
  fetchPosts()
}

async function togglePublish(post) {
  await fetch(`/api/admin/posts/${post.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ published: !post.published }),
  })
  fetchPosts()
}

async function togglePin(post) {
  await fetch(`/api/admin/posts/${post.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: !post.pinned }),
  })
  fetchPosts()
}

onMounted(fetchPosts)
</script>

<template>
  <div>
    <div class="header-row">
      <h2>文章管理</h2>
      <router-link to="/admin/posts/new" class="btn-primary" style="padding:0.4rem 1rem; border-radius:6px;">新建文章</router-link>
    </div>
    <table class="post-table">
      <thead>
        <tr><th>标题</th><th>分类</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="post in posts" :key="post.id">
          <td>
            <span v-if="post.pinned" class="pin-icon">📌</span>
            {{ post.title }}
          </td>
          <td>{{ post.category || '-' }}</td>
          <td><span :class="post.published ? 'pub' : 'draft'">{{ post.published ? '已发布' : '草稿' }}</span></td>
          <td>{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</td>
          <td class="actions">
            <button @click="router.push(`/admin/posts/${post.id}/edit`)">编辑</button>
            <button @click="togglePin(post)">{{ post.pinned ? '取消置顶' : '置顶' }}</button>
            <button @click="togglePublish(post)">{{ post.published ? '下架' : '发布' }}</button>
            <button class="btn-danger" @click="deletePost(post.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!posts.length" class="empty">暂无文章</p>
  </div>
</template>

<style scoped>
.header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.post-table { width: 100%; border-collapse: collapse; }
.post-table th, .post-table td { padding: 0.7rem; text-align: left; border-bottom: 1px solid var(--border); }
.post-table th { color: var(--text-muted); font-size: 0.85rem; }
.pin-icon { margin-right: 0.3rem; }
.pub { color: var(--success); }
.draft { color: var(--text-muted); }
.actions { display: flex; gap: 0.5rem; }
.actions button { padding: 0.2rem 0.5rem; font-size: 0.8rem; background: var(--bg-card); border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; }
.actions button:hover { border-color: var(--accent); }
.empty { text-align: center; padding: 2rem; color: var(--text-muted); }
</style>
