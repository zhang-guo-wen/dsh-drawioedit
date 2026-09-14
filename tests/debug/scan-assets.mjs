// tests/debug/scan-assets.mjs — find local editor files that the bundled editor names
// but that this checkout does not ship.
//
// This is an investigation tool, not a gate: most of what it reports are stencil icon
// names that drawio resolves inside its own shape libraries rather than from disk, so
// its output is for reading, not for asserting on. tests/offline.mjs guards the same
// class of bug where it actually bites -- a 4xx response while the editor boots.
//
// Usage: node tests/debug/scan-assets.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const editor = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'editor')
const EXTENSIONS = /\.(?:css|png|gif|jpe?g|svg|woff2?|ttf|eot|json|txt|xml|ico|js|min\.js)$/i
const REFERENCE = /(['"])([\w@./-]{3,120}?\.[a-z0-9]{2,5})\1/gi

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(?:js|css|html)$/i.test(entry.name)) files.push(full)
  }
}
walk(editor)

const missing = new Map()
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(REFERENCE)) {
    const reference = match[2]
    if (!EXTENSIONS.test(reference)) continue
    if (/^(?:https?:)?\/\//i.test(reference) || reference.startsWith('data:')) continue
    if (reference.startsWith('/')) continue
    const candidates = [resolve(dirname(file), reference), resolve(editor, reference), resolve(editor, 'js', reference)]
    if (candidates.some((candidate) => existsSync(candidate))) continue
    const key = `${reference}`
    if (!missing.has(key)) missing.set(key, file.slice(editor.length + 1))
  }
}

const entries = [...missing.entries()].sort()
console.log(`${files.length} editor files scanned, ${entries.length} named file(s) not shipped:`)
for (const [reference, from] of entries.slice(0, 40)) console.log(`  ${reference}   (named by ${from})`)
