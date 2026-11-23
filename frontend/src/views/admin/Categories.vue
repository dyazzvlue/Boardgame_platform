<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { requestJson, createRequestScope, expectArray, errorMessage, isAbortError } from '@/lib/http.js'

const categories = ref([])
const newName = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const actionError = ref('')
const readScope = createRequestScope()
const actionScope = createRequestScope()

async function fetchCategories() {
  const current = readScope.begin()
  loading.value = true
  error.value = ''
  try {
    const data = expectArray(await requestJson('/api/blog/categories', { signal: current.signal }))
    if (current.isCurrent()) categories.value = data
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

async function changeCategory(url, options, onSuccess = () => {}) {
  if (saving.value || loading.value) return false
  const current = actionScope.begin()
  saving.value = true
  actionError.value = ''
  try {
    await requestJson(url, { ...options, signal: current.signal })
    if (!current.isCurrent()) return false
    onSuccess()
    await fetchCategories()
    return true
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) actionError.value = errorMessage(failure)
    return false
  } finally {
    if (current.isCurrent()) saving.value = false
  }
}

async function addCategory() {
  const name = newName.value.trim()
  if (!name) return
  return changeCategory('/api/admin/categories', { method: 'POST', json: { name } }, () => {
    if (newName.value.trim() === name) newName.value = ''
  })
}

async function deleteCategory(id) {
  if (saving.value || loading.value) return
  if (!confirm('确认删除？')) return
  return changeCategory(`/api/admin/categories/${id}`, { method: 'DELETE' })
}

onMounted(fetchCategories)
onUnmounted(() => { readScope.cancel(); actionScope.cancel() })
</script>

<template>
  <div>
    <h2>分类管理</h2>
    <div class="add-row">
      <input v-model="newName" :disabled="saving || loading" placeholder="新分类名称" @keyup.enter="addCategory">
      <button class="btn-primary" @click="addCategory" :disabled="saving || loading">{{ saving ? '处理中…' : '添加' }}</button>
    </div>
    <p v-if="actionError" class="request-error" role="alert">{{ actionError }}；请重试操作。</p>
    <p v-if="loading" role="status">正在加载分类…</p>
    <div v-else-if="error" class="request-error" role="alert">
      <p>{{ error }}</p>
      <button @click="fetchCategories">重新加载分类</button>
    </div>
    <ul v-else-if="categories.length" class="cat-list">
      <li v-for="cat in categories" :key="cat.id" class="cat-item card">
        <span>{{ cat.name }} <small>({{ cat.post_count }} 篇)</small></span>
        <button :disabled="saving" class="btn-danger" @click="deleteCategory(cat.id)">删除</button>
      </li>
    </ul>
    <p v-else class="empty">暂无分类</p>
  </div>
</template>

<style scoped>
h2 { margin-bottom: 1.5rem; }
.add-row { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
.add-row input { max-width: 300px; }
.cat-list { list-style: none; }
.cat-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0.8rem 1rem; }
.cat-item small { color: var(--text-muted); }
.request-error { color: var(--danger); margin-bottom: 1rem; }
.empty { color: var(--text-muted); text-align: center; padding: 2rem; }
</style>
