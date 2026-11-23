import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { safeImageUrl } from '../src/lib/images.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const stripImports = text => text.replace(/^import .+ from ['"].+['"]\r?\n/gm, '')
const plain = value => JSON.parse(JSON.stringify(value))
const response = (data, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const flush = async () => { await nextTick(); await new Promise(setImmediate); await nextTick() }
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const POST = { id: 1, title: '文章一', content: '正文一', tags: [], slug: 'first', published: false, pinned: false }

function http(handler) {
  const calls = []
  const exports = vm.runInNewContext(`${source('../src/lib/http.js').replace(/^export /gm, '')}
    ;({ HttpError, requestJson, createRequestScope, expectArray, errorMessage, isAbortError })`, {
    Headers, AbortController,
    fetch: async (url, options) => {
      calls.push({ url, options })
      return handler(url, options)
    },
  })
  return { ...exports, calls }
}

const query = vm.runInNewContext(`${source('../src/lib/blogQuery.js').replace(/^export /gm, '')}
  ;({ pageFromQuery, pageQuery, queryString })`)
const bindings = {
  BlogHome: 'posts,total,page,tag,loading,error,categories,tags,metaLoading,metaError,fetchPosts,fetchMeta,changePage,tagLocation',
  CategoryView: 'posts,total,page,loading,error,fetchPosts,changePage',
  PostDetail: 'post,error,notFound,loading,fetchPost',
  'admin/PostList': 'posts,loading,error,actionError,pendingId,fetchPosts,deletePost,togglePublish,togglePin',
  'admin/Categories': 'categories,newName,loading,saving,error,actionError,fetchCategories,addCategory,deleteCategory',
  'admin/PostEditor': 'form,categories,tags,loading,loaded,saving,uploading,loadError,saveError,uploadError,loadEditor,save,uploadImage',
  'admin/Dashboard': 'stats,admin,loading,error,logoutError,loggingOut,fetchDashboard,logout',
  'admin/Login': 'username,password,error,loading,login',
}

function page(name, handler, initial = {}) {
  const api = http(handler)
  const route = reactive({ params: {}, query: {}, ...initial })
  const mounts = []
  const unmounts = []
  const navigations = []
  const scope = effectScope()
  const navigate = (target, method = 'push') => {
    navigations.push({ target: plain(target), method })
    if (typeof target === 'object') {
      if (target.params) route.params = target.params
      if (target.query) route.query = target.query
    }
    return Promise.resolve()
  }
  const text = source(`../src/views/${name}.vue`).match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const state = scope.run(() => vm.runInNewContext(`${stripImports(text)}\n;({${bindings[name]}})`, {
    ...api, ...query, ref, computed, watch, safeImageUrl,
    useRoute: () => route,
    useRouter: () => ({ push: target => navigate(target), replace: target => navigate(target, 'replace') }),
    onMounted: callback => mounts.push(callback),
    onUnmounted: callback => unmounts.push(callback),
    URLSearchParams, FormData, confirm: () => true,
    takeBlogBootstrap: () => null,
    applyMetadata: () => {},
    pageMetadata: value => value,
    postMetadata: value => ({ title: value.title }),
    renderMarkdown: text => text,
    sanitizeHtml: text => text,
  }))
  return {
    ...state, api, route, navigations, navigate,
    async mount() { await Promise.all(mounts.map(callback => callback())); await flush() },
    unmount() { unmounts.forEach(callback => callback()); scope.stop() },
  }
}

async function editor(handler, params = { id: '1' }) {
  const view = page('admin/PostEditor', (url, options) => {
    if (url === '/api/blog/categories' || url === '/api/blog/tags') return response([])
    return handler(url, options)
  }, { params })
  await flush()
  return view
}

test('HTTP errors preserve status and detail, including structured FastAPI validation', async () => {
  const api = http(() => response({ detail: [
    { loc: ['body', 'title'], msg: '标题不能为空', type: 'required' },
    { loc: ['body', 'tag_ids', 0], msg: '无效标签' },
  ] }, 422))
  await assert.rejects(api.requestJson('/invalid'), error =>
    error.status === 422 && error.message === 'title: 标题不能为空；tag_ids.0: 无效标签')
  const unauthorized = http(() => response({ detail: '登录已过期' }, 401))
  await assert.rejects(unauthorized.requestJson('/private'), error => error.status === 401 && error.message === '登录已过期')
})

test('HTTP handles network errors, invalid success JSON, HTML failures and empty 204 consistently', async () => {
  const offline = http(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(offline.requestJson('/offline'), /网络连接失败/)
  const invalid = http(() => new Response('<html>proxy failure</html>', { status: 200 }))
  await assert.rejects(invalid.requestJson('/invalid'), /无法解析/)
  const failed = http(() => new Response('<html>proxy failure</html>', { status: 502 }))
  await assert.rejects(failed.requestJson('/failed'), error => error.status === 502 && error.message.includes('HTTP 502'))
  const empty = http(() => response(undefined, 204))
  assert.equal(await empty.requestJson('/delete'), null)
})

test('JSON writes and multipart upload use correct headers and forward AbortSignal', async () => {
  const api = http(() => response({ ok: true }))
  const controller = new AbortController()
  await api.requestJson('/save', { method: 'PUT', json: { title: '文章' }, signal: controller.signal })
  assert.equal(api.calls[0].options.body, '{"title":"文章"}')
  assert.equal(api.calls[0].options.headers.get('Content-Type'), 'application/json')
  assert.equal(api.calls[0].options.signal, controller.signal)
  const body = new FormData()
  body.append('file', new File(['image'], 'cover.png'))
  await api.requestJson('/upload', { method: 'POST', body })
  assert.equal(api.calls[1].options.headers.has('Content-Type'), false)
  assert.equal(api.calls[1].options.body, body)
})

test('request scopes abort old transports and also invalidate results from transports ignoring abort', () => {
  const api = http(() => response({}))
  const scope = api.createRequestScope()
  const first = scope.begin()
  const second = scope.begin()
  assert.equal(first.signal.aborted, true)
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  scope.cancel()
  assert.equal(second.signal.aborted, true)
  assert.equal(second.isCurrent(), false)
})

test('aborts remain distinguishable from network errors', async () => {
  const api = http(() => { throw new DOMException('Aborted', 'AbortError') })
  await assert.rejects(api.requestJson('/cancelled'), error => api.isAbortError(error))
})

test('page query parsing rejects malformed values while pagination preserves filters', () => {
  for (const value of [undefined, '0', '-1', '1.2', '1e2', 'NaN', '9999999999999999999', ['2']]) {
    assert.equal(query.pageFromQuery(value), 1)
  }
  assert.equal(query.pageFromQuery('5'), 5)
  assert.deepEqual(plain(query.pageQuery({ tag: 'vue', page: '5' }, 2)), { tag: 'vue', page: '2' })
  assert.deepEqual(plain(query.pageQuery({ tag: 'vue', page: '5' }, 1)), { tag: 'vue' })
})

test('detail failure immediately clears old article, distinguishes 404 and permits server-error retry', async () => {
  let status = 200
  const view = page('PostDetail', () => response(status === 200 ? POST : { detail: '读取失败' }, status), {
    params: { slug: 'first' },
  })
  await flush()
  assert.equal(view.post.value.title, POST.title)
  status = 404
  view.route.params.slug = 'missing'
  await nextTick()
  assert.equal(view.post.value, null)
  await flush()
  assert.equal(view.notFound.value, true)
  assert.equal(view.loading.value, false)
  status = 503
  await view.fetchPost()
  assert.equal(view.notFound.value, false)
  assert.equal(view.error.value, '读取失败')
  status = 200
  await view.fetchPost()
  assert.equal(view.error.value, '')
  assert.equal(view.post.value.title, POST.title)
  view.unmount()
})

test('detail late success and late failure never overwrite a newer route or clear its loading flag', async () => {
  const first = deferred()
  const second = deferred()
  const third = deferred()
  const view = page('PostDetail', url => url.endsWith('/first') ? first.promise : url.endsWith('/second') ? second.promise : third.promise, {
    params: { slug: 'first' },
  })
  view.route.params.slug = 'second'
  await nextTick()
  assert.equal(view.api.calls[0].options.signal.aborted, true)
  first.resolve(response(POST))
  await flush()
  assert.equal(view.loading.value, true)
  assert.equal(view.post.value, null)
  second.resolve(response({ ...POST, title: '文章二' }))
  await flush()
  assert.equal(view.post.value.title, '文章二')
  view.route.params.slug = 'third'
  await nextTick()
  third.reject(new TypeError('Offline'))
  await flush()
  assert.match(view.error.value, /网络连接失败/)
  view.unmount()
})

test('a later successful detail response beats an older failed response even if fetch ignores cancellation', async () => {
  const old = deferred()
  const view = page('PostDetail', url => url.endsWith('/first') ? old.promise : response({ ...POST, title: '文章二' }), {
    params: { slug: 'first' },
  })
  view.route.params.slug = 'second'
  await flush()
  old.resolve(response({ detail: '旧的错误' }, 500))
  await flush()
  assert.equal(view.post.value.title, '文章二')
  assert.equal(view.error.value, '')
  view.unmount()
})

test('blog list and metadata failures have independent retryable error states, never false empties', async () => {
  let failPosts = true
  let failMeta = true
  const view = page('BlogHome', url => {
    if (url.startsWith('/api/blog/posts?')) return response(failPosts ? { detail: '文章读取失败' } : { posts: [POST], total: 1 }, failPosts ? 500 : 200)
    return response(failMeta ? { detail: '标签读取失败' } : [], failMeta ? 503 : 200)
  })
  await view.mount()
  assert.equal(view.loading.value, false)
  assert.equal(view.metaLoading.value, false)
  assert.equal(view.error.value, '文章读取失败')
  assert.equal(view.metaError.value, '标签读取失败')
  failPosts = failMeta = false
  await Promise.all([view.fetchPosts(), view.fetchMeta()])
  assert.equal(view.posts.value.length, 1)
  assert.equal(view.error.value, '')
  assert.equal(view.metaError.value, '')
  view.unmount()
})

test('blog filters reset page in navigation links while URL pagination and history restore exact requests', async () => {
  const view = page('BlogHome', () => response({ posts: [POST], total: 60 }), { query: { tag: 'vue', page: '5' } })
  await flush()
  assert.match(view.api.calls.at(-1).url, /page=5.*tag=vue/)
  assert.deepEqual(plain(view.tagLocation('javascript')), { path: '/', query: { tag: 'javascript' } })
  await view.navigate(view.tagLocation('javascript'))
  await flush()
  assert.equal(view.page.value, 1)
  assert.match(view.api.calls.at(-1).url, /page=1.*tag=javascript/)
  view.changePage(3)
  await flush()
  assert.equal(view.route.query.page, '3')
  assert.equal(view.route.query.tag, 'javascript')
  await view.navigate({ query: { tag: 'vue', page: '5' } })
  await flush()
  assert.equal(view.page.value, 5)
  assert.match(view.api.calls.at(-1).url, /page=5.*tag=vue/)
  assert.deepEqual(plain(view.tagLocation()), { path: '/', query: {} })
  view.unmount()
})

test('blog list racing filter responses only commit the current URL snapshot', async () => {
  const old = deferred()
  const view = page('BlogHome', url => url.includes('tag=old') ? old.promise : response({ posts: [{ ...POST, title: '新标签' }], total: 1 }), {
    query: { tag: 'old', page: '4' },
  })
  await view.navigate(view.tagLocation('new'))
  await flush()
  old.resolve(response({ posts: [POST], total: 99 }))
  await flush()
  assert.equal(view.posts.value[0].title, '新标签')
  assert.equal(view.total.value, 1)
  assert.equal(view.page.value, 1)
  view.unmount()
})

test('category URL navigation resets page without destroying paginated back-navigation', async () => {
  const view = page('CategoryView', () => response({ posts: [POST], total: 80 }), {
    params: { slug: 'first' }, query: { page: '5' },
  })
  await flush()
  await view.navigate({ params: { slug: 'second' }, query: {} })
  await flush()
  assert.equal(view.page.value, 1)
  assert.match(view.api.calls.at(-1).url, /page=1.*category=second/)
  view.changePage(2)
  await flush()
  assert.equal(view.route.query.page, '2')
  await view.navigate({ params: { slug: 'first' }, query: { page: '5' } })
  await flush()
  assert.equal(view.page.value, 5)
  assert.match(view.api.calls.at(-1).url, /page=5.*category=first/)
  view.unmount()
})

test('category failure releases loading and stale requests cannot replace a new category', async () => {
  const old = deferred()
  let failed = true
  const view = page('CategoryView', url => {
    if (url.includes('category=old')) return old.promise
    return response(failed ? { detail: '分类读取失败' } : { posts: [POST], total: 1 }, failed ? 500 : 200)
  }, { params: { slug: 'old' } })
  view.route.params.slug = 'new'
  await flush()
  assert.equal(view.error.value, '分类读取失败')
  assert.equal(view.loading.value, false)
  failed = false
  await view.fetchPosts()
  old.resolve(response({ posts: [{ ...POST, title: '旧分类' }], total: 7 }))
  await flush()
  assert.equal(view.posts.value[0].title, POST.title)
  view.unmount()
})

test('admin article list read errors are explicit, release loading and can be retried', async () => {
  let fail = true
  const view = page('admin/PostList', () => response(fail ? { detail: '无权读取' } : [POST], fail ? 403 : 200))
  await view.mount()
  assert.equal(view.error.value, '无权读取')
  assert.equal(view.loading.value, false)
  fail = false
  await view.fetchPosts()
  assert.equal(view.error.value, '')
  assert.equal(view.posts.value.length, 1)
  view.unmount()
})

test('admin delete, publish and pin failures do not refresh or silently mutate the list', async () => {
  for (const action of ['deletePost', 'togglePublish', 'togglePin']) {
    let fail = true
    const view = page('admin/PostList', (_, options) => options.method
      ? response(fail ? { detail: '写入被拒绝' } : undefined, fail ? 409 : 204)
      : response([POST]))
    await view.mount()
    const arg = action === 'deletePost' ? POST.id : POST
    await view[action](arg)
    assert.equal(view.actionError.value, '写入被拒绝')
    assert.equal(view.pendingId.value, null)
    assert.equal(view.api.calls.length, 2)
    assert.equal(view.posts.value[0].published, false)
    fail = false
    await view[action](arg)
    assert.equal(view.api.calls.length, 4)
    assert.equal(view.actionError.value, '')
    view.unmount()
  }
})

test('list actions reject duplicate submissions and report post-save refresh failure separately', async () => {
  const write = deferred()
  let reads = 0
  const view = page('admin/PostList', (_, options) => options.method
    ? write.promise
    : (++reads === 1 ? response([POST]) : response({ detail: '刷新失败' }, 500)))
  await view.mount()
  const pending = view.togglePin(POST)
  await view.togglePin(POST)
  assert.equal(view.api.calls.length, 2)
  write.resolve(response(undefined, 204))
  await pending
  assert.equal(view.error.value, '刷新失败')
  assert.equal(view.actionError.value, '')
  assert.equal(view.pendingId.value, null)
  view.unmount()
})

test('category management retains entered names after failed add and checks delete status', async () => {
  let failRead = true
  let failWrite = true
  const view = page('admin/Categories', (_, options) => options.method
    ? response(failWrite ? { detail: '分类写入失败' } : undefined, failWrite ? 500 : 204)
    : response(failRead ? { detail: '分类读取失败' } : [{ id: 1, name: '分类' }], failRead ? 503 : 200))
  await view.mount()
  assert.equal(view.error.value, '分类读取失败')
  assert.equal(view.loading.value, false)
  failRead = false
  await view.fetchCategories()
  view.newName.value = '保留名称'
  await view.addCategory()
  assert.equal(view.newName.value, '保留名称')
  assert.equal(view.saving.value, false)
  assert.equal(view.actionError.value, '分类写入失败')
  await view.deleteCategory(1)
  assert.equal(view.categories.value.length, 1)
  failWrite = false
  await view.addCategory()
  assert.equal(view.newName.value, '')
  assert.equal(view.actionError.value, '')
  view.unmount()
})

test('editor load failures never enable saving a default empty document', async () => {
  let failed = true
  const view = await editor(() => response(failed ? { detail: '文章不存在' } : POST, failed ? 404 : 200))
  assert.equal(view.loaded.value, false)
  assert.equal(view.loading.value, false)
  assert.equal(view.loadError.value, '文章不存在')
  assert.equal(await view.save(), false)
  assert.equal(view.api.calls.some(call => call.options.method), false)
  failed = false
  await view.loadEditor()
  assert.equal(view.loaded.value, true)
  assert.equal(view.form.value.title, POST.title)
  view.unmount()
})

test('editor metadata failures are retryable and do not silently substitute empty selectors', async () => {
  let fail = true
  const view = page('admin/PostEditor', url => {
    if (url === '/api/blog/tags') return response(fail ? { detail: '标签读取失败' } : [], fail ? 500 : 200)
    return response(url === '/api/blog/categories' ? [] : POST)
  }, { params: { id: '1' } })
  await flush()
  assert.equal(view.loaded.value, false)
  assert.equal(view.loadError.value, '标签读取失败')
  fail = false
  await view.loadEditor()
  assert.equal(view.loaded.value, true)
  view.unmount()
})

test('editor save failures preserve content, release saving, prevent navigation and allow retry', async () => {
  let mode = 'offline'
  const view = await editor((_, options) => {
    if (!options.method) return response(POST)
    if (mode === 'offline') throw new TypeError('Offline')
    if (mode === 'validation') return response({ detail: [{ loc: ['body', 'title'], msg: '标题无效' }] }, 422)
    return response({ id: 1 })
  })
  view.form.value.content = '尚未保存的正文'
  assert.equal(await view.save(), false)
  assert.match(view.saveError.value, /网络连接失败/)
  assert.equal(view.saving.value, false)
  assert.equal(view.navigations.length, 0)
  assert.equal(view.form.value.content, '尚未保存的正文')
  mode = 'validation'
  await view.save()
  assert.equal(view.saveError.value, 'title: 标题无效')
  mode = 'success'
  assert.equal(await view.save(), true)
  assert.equal(view.saving.value, false)
  assert.equal(view.navigations.at(-1).target, '/admin/posts')
  view.unmount()
})

test('editor route changes cancel pending writes and never navigate from a stale successful save', async () => {
  const write = deferred()
  const view = await editor((url, options) => options.method
    ? write.promise
    : response({ ...POST, title: url.endsWith('/2') ? '文章二' : POST.title }))
  const pending = view.save()
  assert.equal(await view.save(), false)
  view.route.params.id = '2'
  await flush()
  write.resolve(response({ id: 1 }))
  await pending
  assert.equal(view.form.value.title, '文章二')
  assert.equal(view.navigations.length, 0)
  assert.equal(view.saving.value, false)
  assert.equal(view.api.calls.find(call => call.options.method)?.options.signal.aborted, true)
  view.unmount()
})

test('editor read races and edit-to-new reuse cannot carry another article into the form', async () => {
  const old = deferred()
  const view = await editor(url => url.endsWith('/1') ? old.promise : response({ ...POST, id: 2, title: '文章二' }))
  view.route.params.id = '2'
  await flush()
  old.resolve(response(POST))
  await flush()
  assert.equal(view.form.value.title, '文章二')
  delete view.route.params.id
  await flush()
  assert.equal(view.form.value.title, '')
  assert.equal(view.form.value.content, '')
  assert.equal(view.loaded.value, true)
  view.unmount()
})

test('upload checks HTTP status, restores retry input and appends content only after valid success', async () => {
  let mode = 'failure'
  const view = await editor((url) => {
    if (url !== '/api/admin/upload') return response(POST)
    if (mode === 'failure') return response({ detail: '图片过大' }, 413)
    return response(mode === 'invalid' ? {} : { url: '/static/uploads/cover.png' })
  })
  const input = { files: [new File(['image'], 'cover.png')], value: 'cover.png' }
  await view.uploadImage({ target: input })
  assert.equal(view.uploadError.value, '图片过大')
  assert.equal(view.uploading.value, false)
  assert.equal(view.form.value.content, POST.content)
  assert.equal(input.value, '')
  mode = 'invalid'
  await view.uploadImage({ target: input })
  assert.match(view.uploadError.value, /未返回图片地址/)
  mode = 'success'
  await view.uploadImage({ target: input })
  assert.match(view.form.value.content, /!\[cover\.png\]\(\/static\/uploads\/cover\.png\)/)
  assert.equal(view.uploadError.value, '')
  assert.equal(view.api.calls.find(call => call.url === '/api/admin/upload').options.headers.has('Content-Type'), false)
  view.unmount()
})

test('late upload results never append to a different article after a route change', async () => {
  const upload = deferred()
  const view = await editor(url => url === '/api/admin/upload' ? upload.promise : response(POST))
  const input = { files: [new File(['image'], 'cover.png')], value: 'cover.png' }
  const pending = view.uploadImage({ target: input })
  view.route.params.id = '2'
  await flush()
  upload.resolve(response({ url: '/old-image.png' }))
  await pending
  assert.equal(view.form.value.content, POST.content)
  assert.equal(view.uploading.value, false)
  view.unmount()
})

test('dashboard read failures are not zero statistics, and logout failures do not navigate', async () => {
  let failRead = true
  let failLogout = true
  const view = page('admin/Dashboard', (url) => {
    if (url.endsWith('/logout')) return response(failLogout ? { detail: '登出失败' } : undefined, failLogout ? 503 : 204)
    if (url.endsWith('/me')) return response({ username: 'admin' })
    return response(failRead ? { detail: '统计读取失败' } : [], failRead ? 500 : 200)
  })
  await view.mount()
  assert.equal(view.stats.value, null)
  assert.equal(view.error.value, '统计读取失败')
  assert.equal(view.loading.value, false)
  failRead = false
  await view.fetchDashboard()
  assert.deepEqual(plain(view.stats.value), { posts: 0, categories: 0 })
  await view.logout()
  assert.equal(view.logoutError.value, '登出失败')
  assert.equal(view.loggingOut.value, false)
  assert.equal(view.navigations.length, 0)
  failLogout = false
  await view.logout()
  assert.equal(view.navigations.at(-1).target, '/admin/login')
  view.unmount()
})

test('dashboard distinguishes expired authorization from network/server failure', async () => {
  for (const status of [401, 403, 500]) {
    const view = page('admin/Dashboard', () => response({ detail: '账户读取失败' }, status))
    await view.mount()
    assert.equal(view.navigations.length, status === 500 ? 0 : 1)
    if (status === 500) assert.equal(view.error.value, '账户读取失败')
    view.unmount()
  }
})

test('login preserves server rejection details, releases loading and supports corrected retry', async () => {
  let failure = true
  const view = page('admin/Login', () => response(failure ? { detail: '密码不正确' } : { ok: true }, failure ? 401 : 200))
  view.username.value = 'admin'
  view.password.value = 'wrong'
  await view.login()
  assert.equal(view.error.value, '密码不正确')
  assert.equal(view.loading.value, false)
  assert.equal(view.navigations.length, 0)
  failure = false
  await view.login()
  assert.equal(view.navigations.at(-1).target, '/admin')
  view.unmount()
})

test('unmount aborts reads and writes and prevents late state updates, refreshes or success navigation', async () => {
  for (const name of ['PostDetail', 'BlogHome', 'CategoryView', 'admin/PostList', 'admin/Categories', 'admin/Dashboard', 'admin/PostEditor']) {
    const pending = deferred()
    const view = page(name, () => pending.promise, { params: { slug: 'first', id: '1' } })
    const mounting = view.mount()
    view.unmount()
    assert.equal(view.api.calls.every(call => call.options.signal.aborted), true)
    pending.resolve(response(POST))
    await mounting
    assert.equal(view.navigations.length, 0)
    if ('post' in view) assert.equal(view.post.value, null)
    if ('loaded' in view) assert.equal(view.loaded.value, false)
  }
  const pending = deferred()
  const login = page('admin/Login', () => pending.promise)
  const request = login.login()
  await login.login()
  login.unmount()
  pending.resolve(response({ ok: true }))
  await request
  assert.equal(login.navigations.length, 0)
  assert.equal(login.api.calls.length, 1)
})

test('all changed page templates compile and expose errors separately from empty state', () => {
  for (const name of Object.keys(bindings)) {
    const filename = `${name}.vue`
    const { descriptor, errors } = parse(source(`../src/views/${filename}`), { filename })
    assert.deepEqual(errors, [], filename)
    const result = compileTemplate({ source: descriptor.template.content, filename, id: name.replaceAll('/', '-') })
    assert.deepEqual(result.errors, [], filename)
    assert.match(descriptor.template.content, /role="alert"/, filename)
  }
})
