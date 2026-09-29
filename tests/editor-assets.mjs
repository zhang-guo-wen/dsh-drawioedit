// The production editor uses app.min.js. Its development sources and the
// specialist template gallery are intentionally omitted from the package.
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const editor = join(dirname(fileURLToPath(import.meta.url)), '..', 'editor')

for (const directory of ['js/diagramly', 'js/diagramly/sidebar', 'js/grapheditor']) {
  const sources = readdirSync(join(editor, directory)).filter((name) => name.endsWith('.js'))
  assert.deepEqual(sources, [], `${directory} still ships development JavaScript`)
}
for (const file of [
  'js/app.min.js',
  'js/diagramly/vsdx/importer.js',
  'js/diagramly/emf/emf-svg.js',
  'js/diagramly/graphml/mxGraphMlCodec.js',
  'js/diagramly/miro/MiroImporter.js',
]) {
  assert.ok(existsSync(join(editor, file)), `${file} must remain available`)
}

const index = readFileSync(join(editor, 'templates', 'index.xml'), 'utf8')
const document = new JSDOM(index, { contentType: 'text/xml' }).window.document
assert.equal(document.documentElement.nodeName, 'templates')
const templates = [...document.querySelectorAll('template')]
assert.ok(templates.length > 50, 'core templates are missing')
const coreLibraries = new Set([
  'general', 'misc', 'advanced', 'basic', 'arrows', 'arrows2', 'flowchart',
  'er', 'uml', 'bpmn', 'bpmn2', 'dfd', 'c4', 'search', '.scratchpad',
])
for (const template of templates) {
  const url = template.getAttribute('url')
  assert.ok(url && !/^(cloud|network)\//.test(url), `specialist template remains: ${url}`)
  assert.ok(existsSync(join(editor, 'templates', url)), `template target is missing: ${url}`)
  for (const library of (template.getAttribute('libs') ?? '').split(';').filter(Boolean)) {
    assert.ok(coreLibraries.has(library), `${url} depends on removed library: ${library}`)
  }
}
for (const name of ['cloud', 'network']) {
  const files = readdirSync(join(editor, 'templates', name), { recursive: true })
    .filter((entry) => entry.endsWith('.xml') || entry.endsWith('.png'))
  assert.deepEqual(files, [], `${name} templates still ship`)
}
console.log(`OK: production imports and ${templates.length} indexed core templates are present`)
