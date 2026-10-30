import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { safeImageUrl } from './images.js'

export function sanitizeHtml(html) {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'del', 'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'class', 'start'],
  })
  for (const image of fragment.querySelectorAll('img')) {
    const src = safeImageUrl(image.getAttribute('src'))
    if (!src) {
      image.remove()
      continue
    }
    image.setAttribute('src', src)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
    for (const name of ['width', 'height']) {
      if (image.hasAttribute(name) && !/^[1-9]\d{0,4}$/.test(image.getAttribute(name))) image.removeAttribute(name)
    }
  }
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

export function renderMarkdown(content) {
  return sanitizeHtml(marked.parse(content || ''))
}
