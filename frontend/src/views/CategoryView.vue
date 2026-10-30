<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostCard from '@/components/blog/PostCard.vue'
import Pagination from '@/components/blog/Pagination.vue'
import { requestJson, createRequestScope, errorMessage, isAbortError } from '@/lib/http.js'
import { pageFromQuery, pageQuery } from '@/lib/blogQuery.js'
import { takeBlogBootstrap, applyMetadata, pageMetadata } from '@/lib/blogPage.js'

const route = useRoute()
const router = useRouter()
const posts = ref([])
const total = ref(0)
const page = computed(() => pageFromQuery(route.query.page))
const size = 10
const loading = ref(true)
const error = ref('')
const postsScope = createRequestScope()
const initial = takeBlogBootstrap('category')
let initialListing = initial?.listing

async function fetchPosts() {
  const current = postsScope.begin()
  applyMetadata(pageMetadata({ path: route.fullPath, noindex: true }))
  loading.value = true
  error.value = ''
  posts.value = []
  total.value = 0
  const params = new URLSearchParams({ page: page.value, size, category: route.params.slug })
  try {
    const bootstrapped = initialListing
    initialListing = null
    const data = bootstrapped || await requestJson(`/api/blog/posts?${params}`, { signal: current.signal })
    if (!data || !Array.isArray(data.posts) || !Number.isFinite(data.total)) throw new Error('文章列表数据格式不正确，请重试')
    if (!current.isCurrent()) return
    posts.value = data.posts
    total.value = data.total
    applyMetadata(bootstrapped ? initial.meta : pageMetadata({
      title: `分类: ${route.params.slug} | Dy's Blog`,
      path: `/category/${encodeURIComponent(route.params.slug)}${page.value > 1 ? `?page=${page.value}` : ''}`,
      noindex: page.value > 1 && !data.posts.length,
    }))
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

function changePage(p) {
  router.push({ query: pageQuery(route.query, p) })
}

watch([() => route.params.slug, page], fetchPosts, { immediate: true })
onUnmounted(() => postsScope.cancel())
</script>

<template>
  <div class="category-page">
    <h1 class="page-title">分类: {{ route.params.slug }}</h1>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="request-error" role="alert">
      <p>{{ error }}</p>
      <button @click="fetchPosts">重新加载文章</button>
    </div>
    <template v-else-if="posts.length">
      <PostCard v-for="post in posts" :key="post.id" :post="post" />
    </template>
    <div v-else class="empty">{{ page > 1 ? '当前页暂无文章' : '该分类下暂无文章' }}</div>
    <Pagination v-if="!loading && !error" :total="total" :page="page" :size="size" @change="changePage" />
  </div>
</template>

<style>
.category-page .page-title { margin-bottom: 1.5rem; }
.category-page .loading, .category-page .empty { text-align: center; padding: 3rem; color: var(--text-muted); }
.category-page .request-error { color: var(--danger); padding: 1rem 0; }
.category-page .request-error button { margin-top: 0.5rem; }
</style>
