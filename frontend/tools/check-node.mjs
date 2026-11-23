import { pathToFileURL } from 'node:url'

export function isSupportedNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return (major === 22 && minor >= 12) || major >= 24
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!isSupportedNodeVersion(process.versions.node)) {
    console.error(`Node.js ${process.versions.node} is unsupported. Use Node 22.12+ (22.x) or 24+. See .nvmrc.`)
    process.exitCode = 1
  }
}
