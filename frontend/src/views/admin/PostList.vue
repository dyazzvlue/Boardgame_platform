<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { requestJson, createRequestScope, expectArray, errorMessage, isAbortError } from '@/lib/http.js'

const router = useRouter()
const posts = ref([])
const loading = ref(true)
const error = ref('')
const actionError = ref('')
const pendingId = ref(null)
const readScope = createRequestScope()
const actionScope = createRequestScope()

async function fetchPosts() {
  const current = readScope.begin()
  loading.value = true
  error.value = ''
  try {
    const data = expectArray(await requestJson('/api/admin/posts', { signal: current.signal }))
    if (current.isCurrent()) posts.value = data
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

async function updatePost(id, options) {
  if (pendingId.value !== null || loading.value) return false
  const current = actionScope.begin()
  pendingId.value = id
  actionError.value = ''
  try {
    await requestJson(`/api/admin/posts/${id}`, { ...options, signal: current.signal })
    if (!current.isCurrent()) return false
    await fetchPosts()
    return true
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) actionError.value = errorMessage(failure)
    return false
  } finally {
    if (current.isCurrent()) pendingId.value = null
  }
}

async function deletePost(id) {
  if (pendingId.value !== null || loading.value) return
  if (!confirm('确认删除？')) return
  return updatePost(id, { method: 'DELETE' })
}

function togglePublish(post) {
  return updatePost(post.id, { method: 'PUT', json: { published: !post.published } })
}

function togglePin(post) {
  return updatePost(post.id, { method: 'PUT', json: { pinned: !post.pinned } })
}

onMounted(fetchPosts)
onUnmounted(() => { readScope.cancel(); actionScope.cancel() })
</script>

<template>
  <div>
    <div class="header-row">
      <h2>文章管理</h2>
      <router-link to="/admin/posts/new" class="btn-primary" style="padding:0.4rem 1rem; border-radius:6px;">新建文章</router-link>
    </div>
    <p v-if="actionError" class="request-error" role="alert">{{ actionError }}；请重试操作。</p>
    <p v-if="loading" role="status">正在加载文章…</p>
    <div v-else-if="error" class="request-error" role="alert">
      <p>{{ error }}</p>
      <button @click="fetchPosts">重新加载文章</button>
    </div>
    <table v-else-if="posts.length" class="post-table">
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
            <button :disabled="pendingId !== null" @click="router.push(`/admin/posts/${post.id}/edit`)">编辑</button>
            <button :disabled="pendingId !== null" @click="togglePin(post)">{{ post.pinned ? '取消置顶' : '置顶' }}</button>
            <button :disabled="pendingId !== null" @click="togglePublish(post)">{{ post.published ? '下架' : '发布' }}</button>
            <button :disabled="pendingId !== null" class="btn-danger" @click="deletePost(post.id)">{{ pendingId === post.id ? '处理中…' : '删除' }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">暂无文章</p>
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
.request-error { color: var(--danger); margin-bottom: 1rem; }
.actions button:disabled { opacity: 0.5; cursor: wait; }
</style>
