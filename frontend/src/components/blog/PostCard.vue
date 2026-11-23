<script setup>
import { computed } from 'vue'
import { safeImageUrl } from '@/lib/images.js'

const props = defineProps({ post: Object })
const coverImage = computed(() => safeImageUrl(props.post.cover_image))
</script>

<template>
  <article class="post-card card" :class="{ pinned: post.pinned }">
    <router-link :to="`/post/${encodeURIComponent(post.slug)}`" class="post-link">
      <img v-if="coverImage" :src="coverImage" class="cover" alt=""
        width="160" height="100" loading="lazy" decoding="async">
      <div class="post-body">
        <h2>
          <span v-if="post.pinned" class="pin-badge">📌 置顶</span>
          {{ post.title }}
        </h2>
        <div class="meta">
          <time :datetime="post.created_at">{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</time>
          <span v-if="post.category" class="category">{{ post.category.name }}</span>
        </div>
        <div class="tags" v-if="post.tags.length">
          <span v-for="tag in post.tags" :key="tag.slug" class="tag">{{ tag.name }}</span>
        </div>
      </div>
    </router-link>
  </article>
</template>

<style>
.post-card { margin-bottom: 1.2rem; overflow: hidden; transition: border-color 0.2s; }
.post-card:hover { border-color: var(--accent); }
.post-card.pinned { border-left: 3px solid var(--accent); background: rgba(74, 144, 226, 0.05); }
.post-card .post-link { display: flex; gap: 1rem; text-decoration: none; color: inherit; }
.post-card .cover { width: 160px; height: 100px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.post-card .post-body { min-width: 0; overflow-wrap: anywhere; }
.post-card .post-body h2 { font-size: 1.1rem; margin-bottom: 0.3rem; }
.post-card .pin-badge { font-size: 0.75rem; background: var(--accent); color: #fff; padding: 0.1rem 0.4rem; border-radius: 3px; margin-right: 0.4rem; }
.post-card .meta { font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 0.8rem; flex-wrap: wrap; }
.post-card .category { background: #2a2a4a; padding: 0 0.4rem; border-radius: 3px; }
.post-card .tags { margin-top: 0.4rem; display: flex; flex-wrap: wrap; gap: 0.3rem; }
.post-card .tag { background: #333; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
@media (max-width: 600px) {
  .post-card .post-link { flex-direction: column; }
  .post-card .cover { width: 100%; height: 150px; }
}
</style>
