// tests/artifact.mjs — the committed bundles must be built from the committed
// sources.
//
// `lib/` is shipped, so a stale artifact is a real defect: the deployed plugin
// then runs code nobody reviewed against those sources. This is not hypothetical
// -- `npm run build` was found leaving `lib/client.js` behind while rebuilding
// the host half, so a fix could pass typecheck and tests (which run against the
// artifact) while the artifact still held the old code.
import { strict as assert } from 'node:assert'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Newest modification time under a directory, or 0 when it has no files. */
function newest(dir, filter = () => true) {
  let latest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !filter(entry.name)) continue
    const at = statSync(join(entry.parentPath ?? dir, entry.name)).mtimeMs
    if (at > latest) latest = at
  }
  return latest
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` (${detail})`}`)
}

// The browser bundle is built from src/client; the host bundle from src/index.ts
// and the modules it imports.
const clientSources = newest(join(root, 'src', 'client'))
const hostSources = newest(join(root, 'src'), (name) => name.endsWith('.ts'))
const clientBundle = statSync(join(root, 'lib', 'client.js')).mtimeMs
const hostBundle = statSync(join(root, 'lib', 'index.mjs')).mtimeMs

check(
  'lib/client.js is not older than src/client',
  clientBundle >= clientSources,
  `bundle ${new Date(clientBundle).toISOString()} vs source ${new Date(clientSources).toISOString()}`,
)
check(
  'lib/index.mjs is not older than src',
  hostBundle >= hostSources,
  `bundle ${new Date(hostBundle).toISOString()} vs source ${new Date(hostSources).toISOString()}`,
)

if (failures > 0) {
  throw new Error(`${failures} artifact(s) are stale — run: node build-client.mjs && npx tsdown -c tsdown.config.ts`)
}
console.log('OK: both committed bundles are at least as new as their sources')
