import { expect, test } from '@playwright/test'

test('the initial article response contains readable content without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  try {
    const page = await context.newPage()
    const response = await page.goto('/post/browser-article-01')
    expect(response.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Browser article 01', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Browser SSR heading', exact: true })).toBeVisible()
    await expect(page.getByText('Visible without JavaScript.', { exact: true })).toBeVisible()
    await expect(page).toHaveTitle(/Browser article 01/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/post/browser-article-01`)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Browser article 01/)
    expect(await response.text()).toContain('blog-bootstrap')
    await page.goto('/?page=2')
    await expect(page.getByRole('link', { name: /Browser article 01/ }).first()).toBeVisible()
    await expect(page.locator('a[href*="page=1"], a[href="/"]').first()).toBeVisible()
  } finally {
    await context.close()
  }
})

test('Vue consumes the bootstrap without refetching and updates SEO during navigation', async ({ page }) => {
  const failures = []
  let detailRequests = 0
  page.on('pageerror', error => failures.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/blog/posts/browser-article-01') detailRequests++
  })
  await page.goto('/post/browser-article-01')
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__ && document.querySelector('.post-detail'))
  await expect(page.getByRole('heading', { name: 'Browser article 01', exact: true })).toBeVisible()
  expect(detailRequests).toBe(0)
  await expect(page.locator('.post-content img').first()).toHaveAttribute('loading', 'lazy')
  await expect(page.locator('article > img')).toHaveAttribute('fetchpriority', 'high')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/favicon.svg$/)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('?source=test'))
  await expect(page).toHaveTitle(/Browser article 01/)
  expect(detailRequests).toBe(0)
  await page.getByRole('link', { name: 'Browser category', exact: true }).click()
  await expect(page).toHaveURL(/\/category\/browser$/)
  await page.getByRole('link', { name: /Browser article 12/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Browser article 12', exact: true })).toBeVisible()
  await expect(page).toHaveTitle(/Browser article 12/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/post\/browser-article-12$/)
  await page.locator('a[href="/game"]').first().click()
  await expect(page).toHaveURL(/\/game$/)
  await expect(page).not.toHaveTitle(/Browser article 12/)
  await expect(page.locator('script[type="application/ld+json"][data-blog-meta]')).toHaveCount(0)
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
  expect(failures).toEqual([])
})

test('drafts return a real 404 and only published pages appear in the sitemap', async ({ request, baseURL }) => {
  const draft = await request.get('/post/browser-private-draft')
  expect(draft.status()).toBe(404)
  const html = await draft.text()
  expect(html).not.toContain('DRAFT_MUST_NOT_LEAK')
  expect(html).not.toContain('Private draft')
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBeTruthy()
  const xml = await sitemap.text()
  expect(xml).toContain(`${baseURL}/post/browser-article-01`)
  expect(xml).not.toContain('browser-private-draft')
  const robots = await request.get('/robots.txt')
  expect(await robots.text()).toContain('Disallow: /admin')
})

test('published edits and unpublishing are reflected by SSR immediately', async ({ request }) => {
  const login = await request.post('/api/admin/login', {
    data: { username: 'browser-admin', password: 'browser-test-only' },
  })
  expect(login.ok()).toBeTruthy()
  const created = await request.post('/api/admin/posts', {
    data: { title: 'Live SSR mutation', slug: 'browser-live-ssr', content: 'ORIGINAL_BODY', published: true },
  })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  try {
    expect(await (await request.get('/post/browser-live-ssr')).text()).toContain('<p>ORIGINAL_BODY</p>')
    const update = await request.put(`/api/admin/posts/${id}`, { data: { content: 'UPDATED_BODY' } })
    expect(update.ok()).toBeTruthy()
    const updated = await (await request.get('/post/browser-live-ssr')).text()
    expect(updated).toContain('<p>UPDATED_BODY</p>')
    expect(updated).not.toContain('ORIGINAL_BODY')
    const unpublish = await request.put(`/api/admin/posts/${id}`, { data: { published: false } })
    expect(unpublish.ok()).toBeTruthy()
    const hidden = await request.get('/post/browser-live-ssr')
    expect(hidden.status()).toBe(404)
    expect(await hidden.text()).not.toContain('UPDATED_BODY')
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain('browser-live-ssr')
  } finally {
    expect((await request.delete(`/api/admin/posts/${id}`)).ok()).toBeTruthy()
  }
})

test('server and client Markdown do not execute article HTML', async ({ page, request }) => {
  await request.post('/api/admin/login', {
    data: { username: 'browser-admin', password: 'browser-test-only' },
  })
  const created = await request.post('/api/admin/posts', {
    data: {
      title: 'Safe Markdown', slug: 'browser-safe-markdown', published: true,
      content: '## Safe heading\n\n<img src="x" onerror="window.__blog_xss=1">'
        + '<script>window.__blog_xss=1</script>\n\n[bad](javascript:alert(1))',
    },
  })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  try {
    await page.goto('/post/browser-safe-markdown')
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__ && document.querySelector('.post-detail'))
    await expect(page.getByRole('heading', { name: 'Safe heading', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.__blog_xss)).toBeUndefined()
    await expect(page.locator('.post-content script, .post-content [onerror], .post-content a[href^="javascript:"]')).toHaveCount(0)
    await page.goto('/')
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
    await page.getByRole('link', { name: /Safe Markdown/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Safe heading', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.__blog_xss)).toBeUndefined()
    await expect(page.locator('.post-content script, .post-content [onerror], .post-content a[href^="javascript:"]')).toHaveCount(0)
  } finally {
    expect((await request.delete(`/api/admin/posts/${id}`)).ok()).toBeTruthy()
  }
})

test('list and category bootstraps do not duplicate API requests', async ({ page }) => {
  const requests = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/blog/')) requests.push(request.url())
  })
  await page.goto('/?page=2')
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
  await expect(page.locator('.post-card')).toHaveCount(2)
  expect(requests).toEqual([])
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.locator('.post-card')).toHaveCount(10)
  expect(requests).toHaveLength(1)
  requests.length = 0
  await page.goto('/category/browser?page=2')
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
  await expect(page.locator('.post-card')).toHaveCount(2)
  expect(requests).toEqual([])
})

test('a missing article keeps SSR 404 state without fetching private content', async ({ page }) => {
  let requests = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/blog/posts/browser-private-draft') requests++
  })
  expect((await page.goto('/post/browser-private-draft')).status()).toBe(404)
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
  await expect(page.getByRole('heading', { name: '文章不存在', exact: true })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  expect(requests).toBe(0)
})

test('mobile SSR includes styles and sized images without horizontal overflow', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 375, height: 812 } })
  try {
    const page = await context.newPage()
    for (const path of ['/post/browser-article-01', '/?page=2', '/category/browser']) {
      await page.goto(path)
      const layout = await page.evaluate(() => ({
        contentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        headerColor: getComputedStyle(document.querySelector('.site-header')).backgroundColor,
        imageDecoding: document.querySelector('img')?.decoding,
      }))
      expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth)
      expect(layout.headerColor).toBe('rgb(26, 26, 46)')
      expect(layout.imageDecoding).toBe('async')
    }
  } finally {
    await context.close()
  }
})

test('editor preview sanitizes Markdown while preserving the original editable source', async ({ page }) => {
  expect((await page.request.post('/api/admin/login', {
    data: { username: 'browser-admin', password: 'browser-test-only' },
  })).ok()).toBeTruthy()
  await page.goto('/admin/posts/new')
  const markdown = '## Preview heading\n\n<img src="x" onerror="window.__preview_xss=1">'
    + '<script>window.__preview_xss=1</script>\n\n![sample](/favicon.svg)'
  await page.locator('.editor-textarea').fill(markdown)
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preview heading', exact: true })).toBeVisible()
  await expect(page.locator('.preview script, .preview [onerror]')).toHaveCount(0)
  await expect(page.locator('.preview img').last()).toHaveAttribute('loading', 'lazy')
  expect(await page.evaluate(() => window.__preview_xss)).toBeUndefined()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.locator('.editor-textarea')).toHaveValue(markdown)
})

test('a malformed optional cover cannot break article rendering or metadata', async ({ page, request }) => {
  await request.post('/api/admin/login', {
    data: { username: 'browser-admin', password: 'browser-test-only' },
  })
  const created = await request.post('/api/admin/posts', {
    data: {
      title: 'Invalid optional cover', slug: 'browser-invalid-cover', published: true,
      content: '## Article stays readable', cover_image: 'https://images.example.com:bad/a.png',
    },
  })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  try {
    await page.goto('/')
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__)
    await page.getByRole('link', { name: /Invalid optional cover/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Article stays readable', exact: true })).toBeVisible()
    await expect(page).toHaveTitle(/Invalid optional cover/)
    await expect(page.locator('article > img, meta[property="og:image"]')).toHaveCount(0)
    expect(failures).toEqual([])
  } finally {
    expect((await request.delete(`/api/admin/posts/${id}`)).ok()).toBeTruthy()
  }
})
