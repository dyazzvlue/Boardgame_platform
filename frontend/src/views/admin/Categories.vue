<script setup>
import { ref, onMounted } from 'vue'

const categories = ref([])
const newName = ref('')
const loading = ref(false)

async function fetchCategories() {
  const res = await fetch('/api/blog/categories')
  if (res.ok) categories.value = await res.json()
}

async function addCategory() {
  if (!newName.value.trim()) return
  loading.value = true
  await fetch('/api/admin/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName.value.trim() }),
  })
  newName.value = ''
  loading.value = false
  fetchCategories()
}

async function deleteCategory(id) {
  if (!confirm('确认删除？')) return
  await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' })
  fetchCategories()
}

onMounted(fetchCategories)
</script>

<template>
  <div>
    <h2>分类管理</h2>
    <div class="add-row">
      <input v-model="newName" placeholder="新分类名称" @keyup.enter="addCategory">
      <button class="btn-primary" @click="addCategory" :disabled="loading">添加</button>
    </div>
    <ul class="cat-list">
      <li v-for="cat in categories" :key="cat.id" class="cat-item card">
        <span>{{ cat.name }} <small>({{ cat.post_count }} 篇)</small></span>
        <button class="btn-danger" @click="deleteCategory(cat.id)">删除</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
h2 { margin-bottom: 1.5rem; }
.add-row { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
.add-row input { max-width: 300px; }
.cat-list { list-style: none; }
.cat-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding: 0.8rem 1rem; }
.cat-item small { color: var(--text-muted); }
</style>
