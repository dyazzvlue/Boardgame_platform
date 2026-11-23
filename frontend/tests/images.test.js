import assert from 'node:assert/strict'
import test from 'node:test'
import { safeImageUrl } from '../src/lib/images.js'

test('image URLs reject executable protocols, invalid ports and ambiguous network paths', () => {
  for (const value of [null, undefined, '', 'javascript:alert(1)', 'data:image/svg+xml,bad',
    '//images.example.com/a.png', 'http:images.example.com/a.png', '\\images.example.com',
    'https://images.example.com:bad/a.png', 'https://exa%mple.com/a.png', 'https://a.test/\nb']) {
    assert.equal(safeImageUrl(value), '', String(value))
  }
})

test('image URLs preserve valid local, relative and http(s) sources', () => {
  for (const value of ['/static/uploads/a.png', 'image.png', '../image.png',
    'https://images.example.com/a.png', 'http://localhost:8000/a.png']) {
    assert.equal(safeImageUrl(value), value)
  }
  assert.equal(safeImageUrl(' /favicon.svg '), '/favicon.svg')
})
