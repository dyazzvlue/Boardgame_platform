import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

function harness(accept = true) {
  const watchers = []
  const calls = []
  const store = {
    myIdx: 0, isMyTurn: true, error: '',
    gameState: { players: [{ money: 10 }] },
    request: { request_id: 'bid-1', kind: 'bid', data: { min_bid: 5 } },
    respond(kind, value) { if (accept) calls.push({ kind, value }); return accept },
  }
  const source = readFileSync(new URL('../src/components/games/ManilaGame.vue', import.meta.url), 'utf8')
    .match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .+ from ['"].+['"]\r?\n/gm, '')
  const component = vm.runInNewContext(`${source}\n;({ bidAmount, shipPlacements, submitBid })`, {
    ref: value => ({ value }),
    computed: getter => ({ get value() { return getter() } }),
    useGameStore: () => store,
    watch(getter, callback, options) {
      watchers.push({ getter, callback, previous: getter() })
      if (options?.immediate) callback()
    },
  })
  return {
    ...component, store, calls,
    flush() {
      for (const watcher of watchers) {
        const next = watcher.getter()
        if (next !== watcher.previous) {
          watcher.previous = next
          watcher.callback()
        }
      }
    },
  }
}

test('a new bidding request starts at the minimum without focusing the input', () => {
  const h = harness()
  assert.equal(h.bidAmount.value, 5)
  assert.equal(h.submitBid(), true)
  assert.deepEqual(h.calls, [{ kind: 'bid', value: 5 }])
})

test('invalid, below-minimum and unaffordable bids are not submitted', () => {
  const h = harness()
  for (const value of [0, NaN, 5.5, 11, '']) {
    h.bidAmount.value = value
    assert.equal(h.submitBid(), false)
  }
  assert.equal(h.calls.length, 0)
  assert.notEqual(h.store.error, '')
})

test('a failed send preserves edits, while a new request resets operation state', () => {
  const h = harness(false)
  h.bidAmount.value = 7
  h.shipPlacements.value = { silk: 2 }
  assert.equal(h.submitBid(), false)
  assert.equal(h.bidAmount.value, 7)
  h.store.request = { request_id: 'bid-2', kind: 'bid', data: { min_bid: 6 } }
  h.flush()
  assert.equal(h.bidAmount.value, 6)
  assert.equal(Object.keys(h.shipPlacements.value).length, 0)
})
