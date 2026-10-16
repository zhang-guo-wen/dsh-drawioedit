---
paths:
  - "lib/**"
  - "build-client.mjs"
  - "tsdown.config.ts"
  - "package.json"
---

> 覆盖：构建链路、浏览器半边打包策略与 `lib/` 产物要求；何时读：改构建脚本或依赖解析、调整产物、排查产物加载失败时

## 构建

```sh
npm install
npm run build      # tsdown（host） + node build-client.mjs（client） + node build-stencils.mjs
npm run typecheck  # tsc --noEmit -p tsconfig.json，针对「已发布」的 @deepseek-ai/* 包
npm test           # 十一个无需密钥的套件，其中两个驱动真实浏览器
npm run test:metadata  # node --test tests/plugin-metadata.test.mjs，独立入口、不进 npm test
```

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`，`tsdown.config.ts` 里 `deps.neverBundle: [/^@deepseek-ai\//]` 让所有 `@deepseek-ai/*` 保持 external。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react 与 `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译（`cssModules.pattern: '[hash]_[local]'`）并内联成一个去重的 `<style>` 标签；类名映射按局部名排序后再序列化，保证构建可复现。
- 本仓两半都不使用装饰器（host 侧没有 `@Remote`），所以 `tsdown.config.ts` 里没有装饰器降级 transform。
- `prepublishOnly` 跑 `artifact`、`stencils`、`editor-assets` 与 `smoke` 四个套件，所以发布前的手工检查仍以 `npm test` 为准。

**`platform: 'browser'` 是显式设置的。** harness 单仓打客户端产物用的 `packages/client/tsdown.client.ts` 并未发布，所以本仓自己打包浏览器半。在 rolldown 的 `node` platform 下，依赖会经 `node` export 条件解析：若某库的 `exports` 把平台条件排在 `import` 之前，它的**服务端入口**就会被内联，而那些入口可能在模块顶层 `require("module")`，产出浏览器模块表无法应答的标识符。`build-client.mjs` 的 `EXTERNAL` 只有 react 与 DSH 客户端包（`@deepseek-ai/cordis`、`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-client-ui-sidebar-right`）；`@deepseek-ai/dsh-util-workspace-path` 这类浏览器安全的工具**被内联**（对齐 harness 的 INLINE_SAFE 策略），所以部署产物不会向模块表索取它。

`typecheck` 只覆盖本包自己的源码，**不覆盖 Client Remote 的方法集**：命名空间由 harness 在运行时生成并装配，而本包不安装声明它们的 gateway，所以 `ctx.remote` 在这里按不受约束处理。这条边由 `tests/smoke.mjs` 守住——它用一份形状与生成命名空间一致的 Remote 假件驱动 body 的读取，因此命名空间里没有的方法会让套件失败。
