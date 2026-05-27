<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import PostCard from '@/components/blog/PostCard.vue'
import Pagination from '@/components/blog/Pagination.vue'

const route = useRoute()
const posts = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const loading = ref(true)

async function fetchPosts() {
  loading.value = true
  const params = new URLSearchParams({ page: page.value, size, category: route.params.slug })
  const res = await fetch(`/api/blog/posts?${params}`)
  const data = await res.json()
  posts.value = data.posts
  total.value = data.total
  loading.value = false
}

onMounted(fetchPosts)
watch(() => route.params.slug, () => { page.value = 1; fetchPosts() })
</script>

<template>
  <div>
    <h1 class="page-title">分类: {{ route.params.slug }}</h1>
    <div v-if="loading" class="loading">加载中...</div>
    <template v-else-if="posts.length">
      <PostCard v-for="post in posts" :key="post.id" :post="post" />
      <Pagination :total="total" :page="page" :size="size" @change="p => { page = p; fetchPosts() }" />
    </template>
    <div v-else class="empty">该分类下暂无文章</div>
  </div>
</template>

<style scoped>
.page-title { margin-bottom: 1.5rem; }
.loading, .empty { text-align: center; padding: 3rem; color: var(--text-muted); }
</style>
