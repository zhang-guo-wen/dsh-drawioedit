// tests/debug/scan-bundle.mjs — print bounded context around a needle in the
// minified editor bundle.
//
// The bundle is a few megabytes of one-line JavaScript, so it cannot be read with
// a normal file read or a line-oriented search: this prints short slices around
// each hit instead, which is enough to see how drawio binds a command.
//
// Usage: node tests/debug/scan-bundle.mjs 'actions.get("save")' [before] [after]
import { readFileSync } from 'node:fs'

const [needle, before = '260', after = '260'] = process.argv.slice(2)
if (needle === undefined) throw new Error('usage: scan-bundle.mjs <needle> [before] [after]')

const bundle = readFileSync(new URL('../../editor/js/app.min.js', import.meta.url), 'utf8')
let from = 0
let hits = 0
for (;;) {
  const at = bundle.indexOf(needle, from)
  if (at < 0) break
  hits += 1
  from = at + needle.length
  if (hits > 8) break
  const slice = bundle.slice(Math.max(0, at - Number(before)), at + needle.length + Number(after))
  console.log(`===== hit ${hits} at ${at} =====`)
  console.log(JSON.stringify(slice))
}
console.log(`${hits} hit(s) for ${JSON.stringify(needle)}`)
