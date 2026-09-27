// tests/debug/scan-urlparams.mjs — list every `urlParams` switch the bundled editor
// reads, so the plugin's editor URL can turn off its cloud integrations by name.
//
// The editor fetches third-party SDKs (Dropbox dropins.js, Trello client.js, the
// Google API client) unless the matching parameter is "0"; this prints the names
// from the shipped bundle rather than from upstream documentation.
import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../../editor/js/app.min.js', import.meta.url), 'utf8')
const names = new Map()
for (const m of bundle.matchAll(/urlParams\.(\w+)/g)) {
  names.set(m[1], (names.get(m[1]) ?? 0) + 1)
}
const off = [...bundle.matchAll(/["']0["']\s*!=\s*urlParams\.(\w+)/g)].map((m) => m[1])
const on = [...bundle.matchAll(/urlParams\.(\w+)\s*!=\s*["']0["']/g)].map((m) => m[1])
console.log('parameters compared against "0":', [...new Set([...off, ...on])].sort().join(' '))
console.log('all urlParams names:', [...names.keys()].sort().join(' '))
