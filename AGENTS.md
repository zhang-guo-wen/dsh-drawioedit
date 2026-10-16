# AGENTS.md

本仓 `dsh-drawioedit` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：在 Web 侧栏标签页里用**上游 draw.io 编辑器**就地编辑 `.drawio` 图表，改动写回标签页打开的那个文件。
它不打包 `@deepseek-ai/*`，运行时从宿主 harness 解析这些包；随包的 `editor/` 是裁剪过的上游 drawio webapp，不是 harness 的代码。

姊妹插件：[`dsh-drawio`](../dsh-drawio)（用 maxGraph 只读预览 `.drawio`，约 1 MB，而本仓因为带上游编辑器，解包后约 43 MiB）。
两者互不 import、互不依赖，可单独安装；渲染与编辑能力因此不共享任何代码，只有文件格式是共同的。

**本文件只是导航页**：只放定位、目录、命令与红线，明细按需读包根 `rules/`（索引见文末「详细规则」）。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-drawioedit`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

- `src/` —— host 半边：`index.ts`（入口与 re-export）、`serve.ts`（编辑器前缀路由）、`save.ts`（保存端点）、`shim.ts`（注入编辑器页面的 shim）、`params.ts`（编辑器 URL 与云集成清单）。
- `src/client/` —— 浏览器半边：`index.ts`、`EditorBody.tsx`、`transports.ts`、`editor.ts`、`locales.ts`、`EditorBody.module.css`。
- `editor/` —— 随包的上游 drawio webapp（裁剪说明见 [`rules/editor-assets.md`](rules/editor-assets.md)）；`build-stencils.mjs` 从保留的 XML 重建 `editor/js/stencils.min.js`。
- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），`lib/index.mjs` 里内嵌了 shim 源码。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层；`docs/` —— README 的截图与它的源文件。
- `tests/` —— 套件（`npm test`）与不进套件的 `tests/debug/`；`rules/` —— 本文件的明细分册（**不在** `package.json` 的 `files` 里，因此不随 npm 包分发）。

每个文件的职责、导出与边界见 [`rules/repo-layout.md`](rules/repo-layout.md)。

## 构建与测试命令

```sh
npm install
npm run build      # tsdown（host） + node build-client.mjs（client） + node build-stencils.mjs
npm run typecheck  # tsc --noEmit -p tsconfig.json，针对「已发布」的 @deepseek-ai/* 包
npm test           # 无需密钥的套件，其中 boot 与 offline 驱动真实 headless Chrome
npm run test:metadata  # node --test tests/plugin-metadata.test.mjs
```

`boot` / `offline` 默认按平台查找 Chrome，装在别处用 `CHROME_PATH` 指定；找不到可执行文件时探针打印原因并以 2 退出。`prepublishOnly` 只跑 `artifact`、`stencils`、`editor-assets`、`smoke`，发布前的手工检查仍以 `npm test` 为准。构建链路与各套件的分工见 [`rules/build-and-artifacts.md`](rules/build-and-artifacts.md) 与 [`rules/tests-and-browser.md`](rules/tests-and-browser.md)。

## 硬约束

1. **仓库根就是包。** 不要放进 `packages/*`，也不要改根 `package.json` 的定位——`dsh plugin add <git-url>` 取仓库根，否则会装成错误的东西（`editor/` 也不会被打包）。
2. **`lib/` 是提交进仓库的产物。** 改完源码必须 `npm run build` 并把 `lib/` 一起提交；`artifact` 套件检查产物不早于源码，重建 host 半边时漏更新 `lib/client.js` 会静默留下旧产物。
3. **两半的生效方式不同。** host 半边是进程内模块，重建 `lib/index.mjs` 后必须重启宿主（路由、保存端点、shim 都在里面）；client 半边按内容 revision 提供，改 `src/client/` 后必须 bump `HANDOFF_ID` 或强刷浏览器。`HANDOFF_ID` 必须与 `lib/client.js` 包裹里的 `id` 及 `tests/smoke.mjs` 断言的 id 一致。
4. **`build-client.mjs` 的 `platform: 'browser'` 不能掉。** 退到 `node` platform 会把依赖的服务端入口内联，产物在浏览器里因 `require("module")` 直接加载失败。
5. **iframe 必须与 harness 前端同源**，sandbox 逐字为 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`（`tests/boot.mjs` 复用同一字符串）；跨源会让父页面读不到编辑器，握手、消息与保存全失效。
6. **读取用绝对路径。** `parseFileAddress` 的 `scope` 必须是 `session`；`workspaceFiles.readBytes` 回带的 host 绝对路径必须原样传回保存端点，用工作区相对路径会写到另一个文件。
7. **写入必须带会话沙箱策略与 `replaceIfVersion` 守卫。** 保存端点只接受 POST，请求体上限 `MAX_DIAGRAM_BYTES = 8 * 1024 * 1024`（超限拒绝而不是截断），`parseSaveRequest` 的字段与会话 ID 校验不得放宽；客户端同一时刻只保留一个保存在飞。
8. **shim 只能注入到 `bootstrap.js` 与 `main.js` 之间**，并以 `no-store` 提供；`assertShimUsable` 不得绕过；shim 模板字面量里出现反引号或 `${` 会让产物截断并在模块加载时抛错；`SHIM_REVISION` 随 shim 行为一起 bump。
9. **`window.EditorUi` 的钩子必须用只转发的 `Proxy`**，不能换回包装类：drawio 在赋值之后才完成这个类，包装类会让子类构造时缺 `setEventSource`，drawio 记 `SEVERE` 并停在 splash。
10. **`editor/mxgraph/css/common.css` 必须保留**：它是 `div.mxPopupMenu { position: absolute }` 唯一的声明处，缺了它编辑器照样启动，只有 `tests/offline.mjs` 的 4xx 断言会抓到。
11. **云集成只能经 `src/params.ts` 的 `DISABLED_INTEGRATIONS` 关闭**，清单只有一个家（host 的 `editorUrl()`、`tests/offline.mjs` 的宿主页与生产 body 共用同一构造器）；编辑器启动全程不得出现任何远程主机。
12. **新增 UI 文案必须同时进 `src/client/locales.ts` 的 `zh` 与 `en`**，不写死字符串；`EditorBody` 里 JSX 引用但 CSS 未定义的类同样静默无样式。
13. **访问未 inject 的服务用 `ctx.get('x')`**，不用 `ctx.x` 属性访问。
14. **发版 = 改版本号 + 构建 + 提交产物 + 打 tag。** 未经用户明确要求不递增版本号、不打 tag、不推送；步骤见 [`rules/release.md`](rules/release.md)。

## 详细规则

按需读取，不要把 `rules/` 当成默认上下文。

- [rules/repo-layout.md](rules/repo-layout.md)：仓库布局与每个文件/目录的职责；新增、移动文件或判断代码归 host 还是 client 时读。
- [rules/runtime-mechanisms.md](rules/runtime-mechanisms.md)：同源 iframe、`#P`+`#R` 加载、读取与保存链、shim 原理与注入位置；改加载/读取/保存/shim 前必读。
- [rules/editor-assets.md](rules/editor-assets.md)：`editor/` 上游资源裁剪、stencils 重建、模板索引与必须保留项；改 `editor/`、升级 drawio 或排查图形库缺失时读。
- [rules/build-and-artifacts.md](rules/build-and-artifacts.md)：tsdown / rolldown 构建链路、`platform: 'browser'` 与 external 策略、`lib/` 与 typecheck 边界；改构建或产物加载失败时读。
- [rules/wiring-and-deploy.md](rules/wiring-and-deploy.md)：`cordis.patch.yml` 接线、`dsh` 字段与 sidebar-right 契约、安装/卸载命令与生效语义；安装或「改了不生效」时读。
- [rules/release.md](rules/release.md)：发版步骤、tag 与安装验证；准备发版时读。
- [rules/tests-and-browser.md](rules/tests-and-browser.md)：各套件证明什么、真实浏览器驱动与 `tests/debug/`；改测试或决定补哪个套件时读。
- [rules/troubleshooting.md](rules/troubleshooting.md)：`window.__dshShimState` 字段表与判断层次；编辑器打不开、不保存、停在 splash 时读。
- [rules/pitfalls.md](rules/pitfalls.md)：14 条易崩清单（改错就坏且多数不立刻报错）；动手前对照、评审时逐条核。
