import assert from 'node:assert/strict'
import test from 'node:test'
import { isSupportedNodeVersion } from '../tools/check-node.mjs'

test('build runtime constraints match the supported LTS ranges', () => {
  for (const version of ['18.20.8', '20.19.0', '21.7.3', '22.11.0', '23.11.0', 'invalid']) {
    assert.equal(isSupportedNodeVersion(version), false, version)
  }
  for (const version of ['22.12.0', '22.22.1', '24.0.0', '26.1.0']) {
    assert.equal(isSupportedNodeVersion(version), true, version)
  }
})
