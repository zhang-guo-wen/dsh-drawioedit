// Keep the upstream editor's packed stencil lookup in sync with the small
// collection of XML libraries shipped by this plugin.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const root = fileURLToPath(new URL('./editor/stencils/', import.meta.url))
const output = fileURLToPath(new URL('./editor/js/stencils.min.js', import.meta.url))

async function xmlFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await xmlFiles(path))
    else if (entry.name.endsWith('.xml')) files.push(path)
  }
  return files
}

const files = (await xmlFiles(root)).sort()
const entries = await Promise.all(files.map(async (path) => {
  const name = relative(root, path).replaceAll('\\', '/')
  const data = await readFile(path)
  return `f[${JSON.stringify(name)}] = ${JSON.stringify(deflateRawSync(data, { level: 9 }).toString('base64'))};`
}))

const source = `(function() {
var f = {};
${entries.join('\n')}

var loadStencil = mxStencilRegistry.loadStencil;

mxStencilRegistry.loadStencil = function(filename, callback)
{
  var data = f[filename.substring(STENCIL_PATH.length + 1)];
  var xml = null;
  if (data != null) {
    xml = pako.inflateRaw(Uint8Array.from(atob(data), function (char) {
      return char.charCodeAt(0);
    }), {to: 'string'});
  }
  if (callback != null && xml != null) {
    window.setTimeout(function() { callback(mxUtils.parseXml(xml)); }, 0);
  } else {
    return (xml != null) ? mxUtils.parseXml(xml) : loadStencil.apply(this, arguments);
  }
};
})();
`

await writeFile(output, source)
console.log(`Packed ${files.length} stencil libraries into ${output}`)
