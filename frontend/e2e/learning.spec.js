import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`blog, learning and game navigation at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const response = await page.goto('/')
    await expect(page.locator('.site-header')).toBeVisible()
    expect(await response.text()).toContain('blog-bootstrap')
    const headerColor = await page.locator('.site-header').evaluate(node => getComputedStyle(node).backgroundColor)
    await page.getByRole('navigation', { name: '站点导航' }).getByRole('link', { name: '学习资料' }).click()
    await expect(page).toHaveURL(/\/learn\/$/)
    await expect(page.locator('#course-count')).not.toBeEmpty()
    await expect(page.locator('.site-header')).toBeVisible()
    expect(await page.locator('.site-header').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(headerColor)
    expect(await page.evaluate(() => window.learningData.groups.length)).toBe(4)
    expect(await page.evaluate(() => JSON.stringify(window.learningData))).not.toMatch(/n[\s_-]*project/i)
    await expect(page.locator('.top-link')).toHaveCount(0)
    await page.locator('#search').fill('n_project')
    await page.locator('#search-form').getByRole('button', { name: '搜索' }).click()
    await expect(page.locator('.result')).toHaveCount(0)
    await page.goto('/learn/')
    await expect(page.locator('#intro h1')).toBeVisible()
    expect(await page.locator('.visual').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe(headerColor)
    await page.locator('#search').fill('DMA')
    await page.locator('#search-form').getByRole('button', { name: '搜索' }).click()
    await expect(page.locator('.result').first()).toBeVisible()
    await page.locator('.result a').first().click()
    await expect(page.locator('#intro h1')).toBeVisible()
    const chapterUrl = page.url()
    await page.reload()
    await expect(page.locator('#intro h1')).toBeVisible()
    await expect(page).toHaveURL(chapterUrl)
    await page.getByRole('button', { name: '标记已学', exact: true }).click()
    await expect(page.getByRole('button', { name: /已学/ })).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect(page.getByRole('button', { name: /已学/ })).toHaveAttribute('aria-pressed', 'true')
    const source = page.getByRole('link', { name: /查看原文/ })
    expect((await page.request.get(new URL(await source.getAttribute('href'), page.url()).href)).status()).toBe(200)
    for (const href of await page.locator('.top-link').evaluateAll(nodes => nodes.map(node => node.href))) {
      expect((await page.request.get(href)).status()).toBe(200)
    }
    if (viewport.width < 560) {
      await page.getByRole('button', { name: '课程目录', exact: true }).click()
      await expect(page.locator('#sidebar')).toBeVisible()
      const headerBottom = await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().bottom)
      const sidebarTop = await page.locator('#sidebar').evaluate(node => node.getBoundingClientRect().top)
      expect(sidebarTop).toBeGreaterThanOrEqual(headerBottom - 1)
      await page.getByRole('button', { name: '课程目录', exact: true }).click()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`learning-${viewport.width}.png`), fullPage: true })
    const navigation = page.getByRole('navigation', { name: '站点导航' })
    await navigation.getByRole('link', { name: '游戏大厅' }).click()
    await expect(page).toHaveURL(/\/game$/)
    await expect(page.locator('.site-header')).toBeVisible()
    await navigation.getByRole('link', { name: '博客', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.blog-home')).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('learning resources have real 404s and do not publish personal documents', async ({ request }) => {
  for (const path of ['/learn/missing.js', '/learn/resources/05_works/resume_draft.docx', '/learn/resources/others/drafts.7z', '/learn/.git/config', '/learn/resources/04_n_project/README.md', '/learn/resources/03_emulator/04_n_project_and_acceleration.md', '/learn/resources/01_soc_design/01_architecture_and_data.md', '/learn/resources/00_start/visuals/assets/mechanisms_demo.html', '/learn/resources/01_soc_design/interconnect_topology/assets/topology_demo.html']) {
    expect((await request.get(path)).status()).toBe(404)
  }
})
