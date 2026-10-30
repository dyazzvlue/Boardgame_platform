export function safeImageUrl(value) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (!url || /[\u0000-\u0020\u007f\\]/.test(url) || url.startsWith('//')) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) return ''
  try {
    const parsed = new URL(url, 'https://blog.invalid')
    return ['http:', 'https:'].includes(parsed.protocol) ? url : ''
  } catch {
    return ''
  }
}
