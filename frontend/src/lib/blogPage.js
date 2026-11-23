import { safeImageUrl } from './images.js'

const siteTitle = "Dy's Blog"
const siteDescription = '个人博客与多人联机桌游。'
const baseUrl = document.querySelector('meta[name="blog-base-url"]')?.content || location.origin

export function takeBlogBootstrap(kind) {
  const element = document.getElementById('blog-bootstrap')
  if (!element) return null
  element.remove()
  try {
    const data = JSON.parse(element.textContent)
    const url = new URL(data.url)
    if (data.kind !== kind || url.pathname !== location.pathname || url.search !== location.search) return null
    return data
  } catch (error) {
    console.error('Invalid blog bootstrap; reloading from API', error)
    return null
  }
}

export function pageMetadata({ title = siteTitle, description = siteDescription, path = '/', noindex = false } = {}) {
  return {
    title, description, canonical: baseUrl + path, type: 'website',
    robots: noindex ? 'noindex, nofollow' : 'index, follow',
  }
}

export function postMetadata(post) {
  const meta = pageMetadata({
    title: `${post.title} | ${siteTitle}`, description: post.description || siteDescription,
    path: `/post/${encodeURIComponent(post.slug)}`,
  })
  meta.type = 'article'
  const image = safeImageUrl(post.cover_image)
  meta.image = image ? new URL(image, meta.canonical).href : ''
  const isoDate = value => new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`,
  ).toISOString()
  meta.published = isoDate(post.created_at)
  meta.modified = isoDate(post.updated_at)
  meta.structured = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: meta.description, datePublished: meta.published,
    dateModified: meta.modified, mainEntityOfPage: meta.canonical,
    ...(meta.image ? { image: meta.image } : {}),
  }
  return meta
}

export function applyMetadata(meta) {
  document.title = meta.title
  document.querySelectorAll('[data-blog-meta]').forEach(element => element.remove())
  const addMeta = (kind, name, content) => {
    if (!content) return
    const element = document.createElement('meta')
    element.setAttribute(kind, name)
    element.content = content
    element.dataset.blogMeta = ''
    document.head.append(element)
  }
  const canonical = document.createElement('link')
  canonical.rel = 'canonical'
  canonical.href = meta.canonical
  canonical.dataset.blogMeta = ''
  document.head.append(canonical)
  for (const [name, content] of Object.entries({
    description: meta.description, robots: meta.robots,
    'blog-base-url': baseUrl,
    'twitter:card': meta.image ? 'summary_large_image' : 'summary',
    'twitter:title': meta.title, 'twitter:description': meta.description, 'twitter:image': meta.image,
  })) addMeta('name', name, content)
  for (const [name, content] of Object.entries({
    'og:title': meta.title, 'og:description': meta.description, 'og:type': meta.type,
    'og:url': meta.canonical, 'og:image': meta.image,
    'article:published_time': meta.published, 'article:modified_time': meta.modified,
  })) addMeta('property', name, content)
  if (meta.structured) {
    const element = document.createElement('script')
    element.type = 'application/ld+json'
    element.dataset.blogMeta = ''
    element.textContent = JSON.stringify(meta.structured)
    document.head.append(element)
  }
}
