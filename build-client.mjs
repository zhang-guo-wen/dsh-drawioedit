// build-client.mjs — bundle src/client into the DSH browser module-loader handoff
// format: `window.__ModuleLoader__.load({ id, factory })`.
//
// This replaces the harness monorepo's `packages/client/tsdown.client.ts`, which is
// not published. Two details from that builder are load-bearing here:
//
//   1. `platform: 'browser'` is stated explicitly. Under platform `node`, rolldown
//      resolves each dependency through its `node` export condition, so a library
//      whose `exports` lists a platform condition before `import` gets its
//      server entry inlined — and that entry may `createRequire('module')` at module
//      scope, which the browser module table cannot answer.
//   2. Only react and @deepseek-ai/* stay external. Everything else (maxgraph,
//      fflate) is inlined, so the deployed artifact has no install-time dependency.
import { rolldown } from 'rolldown'
import { transform } from 'lightningcss'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const HANDOFF_ID = '@zhang-guo-wen/dsh-drawioedit'
const VIRT = '\0dsh-css:'
const SUFFIX = '.mjs'

const banner = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(HANDOFF_ID) + ', factory: (require) => {'
const footer = 'return module.exports; } });'
const intro = 'var module = { exports: {} }; var exports = module.exports;'

// CSS Modules are compiled to a hashed class map plus one deduplicated <style> tag.
// Idempotence keeps repeated mounts from piling up duplicate sheets.
const cssModulePlugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source, importer) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer ? join(dirname(importer), source) : source
    return VIRT + abs + SUFFIX
  },
  async load(id) {
    if (!id.startsWith(VIRT)) return null
    const fileId = id.slice(VIRT.length, -SUFFIX.length)
    this.addWatchFile?.(fileId)
    const css = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: css,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap = {}
    // lightningcss's `exports` object does not carry a stable key order, so an
    // unsorted walk makes JSON.stringify emit the same entries in a different
    // sequence on every build — behaviourally identical output, but a
    // different byte-for-byte artifact and a spurious diff in the committed
    // lib/. Sorting the local names fixes the emitted order.
    for (const local of Object.keys(cssExports ?? {}).sort()) {
      classMap[local] = cssExports[local].name
    }
    const tagId = HANDOFF_ID + '/' + fileId.split(/[\\/]/).pop()
    return [
      'const css = ' + JSON.stringify(String(code)) + ';',
      'const tagId = ' + JSON.stringify(tagId) + ';',
      "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
      "  const tag = document.createElement('style');",
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      'export default ' + JSON.stringify(classMap) + ';',
    ].join('\n')
  },
}

// Externals are exactly what the shell seeds through `PLATFORM_MODULES`, plus the
// DSH client packages the host loads as their own module-graph rows. A
// browser-safe utility such as `@deepseek-ai/dsh-util-workspace-path` is NOT
// external: it is inlined, matching the harness builder's INLINE_SAFE policy, so
// the deployed artifact never asks the module table for it.
const EXTERNAL = [
  /^react$/,
  /^react\//,
  /^@deepseek-ai\/cordis(\/|$)/,
  /^@deepseek-ai\/dsh-client-locale(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-renderer(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-sidebar-right(\/|$)/,
  /^@deepseek-ai\/dsh-client-ui-slots(\/|$)/,
]

const bundle = await rolldown({
  input: join(root, 'src', 'client', 'index.ts'),
  platform: 'browser',
  external: EXTERNAL,
  plugins: [cssModulePlugin],
})

await bundle.write({
  format: 'cjs',
  file: join(root, 'lib', 'client.js'),
  banner,
  footer,
  intro,
  sourcemap: false,
})
console.log('lib/client.js written (ModuleLoader handoff bundle)')
