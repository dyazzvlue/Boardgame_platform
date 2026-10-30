import { createRouter, createWebHistory } from 'vue-router'
import { applyMetadata, pageMetadata } from './lib/blogPage.js'

const routes = [
  {
    path: '/',
    name: 'BlogHome',
    component: () => import('./views/BlogHome.vue'),
  },
  {
    path: '/post/:slug',
    name: 'PostDetail',
    component: () => import('./views/PostDetail.vue'),
  },
  {
    path: '/category/:slug',
    name: 'CategoryView',
    component: () => import('./views/CategoryView.vue'),
  },
  {
    path: '/game',
    name: 'GameLobby',
    component: () => import('./views/game/GameLobby.vue'),
  },
  {
    path: '/game/:roomCode',
    name: 'GameRoom',
    component: () => import('./views/game/GameRoom.vue'),
  },
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('./views/admin/Login.vue'),
  },
  {
    path: '/admin',
    name: 'AdminDashboard',
    component: () => import('./views/admin/Dashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/posts',
    name: 'AdminPosts',
    component: () => import('./views/admin/PostList.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/posts/new',
    name: 'AdminPostNew',
    component: () => import('./views/admin/PostEditor.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/posts/:id/edit',
    name: 'AdminPostEdit',
    component: () => import('./views/admin/PostEditor.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/admin/categories',
    name: 'AdminCategories',
    component: () => import('./views/admin/Categories.vue'),
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：管理后台需要登录
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth) {
    try {
      const res = await fetch('/api/admin/me')
      if (!res.ok) return { name: 'AdminLogin' }
    } catch {
      return { name: 'AdminLogin' }
    }
  }
})

router.afterEach((to, from, failure) => {
  if (failure || ['BlogHome', 'CategoryView', 'PostDetail'].includes(to.name)) return
  applyMetadata(pageMetadata({
    title: to.path.startsWith('/game') ? "游戏大厅 | Dy's Blog"
      : to.path.startsWith('/admin') ? "管理后台 | Dy's Blog" : "Dy's Blog",
    path: to.fullPath,
    noindex: to.path.startsWith('/admin') || to.path.startsWith('/game'),
  }))
})

export default router
