<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { marked } from 'marked'

const route = useRoute()
const post = ref(null)
const error = ref(false)

async function fetchPost() {
  error.value = false
  const res = await fetch(`/api/blog/posts/${route.params.slug}`)
  if (!res.ok) { error.value = true; return }
  post.value = await res.json()
}

onMounted(fetchPost)
watch(() => route.params.slug, fetchPost)
</script>

<template>
  <article v-if="post" class="post-detail">
    <header class="post-header">
      <h1>{{ post.title }}</h1>
      <div class="post-meta">
        <time>{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</time>
        <router-link v-if="post.category" :to="`/category/${post.category.slug}`" class="cat-link">
          {{ post.category.name }}
        </router-link>
        <span v-for="tag in post.tags" :key="tag.slug" class="tag-badge">{{ tag.name }}</span>
      </div>
    </header>
    <img v-if="post.cover_image" :src="post.cover_image" class="cover" alt="封面">
    <div class="post-content" v-html="marked(post.content)"></div>
  </article>
  <div v-else-if="error" class="error-page">
    <h2>文章不存在</h2>
    <router-link to="/">返回首页</router-link>
  </div>
  <div v-else class="loading">加载中...</div>
</template>

<style scoped>
.post-detail { max-width: 800px; margin: 0 auto; }
.post-header { margin-bottom: 2rem; }
.post-header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
.post-meta { display: flex; gap: 1rem; align-items: center; color: var(--text-muted); font-size: 0.9rem; }
.cat-link { background: #2a2a4a; padding: 0.1rem 0.5rem; border-radius: 4px; }
.tag-badge { background: #333; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
.cover { width: 100%; max-height: 400px; object-fit: cover; border-radius: var(--radius); margin-bottom: 2rem; }
.post-content { line-height: 1.8; }
.post-content :deep(h2) { margin-top: 2rem; margin-bottom: 0.5rem; }
.post-content :deep(pre) { background: #1a1a2e; padding: 1rem; border-radius: var(--radius); overflow-x: auto; }
.post-content :deep(code) { background: #2a2a4a; padding: 0.1rem 0.3rem; border-radius: 3px; }
.post-content :deep(img) { max-width: 100%; border-radius: var(--radius); }
.loading, .error-page { text-align: center; padding: 3rem; }
</style>
