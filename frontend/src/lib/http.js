export class HttpError extends Error {
  constructor(message, status = 0, detail = null) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
  }
}

function detailMessage(detail) {
  if (typeof detail === 'string') return detail.trim()
  if (Array.isArray(detail)) return detail.map(detailMessage).filter(Boolean).join('；')
  if (detail && typeof detail === 'object') {
    const message = detailMessage(detail.msg || detail.message || detail.detail)
    const location = Array.isArray(detail.loc) ? detail.loc.filter(part => part !== 'body').join('.') : ''
    return message && location ? `${location}: ${message}` : message
  }
  return ''
}

export function isAbortError(error) {
  return error?.name === 'AbortError'
}

export function errorMessage(error) {
  return error?.message || '请求失败，请稍后重试'
}

export async function requestJson(url, { json, headers, ...options } = {}) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept', 'application/json')
  if (json !== undefined) {
    requestHeaders.set('Content-Type', 'application/json')
    options.body = JSON.stringify(json)
  }
  let response
  let text
  try {
    response = await fetch(url, { credentials: 'same-origin', ...options, headers: requestHeaders })
    text = await response.text()
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new HttpError('网络连接失败，请稍后重试')
  }
  let data = null
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      if (response.ok) throw new HttpError('服务器返回了无法解析的数据，请重试', response.status)
    }
  }
  if (!response.ok) {
    const detail = data?.detail ?? data?.message ?? data?.msg ?? data
    const message = detailMessage(detail)
    throw new HttpError(message || `请求失败（HTTP ${response.status}）`, response.status, detail)
  }
  return data
}

export function expectArray(data) {
  if (!Array.isArray(data)) throw new HttpError('服务器返回的列表数据格式不正确，请重试')
  return data
}

export function createRequestScope() {
  // Cancellation saves work; the sequence check also rejects transports that ignore abort.
  let sequence = 0
  let controller = null
  return {
    begin() {
      controller?.abort()
      controller = new AbortController()
      const current = ++sequence
      const signal = controller.signal
      return { signal, isCurrent: () => sequence === current && !signal.aborted }
    },
    cancel() {
      sequence += 1
      controller?.abort()
      controller = null
    },
  }
}
