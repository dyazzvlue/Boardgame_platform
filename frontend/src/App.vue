<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isAdmin = computed(() => route.path.startsWith('/admin'))
</script>

<template>
  <div id="app-root" :class="{ 'admin-layout': isAdmin }">
    <header v-if="!isAdmin" class="site-header">
      <nav class="nav-bar">
        <router-link to="/" class="logo">Dy's Blog</router-link>
        <div class="nav-links">
          <router-link to="/">博客</router-link>
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

<style scoped>
.site-header {
  background: #1a1a2e;
  border-bottom: 1px solid #333;
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-bar {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.8rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo {
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
  text-decoration: none;
}
.nav-links {
  display: flex;
  gap: 1.5rem;
}
.nav-links a {
  color: #ccc;
  text-decoration: none;
  font-size: 0.95rem;
  transition: color 0.2s;
}
.nav-links a:hover,
.nav-links a.router-link-active {
  color: #64b5f6;
}
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
