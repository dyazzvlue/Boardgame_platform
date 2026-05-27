<script setup>
defineProps({ post: Object })
</script>

<template>
  <article class="post-card card" :class="{ pinned: post.pinned }">
    <router-link :to="`/post/${post.slug}`" class="post-link">
      <img v-if="post.cover_image" :src="post.cover_image" class="cover" alt="">
      <div class="post-body">
        <h2>
          <span v-if="post.pinned" class="pin-badge">📌 置顶</span>
          {{ post.title }}
        </h2>
        <div class="meta">
          <time>{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</time>
          <span v-if="post.category" class="category">{{ post.category.name }}</span>
        </div>
        <div class="tags" v-if="post.tags.length">
          <span v-for="tag in post.tags" :key="tag.slug" class="tag">{{ tag.name }}</span>
        </div>
      </div>
    </router-link>
  </article>
</template>

<style scoped>
.post-card { margin-bottom: 1.2rem; overflow: hidden; transition: border-color 0.2s; }
.post-card:hover { border-color: var(--accent); }
.post-card.pinned { border-left: 3px solid var(--accent); background: rgba(74, 144, 226, 0.05); }
.post-link { display: flex; gap: 1rem; text-decoration: none; color: inherit; }
.cover { width: 160px; height: 100px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.post-body h2 { font-size: 1.1rem; margin-bottom: 0.3rem; }
.pin-badge { font-size: 0.75rem; background: var(--accent); color: #fff; padding: 0.1rem 0.4rem; border-radius: 3px; margin-right: 0.4rem; }
.meta { font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 0.8rem; }
.category { background: #2a2a4a; padding: 0 0.4rem; border-radius: 3px; }
.tags { margin-top: 0.4rem; display: flex; gap: 0.3rem; }
.tag { background: #333; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
@media (max-width: 600px) {
  .post-link { flex-direction: column; }
  .cover { width: 100%; height: 150px; }
}
</style>
