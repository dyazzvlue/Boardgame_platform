import { createRouter, createWebHistory } from 'vue-router'

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

export default router
