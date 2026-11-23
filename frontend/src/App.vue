<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isAdmin = computed(() => route.path.startsWith('/admin'))
</script>

<template>
  <div id="app-root" :class="{ 'admin-layout': isAdmin }">
    <header v-if="!isAdmin" class="site-header">
      <nav class="nav-bar" aria-label="站点导航">
        <router-link to="/" class="logo">Dy's Blog</router-link>
        <div class="nav-links">
          <router-link to="/">博客</router-link>
          <a href="/learn/">学习资料</a>
          <router-link to="/game">游戏大厅</router-link>
        </div>
      </nav>
    </header>
    <main class="main-content">
      <router-view />
    </main>
    <footer v-if="!isAdmin" class="site-footer">
      <p>&copy; 2026 Dy's Game Room. All rights reserved.</p>
    </footer>
  </div>
</template>

<style>
.main-content {
  min-height: calc(100vh - 140px);
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.site-footer {
  text-align: center;
  padding: 1.5rem;
  color: #666;
  border-top: 1px solid #333;
}
</style>
