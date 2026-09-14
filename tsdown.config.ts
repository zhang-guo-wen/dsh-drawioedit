import { defineConfig } from 'tsdown'

// Only the host half is built here; the browser half is bundled by build-client.mjs
// into the module-loader handoff format that tsdown does not emit.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  platform: 'node',
  dts: false,
  // Every @deepseek-ai package is resolved from the host harness at runtime.
  deps: { neverBundle: [/^@deepseek-ai\//] },
  clean: false,
})
