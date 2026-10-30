<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostCard from '@/components/blog/PostCard.vue'
import Pagination from '@/components/blog/Pagination.vue'
import { requestJson, createRequestScope, expectArray, errorMessage, isAbortError } from '@/lib/http.js'
import { pageFromQuery, pageQuery, queryString } from '@/lib/blogQuery.js'
import { takeBlogBootstrap, applyMetadata, pageMetadata } from '@/lib/blogPage.js'

const route = useRoute()
const router = useRouter()
const posts = ref([])
const total = ref(0)
const page = computed(() => pageFromQuery(route.query.page))
const tag = computed(() => queryString(route.query.tag))
const size = 10
const categories = ref([])
const tags = ref([])
const loading = ref(true)
const error = ref('')
const metaError = ref('')
const metaLoading = ref(false)
const postsScope = createRequestScope()
const metaScope = createRequestScope()
const initial = takeBlogBootstrap('home')
let initialListing = initial?.listing
let initialMeta = !!initial
if (initial) {
  categories.value = initial.categories
  tags.value = initial.tags
}

async function fetchPosts() {
  const current = postsScope.begin()
  applyMetadata(pageMetadata({ path: route.fullPath, noindex: true }))
  loading.value = true
  error.value = ''
  posts.value = []
  total.value = 0
  const params = new URLSearchParams({ page: page.value, size })
  if (tag.value) params.set('tag', tag.value)
  try {
    const bootstrapped = initialListing
    initialListing = null
    const data = bootstrapped || await requestJson(`/api/blog/posts?${params}`, { signal: current.signal })
    if (!data || !Array.isArray(data.posts) || !Number.isFinite(data.total)) throw new Error('文章列表数据格式不正确，请重试')
    if (!current.isCurrent()) return
    posts.value = data.posts
    total.value = data.total
    const query = new URLSearchParams()
    if (tag.value) query.set('tag', tag.value)
    if (page.value > 1) query.set('page', page.value)
    applyMetadata(bootstrapped ? initial.meta : pageMetadata({
      title: tag.value ? `标签: ${tag.value} | Dy's Blog` : "Dy's Blog",
      path: `/${query.size ? `?${query}` : ''}`, noindex: page.value > 1 && !data.posts.length,
    }))
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) error.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

async function fetchMeta() {
  if (initialMeta) { initialMeta = false; return }
  const current = metaScope.begin()
  metaLoading.value = true
  metaError.value = ''
  try {
    const [cats, allTags] = await Promise.all([
      requestJson('/api/blog/categories', { signal: current.signal }),
      requestJson('/api/blog/tags', { signal: current.signal }),
    ])
    expectArray(cats)
    expectArray(allTags)
    if (!current.isCurrent()) return
    categories.value = cats
    tags.value = allTags
  } catch (failure) {
    if (current.isCurrent() && !isAbortError(failure)) metaError.value = errorMessage(failure)
  } finally {
    if (current.isCurrent()) metaLoading.value = false
  }
}

function changePage(p) {
  router.push({ query: pageQuery(route.query, p) })
}

function tagLocation(slug = '') {
  // Filter links start at page one; explicit URLs and browser history keep their page.
  return { path: '/', query: slug ? { tag: slug } : {} }
}

watch([tag, page], fetchPosts, { immediate: true })
onMounted(fetchMeta)
onUnmounted(() => { postsScope.cancel(); metaScope.cancel() })
</script>

<template>
  <div class="blog-home">
    <aside class="sidebar">
      <p v-if="metaLoading" role="status">正在加载分类和标签…</p>
      <div v-if="metaError" class="request-error" role="alert">
        <p>{{ metaError }}</p>
        <button @click="fetchMeta" :disabled="metaLoading">重试分类和标签</button>
      </div>
      <div class="card">
        <h3>分类</h3>
        <ul class="cat-list">
          <li v-for="cat in categories" :key="cat.id">
            <router-link :to="`/category/${encodeURIComponent(cat.slug)}`">
              {{ cat.name }} <span class="count">({{ cat.post_count }})</span>
            </router-link>
          </li>
        </ul>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>标签</h3>
        <div class="tag-cloud">
          <router-link
            v-for="tag in tags" :key="tag.id"
            :to="tagLocation(tag.slug)"
            class="tag-badge"
          >{{ tag.name }}</router-link>
        </div>
      </div>
    </aside>
    <section class="post-list">
      <h1 v-if="tag" class="filter-title">
        标签: {{ tag }}
        <router-link :to="tagLocation()" class="clear-filter">✕ 清除</router-link>
      </h1>
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="error" class="request-error" role="alert">
        <p>{{ error }}</p>
        <button @click="fetchPosts">重新加载文章</button>
      </div>
      <template v-else-if="posts.length">
        <PostCard v-for="post in posts" :key="post.id" :post="post" />
      </template>
      <div v-else class="empty">{{ page > 1 ? '当前页暂无文章' : '暂无文章' }}</div>
      <Pagination v-if="!loading && !error" :total="total" :page="page" :size="size" @change="changePage" />
    </section>
  </div>
</template>

<style>
.blog-home {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 2rem;
}
.blog-home .post-list { order: 1; min-width: 0; }
.blog-home .sidebar { order: 2; }
.blog-home .sidebar > .card + .card { margin-top: 1rem; }
.blog-home .cat-list { list-style: none; margin-top: 0.5rem; }
.blog-home .cat-list li { padding: 0.3rem 0; }
.blog-home .count { color: var(--text-muted); font-size: 0.85rem; }
.blog-home .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
.blog-home .tag-badge {
  background: #2a2a4a;
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.8rem;
}
.blog-home .filter-title { margin-bottom: 1rem; font-size: 1.2rem; }
.blog-home .clear-filter { font-size: 0.85rem; margin-left: 0.5rem; }
.blog-home .loading, .blog-home .empty { text-align: center; padding: 3rem; color: var(--text-muted); }
.blog-home .request-error { color: var(--danger); padding: 1rem 0; }
.blog-home .request-error button { margin-top: 0.5rem; }
@media (max-width: 768px) {
  .blog-home { grid-template-columns: 1fr; }
  .blog-home .sidebar { order: 2; }
}
</style>
