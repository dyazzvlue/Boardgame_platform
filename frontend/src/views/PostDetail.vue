<script setup>
import { ref, computed, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { renderMarkdown, sanitizeHtml } from '@/lib/markdown.js'
import { safeImageUrl } from '@/lib/images.js'
import { takeBlogBootstrap, applyMetadata, postMetadata, pageMetadata } from '@/lib/blogPage.js'
import { requestJson, createRequestScope, errorMessage, isAbortError } from '@/lib/http.js'

const route = useRoute()
const post = ref(null)
const error = ref('')
const notFound = ref(false)
const loading = ref(true)
const postScope = createRequestScope()
const coverImage = computed(() => safeImageUrl(post.value?.cover_image))
const contentHtml = computed(() => post.value
  ? (typeof post.value.content_html === 'string' ? sanitizeHtml(post.value.content_html) : renderMarkdown(post.value.content))
  : '')

async function fetchPost() {
  const current = postScope.begin()
  applyMetadata(pageMetadata({ path: route.path, noindex: true }))
  loading.value = true
  post.value = null
  error.value = ''
  notFound.value = false
  try {
    const initial = takeBlogBootstrap('post')
    if (initial?.notFound) {
      notFound.value = true
      error.value = '文章不存在或已下架'
      applyMetadata(initial.meta)
      return
    }
    const data = initial ? initial.post : await requestJson(`/api/blog/posts/${encodeURIComponent(route.params.slug)}`, { signal: current.signal })
    if (!data || typeof data.title !== 'string' || typeof data.content !== 'string') throw new Error('文章数据格式不正确，请重试')
    if (current.isCurrent()) {
      post.value = data
      applyMetadata(initial?.meta || postMetadata(data))
    }
  } catch (failure) {
    if (!current.isCurrent() || isAbortError(failure)) return
    notFound.value = failure.status === 404
    error.value = notFound.value ? '文章不存在或已下架' : errorMessage(failure)
    applyMetadata(pageMetadata({
      title: `${notFound.value ? '文章不存在' : '文章加载失败'} | Dy's Blog`,
      path: route.path, noindex: true,
    }))
  } finally {
    if (current.isCurrent()) loading.value = false
  }
}

watch(() => route.params.slug, fetchPost, { immediate: true })
onUnmounted(() => postScope.cancel())
</script>

<template>
  <div v-if="loading" class="post-loading" role="status">加载中...</div>
  <div v-else-if="error" class="post-error-page" role="alert">
    <h2>{{ notFound ? '文章不存在' : '文章加载失败' }}</h2>
    <p>{{ error }}</p>
    <button v-if="!notFound" @click="fetchPost">重新加载</button>
    <router-link to="/">返回首页</router-link>
  </div>
  <article v-else-if="post" class="post-detail">
    <header class="post-header">
      <h1>{{ post.title }}</h1>
      <div class="post-meta">
        <time :datetime="post.created_at">{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</time>
        <router-link v-if="post.category" :to="`/category/${encodeURIComponent(post.category.slug)}`" class="cat-link">
          {{ post.category.name }}
        </router-link>
        <span v-for="tag in post.tags" :key="tag.slug" class="tag-badge">{{ tag.name }}</span>
      </div>
    </header>
    <img v-if="coverImage" :src="coverImage" class="cover" :alt="post.title"
      width="800" height="400" loading="eager" decoding="async" fetchpriority="high">
    <div class="post-content" v-html="contentHtml"></div>
  </article>
</template>

<style>
.post-detail { max-width: 800px; margin: 0 auto; overflow-wrap: anywhere; }
.post-detail .post-header { margin-bottom: 2rem; }
.post-detail .post-header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
.post-detail .post-meta { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; color: var(--text-muted); font-size: 0.9rem; }
.post-detail .cat-link { background: #2a2a4a; padding: 0.1rem 0.5rem; border-radius: 4px; }
.post-detail .tag-badge { background: #333; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
.post-detail > .cover { width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-radius: var(--radius); margin-bottom: 2rem; }
.post-loading, .post-error-page { text-align: center; padding: 3rem; }
.post-error-page p { margin: 0.5rem 0 1rem; }
.post-error-page button { margin-right: 1rem; }
</style>
