<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostCard from '@/components/blog/PostCard.vue'
import Pagination from '@/components/blog/Pagination.vue'

const route = useRoute()
const router = useRouter()
const posts = ref([])
const total = ref(0)
const page = ref(1)
const size = 10
const categories = ref([])
const tags = ref([])
const loading = ref(true)

async function fetchPosts() {
  loading.value = true
  const params = new URLSearchParams({ page: page.value, size })
  if (route.query.tag) params.set('tag', route.query.tag)
  const res = await fetch(`/api/blog/posts?${params}`)
  const data = await res.json()
  posts.value = data.posts
  total.value = data.total
  loading.value = false
}

async function fetchMeta() {
  const [catRes, tagRes] = await Promise.all([
    fetch('/api/blog/categories'),
    fetch('/api/blog/tags'),
  ])
  categories.value = await catRes.json()
  tags.value = await tagRes.json()
}

function changePage(p) {
  page.value = p
  fetchPosts()
}

onMounted(() => { fetchPosts(); fetchMeta() })
watch(() => route.query, fetchPosts)
</script>

<template>
  <div class="blog-home">
    <aside class="sidebar">
      <div class="card">
        <h3>分类</h3>
        <ul class="cat-list">
          <li v-for="cat in categories" :key="cat.id">
            <router-link :to="`/category/${cat.slug}`">
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
            :to="{ path: '/', query: { tag: tag.slug } }"
            class="tag-badge"
          >{{ tag.name }}</router-link>
        </div>
      </div>
    </aside>
    <section class="post-list">
      <h1 v-if="route.query.tag" class="filter-title">
        标签: {{ route.query.tag }}
        <router-link to="/" class="clear-filter">✕ 清除</router-link>
      </h1>
      <div v-if="loading" class="loading">加载中...</div>
      <template v-else-if="posts.length">
        <PostCard v-for="post in posts" :key="post.id" :post="post" />
        <Pagination :total="total" :page="page" :size="size" @change="changePage" />
      </template>
      <div v-else class="empty">暂无文章</div>
    </section>
  </div>
</template>

<style scoped>
.blog-home {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 2rem;
}
.post-list { order: 1; }
.sidebar { order: 2; }
.cat-list { list-style: none; margin-top: 0.5rem; }
.cat-list li { padding: 0.3rem 0; }
.count { color: var(--text-muted); font-size: 0.85rem; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
.tag-badge {
  background: #2a2a4a;
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.8rem;
}
.filter-title { margin-bottom: 1rem; font-size: 1.2rem; }
.clear-filter { font-size: 0.85rem; margin-left: 0.5rem; }
.loading, .empty { text-align: center; padding: 3rem; color: var(--text-muted); }
@media (max-width: 768px) {
  .blog-home { grid-template-columns: 1fr; }
  .sidebar { order: 2; }
}
</style>
