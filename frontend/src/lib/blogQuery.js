export function queryString(value) {
  return typeof value === 'string' ? value : ''
}

export function pageFromQuery(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) ? page : 1
}

export function pageQuery(query, page) {
  const next = { ...query }
  if (Number.isSafeInteger(page) && page > 1) next.page = String(page)
  else delete next.page
  return next
}
