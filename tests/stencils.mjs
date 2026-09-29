// The editor embeds compressed copies of its XML stencils in a browser bundle.
// Keep that bundle and the shipped XML files aligned when trimming libraries.
import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'editor')
const stencilDir = join(root, 'stencils')
const bundle = readFileSync(join(root, 'js', 'stencils.min.js'), 'utf8')
const expected = ['arrows.xml', 'basic.xml', 'bpmn.xml', 'flowchart.xml']
const files = readdirSync(stencilDir, { recursive: true })
  .filter((name) => name.endsWith('.xml'))
  .map((name) => name.replaceAll('\\', '/'))
  .sort()
assert.deepEqual(files, expected, 'only the core stencil XML files should ship')

const packed = [...bundle.matchAll(/^f\[("[^"]+")\] = ("[^"]+");$/gm)]
  .map((match) => [JSON.parse(match[1]), JSON.parse(match[2])])
assert.deepEqual(packed.map(([name]) => name), expected, 'packed and shipped libraries differ')
for (const [name, encoded] of packed) {
  const actual = inflateRawSync(Buffer.from(encoded, 'base64'))
  const source = readFileSync(join(stencilDir, name))
  assert.deepEqual(actual, source, `${name} differs from its packed copy`)
}

const previews = readdirSync(join(root, 'images'))
  .filter((name) => name.startsWith('sidebar-') && name.endsWith('.png'))
  .sort()
assert.deepEqual(previews, [
  'sidebar-arrows2.png', 'sidebar-basic.png', 'sidebar-bpmn.png',
  'sidebar-c4.png', 'sidebar-dfd.png', 'sidebar-er.png',
  'sidebar-flowchart.png', 'sidebar-general.png', 'sidebar-uml.png',
], 'only previews for retained palettes should ship')
console.log('OK: core stencil XML, packed copies, and palette previews match')
