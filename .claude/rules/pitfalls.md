---
paths:
  - "src/**"
  - "tests/**"
  - "editor/**"
  - "build-client.mjs"
  - "package.json"
---

> 覆盖：14 条已知易崩点（改错就坏、且多数不会立刻报错）；何时读：动手改代码前对照，评审或排查回归时逐条核

## 易崩清单

1. iframe 变成跨源 → 父页面读不到编辑器，握手、消息与保存全失效（`EditorBody` 的 `postMessage` 源检查也会把消息丢掉）。
2. 忘了重启宿主就以为 shim 改动生效 → 路由、保存端点与 shim 都在 `lib/index.mjs` 里，进程内代码不会随文件重建而替换。
3. 改 client 不 bump `HANDOFF_ID` / 不硬刷新 → 浏览器跑旧 bundle。
4. client 包不是 `window.__ModuleLoader__.load({ id, factory })` 格式，或 `id` 与 `HANDOFF_ID` 不一致 → 浏览器加载失败。
5. `build-client.mjs` 掉了 `platform: 'browser'` → 依赖的服务端入口被内联，产物在浏览器里因 `require("module")` 直接加载失败。
6. shim 模板字面量里出现反引号或 `${` → 产物是截断的脚本；`assertShimUsable` 在模块加载时就抛。
7. `assertShimUsable` 被绕过、shim 少了包裹或花括号不配平 → 页面里是一段坏脚本，编辑器停在 splash。
8. drawio 升级后 `EditorUi` / `saveFile` / `getFileData` 改名 → 保存汇入点丢钩子或读图返回 null（表现为"不自动保存"）；只有 `tests/boot.mjs` 会在真实浏览器里发现，`shim` / `shimdelivery` 仍可能全绿。
9. 把 `window.EditorUi` 的钩子从 `Proxy` 换回包装类 → 子类构造时缺 `setEventSource`，drawio 记 `SEVERE` 并停在 splash。
10. `editor/mxgraph/css/common.css` 被裁掉 → 弹出菜单失去 `position: absolute`，菜单流到工具栏下面；`tests/offline.mjs` 的 4xx 断言是唯一会抓到的地方。
11. 新增 UI 文案没进 `src/client/locales.ts` 的 `zh` 与 `en` → 取到 `undefined`；`EditorBody` 里 JSX 引用但 CSS 未定义的类同样静默无样式。
12. `ctx.x` 属性访问未 inject 的服务 → 抛错（用 `ctx.get('x')`）。
13. 保存端点的请求体上限或字段校验被放宽 → 阈值内的畸形请求与超限请求会直接打到 `ctx.fs`。
14. 仓库被放进 `packages/*` 或改了根 `package.json` 的定位 → `dsh plugin add <git-url>` 会装成错误的东西（`editor/` 也不会被打包）。
