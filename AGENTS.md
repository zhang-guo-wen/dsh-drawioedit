# AGENTS.md

本仓 `dsh-drawioedit` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：在 Web 侧栏标签页里用**上游 draw.io 编辑器**就地编辑 `.drawio` 图表，改动写回标签页打开的那个文件。
它不打包 `@deepseek-ai/*`，运行时从宿主 harness 解析这些包；随包的 `editor/` 是裁剪过的上游 drawio webapp，不是 harness 的代码。

姊妹插件：[`dsh-drawio`](../dsh-drawio)（用 maxGraph 只读预览 `.drawio`，约 1 MB，而本仓因为带上游编辑器约 119 MB）。
两者互不 import、互不依赖，可单独安装；渲染与编辑能力因此不共享任何代码，只有文件格式是共同的。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-drawioedit`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

- `src/index.ts` —— host 半边入口：`inject = ['webServer', 'fs']`，`apply` 里经 `ctx.effect(...)` 注册编辑器静态路由与保存端点；并把 `SHIM_PATH` / `SHIM_REVISION` / `SHIM_SOURCE` / `assertShimUsable` / `EDITOR_PATH` / `editorUrl` / `EDITOR_ROUTE` / `SAVE_ROUTE` re-export 给本包自己的测试，免得它们伸手进内部模块路径。
- `src/serve.ts` —— `EDITOR_ROUTE = '/plugins/dsh-drawioedit/editor'` 前缀路由：路径穿越防护（`normalize` 收敛 `..` 后做包含性检查，越界一律 403；不存在的名字才 404）、content-type 表、`index.html` 的 shim 注入、`SHIM_PATH` 以 `no-store` 提供、其余文件 `public, max-age=86400`（119 MB 的载荷不该每次打开都重取）。
- `src/save.ts` —— `SAVE_ROUTE = '/plugins/dsh-drawioedit/save'`：只接受 POST，请求体上限 `MAX_DIAGRAM_BYTES = 8 * 1024 * 1024`（超限拒绝而不是截断），`parseSaveRequest` 校验字段，写入走 `fs.resolve` + `fs.writeText(target, xml, { kind: 'replaceIfVersion', version })`，响应回带新版本令牌。
- `src/shim.ts` —— 注入编辑器页面的 pre-load shim 源码（`SHIM_REVISION = 5`）、`SHIM_PATH`、模块加载即执行的 `assertShimUsable`（校验包裹、截断、`</script`、花括号配平、模板字面量里残留的 `${`）。
- `src/params.ts` —— 编辑器 URL（`EDITOR_PATH`、`editorUrl()`）与按名字关闭的云集成清单（`DISABLED_INTEGRATIONS`）。
- `src/client/` —— 浏览器半边：`index.ts`（标签类型、body 座位、transports 安装）、`EditorBody.tsx`（iframe 与消息泵）、`transports.ts`（read/save 模块句柄）、`editor.ts`（消息解析与 save POST）、`locales.ts`、`EditorBody.module.css`。
- `editor/` —— 随包的上游 drawio webapp（裁剪说明见「editor/ 的裁剪」）；`package.json` 的 `files` 里带着它。
- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**；`lib/index.mjs` 里内嵌了 shim 源码。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `docs/example.png` / `docs/example.drawio` —— README 的截图与它的源文件。
- `tests/` —— 八个套件（`npm test`）与不进套件的 `tests/debug/`。

## 构建

```sh
npm install
npm run build      # tsdown（host） + node build-client.mjs（client）
npm run typecheck  # tsc --noEmit -p tsconfig.json，针对「已发布」的 @deepseek-ai/* 包
npm test           # 八个无需密钥的套件，其中两个驱动真实浏览器
```

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`，`tsdown.config.ts` 里 `deps.neverBundle: [/^@deepseek-ai\//]` 让所有 `@deepseek-ai/*` 保持 external。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react 与 `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译（`cssModules.pattern: '[hash]_[local]'`）并内联成一个去重的 `<style>` 标签；类名映射按局部名排序后再序列化，保证构建可复现。
- 本仓两半都不使用装饰器（host 侧没有 `@Remote`），所以 `tsdown.config.ts` 里没有装饰器降级 transform。
- `prepublishOnly` 只跑 `artifact` 与 `smoke` 两个套件，所以发布前的手工检查仍以 `npm test` 为准。

**`platform: 'browser'` 是显式设置的。** harness 单仓打客户端产物用的 `packages/client/tsdown.client.ts` 并未发布，所以本仓自己打包浏览器半。在 rolldown 的 `node` platform 下，依赖会经 `node` export 条件解析：若某库的 `exports` 把平台条件排在 `import` 之前，它的**服务端入口**就会被内联，而那些入口可能在模块顶层 `require("module")`，产出浏览器模块表无法应答的标识符。`build-client.mjs` 的 `EXTERNAL` 只有 react 与 DSH 客户端包（`@deepseek-ai/cordis`、`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-client-ui-sidebar-right`）；`@deepseek-ai/dsh-util-workspace-path` 这类浏览器安全的工具**被内联**（对齐 harness 的 INLINE_SAFE 策略），所以部署产物不会向模块表索取它。

`typecheck` 只覆盖本包自己的源码，**不覆盖 Client Remote 的方法集**：命名空间由 harness 在运行时生成并装配，而本包不安装声明它们的 gateway，所以 `ctx.remote` 在这里按不受约束处理。这条边由 `tests/smoke.mjs` 守住——它用一份形状与生成命名空间一致的 Remote 假件驱动 body 的读取，因此命名空间里没有的方法会让套件失败。

## 组合接线

`cordis.patch.yml` 只做一件事——把插件行插进 profile 组合出来的 bundle 层：

```yaml
- insert:
    - id: drawioedit
      name: '@guowenzhang/dsh-drawioedit'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这个补丁文件，`dsh.client.platform` 为 `web`，`dsh.client.inject` 列出浏览器半边 apply 用到的服务提供包——`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-renderer`、`@deepseek-ai/dsh-client-ui-sidebar-right`。`exports` 另导出 `./client`（`lib/client.js`）与 `./cordis.patch.yml`。

扩展点归 `@deepseek-ai/dsh-client-ui-sidebar-right` 所有，本插件只按它的契约贡献两项：标签类型进 `ctx.sidebarRightTabs`（`id: '@guowenzhang/dsh-drawioedit'`、`kind: 'drawio-edit'`、`patterns: ['*.drawio']`、`title: basenameOf`），body 进点名座位 `sidebar.right.pane.tab`，key 同为该实现 id。宿主 profile 必须组合该包，所有随附的 web profile 都满足；没有它时 `inject` 拿不到服务，标签页不会出现。

host 侧另有两处接线：`inject = ['webServer', 'fs']`，`webServer` 提供路由注册表（前缀路由 + 精确路由），`fs` 提供带新鲜度守卫的写入。`ctx.remote.workspaceFiles` 是 client 侧读取文件用的 Remote 命名空间，在 `dsh.client.inject` 之外由浏览器半边按需取用。

## 部署与生效语义

用官方命令安装，它把参数转发给 profile 目录里的包管理器，**并自行维护 profile 清单**（依赖条目与 `dsh.profile.bundles` 的层一起加，不要手写）：

```sh
# npm 官方源
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-drawioedit

# HTTPS
npx @deepseek-ai/dsh plugin --profile web add git+https://github.com/zhang-guo-wen/dsh-drawioedit.git

# SSH
npx @deepseek-ai/dsh plugin --profile web add git+ssh://git@github.com/zhang-guo-wen/dsh-drawioedit.git

# 锁定发布 tag，默认分支上后续的临时提交不会被拉到
npx @deepseek-ai/dsh plugin --profile web add "git+https://github.com/zhang-guo-wen/dsh-drawioedit.git#v0.1.0"

# 本地目录开发安装；包管理器建 symlink，重建 lib/ 后重启即生效，无需重装
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-drawioedit

# 卸载：依赖条目与 bundle 层一起移除
npx @deepseek-ai/dsh plugin --profile web remove @guowenzhang/dsh-drawioedit
```

`lib/` 已提交进仓库，所以装完即可运行，**使用者不需要构建**；下载里带着 `editor/`（约 119 MB）。本地目录安装建的是 symlink，`file:` 依赖则可能退化成物理拷贝，那时改源码不会影响正在跑的 dsh。装完确认层进了组合：

```sh
npx @deepseek-ai/dsh web
npx @deepseek-ai/dsh --profile web --dump-config | grep -A2 drawioedit
```

插件的两半更新方式不同：

- **client 半边按内容 revision 提供。** 产物变了刷新页面就会取到新的；`HANDOFF_ID` 就是这个 revision 的标识，改动 client 后必须 bump 它或强刷浏览器，否则浏览器一直跑旧 bundle。
- **host 半边是进程内模块。** 重建 `lib/index.mjs` 不会替换正在运行的那份代码，只有重启宿主才会加载新产物。编辑器路由、保存端点与 **shim 源码**都在这半边，所以改 `src/shim.ts` 在重启前不生效。
- `HANDOFF_ID` 在 `build-client.mjs` 里，值为 `@guowenzhang/dsh-drawioedit`，必须与 `lib/client.js` 包裹里的 `id` 及 `tests/smoke.mjs` 断言的 id 一致。
- `--dump-config` 只反映组合，不反映进程内代码；判断浏览器跑的是哪一版 shim，看编辑器 frame 里的 `window.__dshShimState.revision`（见「排查」）。

## 发版

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，默认分支上后续的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 都是最新的。
3. 提交源码与 `lib/`（不要把 `lib/` 落在外面的工作区）。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-drawioedit <version>"
   git push origin main --follow-tags
   ```

5. 验证安装：`npx @deepseek-ai/dsh plugin --profile web add "git+https://github.com/zhang-guo-wen/dsh-drawioedit.git#v<version>"`，重启宿主后打开一个 `.drawio` 文件，确认编辑器进画布且一次改动被写回。

## 技术决策与机制

**编辑器是应用，所以跑在同源 iframe 里。** draw.io 是整个 webapp，不是能塞进 React 树的组件；父页面要驱动它，iframe 必须与 harness 前端**同源**——跨源的父页面根本读不到里面的文档。因此 `src/index.ts` 为编辑器的文件申请一条 `webServer` 前缀路由，而不是依赖任何隐式的资源映射。

**加载走 `#P` + `#R` 双层 hash，且用 `dshTitle` 而不是 drawio 自己的 `title`。** drawio 的 bootstrap 从 `#P` hash 读 URL 参数，其 JSON 可用 `hash` 字段携带图表，随后被还原为真正的 `location.hash`（`#R` + 编码后的 XML）；裸 `#R` 会被忽略，所以两层都必须有：

```
/plugins/dsh-drawioedit/editor/index.html#P{"client":"1","hash":"#R<encoded xml>","dshTitle":"name.drawio"}
```

`client: 1` 标记嵌入方是宿主应用。文件名走本包自己的 `dshTitle`，**故意不用** drawio 的 `title` 参数：drawio 会对它做百分号解码，而文件名里可能带 `%`。这条路径不需要任何握手，是编辑器唯一可靠的装载方式。

**iframe 带 sandbox。** 生产 body 给 frame 的 sandbox 是 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`（`tests/boot.mjs` 逐字复用同一个字符串）。它阻止 frame 把应用导航走、以及打开标签页没要求的对话框；`allow-same-origin` 是必需的，因为 drawio 把设置存在 `localStorage` 里。Chrome 会告警这一对组合能让 frame 逃出自己的沙箱——这是事实，在这里也可接受：被框住的文档是本插件自己的代码，不是不可信内容；图表是数据，drawio 用 `DOMParser` 解析它，既不执行也不解析外部实体（`tests/offline.mjs` 证明带外部实体的 `DOCTYPE` 不会发起任何请求）。

**读取：`dsh-resource://file/…` + `workspaceFiles.readBytes`。** 标签页的地址给出会话与路径（`parseFileAddress`，`scope` 必须是 `session`），body 经 `workspaceFiles.readBytes(sessionId, path, {}, signal)` 整文件读取。这条缝上的字节是**原生字节**——Remote 在 client 拿到之前已解出二进制字段，所以没有 base64 需要解码——返回值同时带上 host 解析出的**绝对路径**与新鲜度令牌。用绝对路径而不是工作区相对路径是必须的：读取按会话工作区根解析相对路径，而经 `fs` 写入按进程目录解析，把相对路径原样传回去会写到另一个文件。

**保存：`/plugins/dsh-drawioedit/save` + `replaceIfVersion` 守卫。** Workspace Files 是只读缝，改动回不去，所以走应用同源的 POST。shim 把每次改动作为 `{event:'autosave', xml}` 回传，body 取最新的一份写回；一次写入完成后 host 回带新令牌，下一次保存必须提供它。守卫是**新鲜度前置条件**：编辑器打开期间 agent 写入的内容会被拒绝，而不是被静默覆盖。客户端把并发收成一条链——同一时刻只有一个保存在飞，等待期间只保留最新的一份图（拖动形状会产生一串改动事件），否则两个保存会拿着同一个令牌、第二个被误判为过期。写成功后 host 把 `{action:'saved'}` 发回编辑器，shim 调 `ui.editor.setModified(false)` 并把状态区换成 `mxResources` 的 `allChangesSaved`，这正是把 drawio 自己的 "Unsaved changes" 变成 "All changes saved" 的那一步——不确认的话，写成功看起来和写失败一样。

**为什么需要 shim。** drawio 的 `#create=` 握手在同源 iframe 里用不了：它的消息监听器在 `evt.source == (window.opener || window.parent)` 不成立时直接返回（App.js），这个身份判断是为 `Embed.js` 打开的弹出窗口写的，消息因此在没有任何报错的地方被丢掉。编辑器又把实例藏在闭包里——DOM 上没有引用，也没有任何全局暴露它（对照随包构建核实过）。所以 shim 拦截 `window.EditorUi` 的**赋值**（`Object.defineProperty` 的 get/set + `WeakSet`），用**只转发的 `Proxy`** 抓住构造出的实例，并接管 `ui.saveFile`——所有保存命令唯一汇入的那个方法；同时也重新绑定 `ui.actions` 的 `save` / `saveAs`（状态横幅是在点击时才查 action 的）。`Proxy` 而不是包装类是必须的：drawio 在赋值之后才完成这个类，`mxEventSource` mixin 稍后替换 prototype，持有旧 prototype 的包装类会让 `Editor` 这类子类构造时缺 `setEventSource`，drawio 记下 "SEVERE this.setEventSource is not a function" 并永远停在 splash 上。shim 还打了 `mxUtils.fit`（把弹出菜单限制在 frame 内，而不是按文档测量）与文档 `scrollTop` 归零（这个文档是应用 frame，不是页面），并在捕获阶段兜底 Ctrl+S。shim 也认 `{action:'create', data}`（调用编辑器自己的 `executeCreateObject`），但本插件 body 走 URL 加载这条无需握手的路径，因此不依赖它。

**注入位置在 `bootstrap.js` 与 `main.js` 之间。** `injectShim` 在服务时把 `<script src="${SHIM_PATH}"></script>` 插到 `index.html` 里 `bootstrap.js` 那一行之后，所以 `urlParams` 已经就绪、而定义 `EditorUi` 的 `main.js` 还没执行；vendored 编辑器文件保持原样，这件事只有一个可见的位置。shim 以 `cache-control: no-store` 提供——它是 host 半边代码，陈旧副本从外面看只表现为"编辑器坏了"。`SHIM_REVISION` 记录它自己的版本（2：改为 Proxy 转发；3：保存命令写回文件而不是走 drawio 的下载流程，并清掉未保存提示；4：在保存汇入点拦截而不是在 action 对象上，并把图表按打开的文件命名；5：弹出菜单按 frame 收边，文档不保留滚动位置）。

**云集成按名字关闭。** drawio 的每个云集成默认都会联网加载第三方 SDK，`src/params.ts` 的 `DISABLED_INTEGRATIONS` 在 URL 里逐个关掉：`gapi`、`db`、`od`、`ms365`、`drive`、`picker`、`tr`、`sockets`。这份清单只有一个家——host 的 `editorUrl()`、`tests/offline.mjs` 的宿主页与生产 body 用的是同一个构造器，所以它们不可能漂移。`offline` 套件在编辑器启动期间出现任何远程主机时失败，并额外证明图里带外部实体的 `DOCTYPE` 不会触发任何请求（drawio 用平台 `DOMParser` 解析，不解析外部实体）。

**`editor/` 的裁剪。** 由上游 webapp 裁剪而来：去掉 `WEB-INF/`（Java jar）、`js/integrate.min.js`、service worker，以及未压缩的旧 `mxgraph/src` 源码——148.6 MB 降到 119.0 MB。`mxgraph/css/common.css` **必须保留**：它是 `div.mxPopupMenu { position: absolute }` 唯一的声明处。

## 测试

`npm test` 跑八个无需密钥的套件；其中 `boot` 与 `offline` 驱动真实的 headless Chrome，默认按平台查找（Windows `C:/Program Files/Google/Chrome/Application/chrome.exe`、macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、Linux `google-chrome`），装在别处就用 `CHROME_PATH` 指向 Chrome/Chromium 可执行文件；找不到可执行文件时探针会明确打印原因并以 2 退出，而不是看起来像挂死。

| 套件 | 证明什么 |
|---|---|
| `artifact` | 两个提交的产物都不早于其源码（`lib/client.js` 不早于 `src/client`，`lib/index.mjs` 不早于 `src/**/*.ts`） |
| `smoke` | 构建出的 client 产物能按浏览器方式加载（模块表里只有 `react`），注册标签类型与 body，并经 Client Remote 的 `readBytes` 读出一份图表 |
| `serve` | 编辑器路由提供真实文件、拒绝路径穿越（含 `%2e%2e%2f` 编码形式）、把 shim 注入到 `bootstrap.js` 之后与 `main.js` 之前，并交叉核对 client 产物引用的是同一条路由 |
| `save` | 保存端点用 `replaceIfVersion` 守卫写入、拒绝畸形请求与非 POST，且对畸形请求不做任何写入尝试 |
| `shim` | shim 能解析（`vm.Script`）、钩住编辑器类、抓住实例、上报改动、接管保存汇入点 |
| `shimdelivery` | shim 经插件路由在定义编辑器的脚本之前到达，且响应不带 `max-age` |
| `boot` | 编辑器启动到画布、画出图表、回传、命名，并让菜单在菜单栏旁边展开 |
| `offline` | 编辑器启动全程未访问远程主机、外部实体未被解析、请求的每个资源都存在、控制台没有初始化失败 |

`artifact` 存在的理由不是形式主义：`npm run build` 曾被发现在重建 host 半边时把 `lib/client.js` 留在旧版本，于是修复能通过 typecheck 与测试（测试跑的是产物）而产物仍是旧代码。`boot` 存在的理由同样具体：更窄的套件在一个坏掉的编辑器上也会全绿——host 可以把每个字节都用 200 发出去，shim 也可以钩住类，而应用仍停在 splash 上。

`offline` 的资源断言是有价值的：`editor/mxgraph/css/common.css` 是 `div.mxPopupMenu { position: absolute }` 唯一的声明处，缺了它编辑器照样能启动——菜单只是顺着文档流跑到工具栏下面——所以真正抓住资源缺失的是那条 4xx 断言。`tests/debug/` 放的是开发 embed 协议期间用的浏览器驱动与 bundle 扫描工具（`capture-docs-shot.mjs`、`cdp-check.mjs`、`live-probe.mjs`、`protocol.mjs`、`sandbox-probe.mjs`、`scan-assets.mjs`、`scan-bundle.mjs`、`scan-urlparams.mjs`），不进套件，其中 `scan-assets.mjs` 是**故意有噪声**的。

## 排查（诊断）

在 DevTools 里切到编辑器 frame，读 `window.__dshShimState`：

| 字段 | 含义 |
|---|---|
| `revision` | 浏览器正在跑的 shim 版本；它是 host 半边代码，所以这一项能抓出"host 是旧的" |
| `sawEditorUi` | shim 执行时 `window.EditorUi` 的类型（正常情况下是 `undefined`，因为 `main.js` 还没跑） |
| `hooked` / `installs` | 类已被拦截、实例已被抓住（`installs` ≥ 1） |
| `loads` | shim 成功装载过几份 host 送来的图表 |
| `reports` | 编辑器读取了图表并上报——一次改动或一次保存 |
| `saved` | host 确认了写入；不涨的话 drawio 会一直显示 "Unsaved changes" |
| `keys` | Ctrl+S 兜底监听看到了按键 |
| `errors` / `lastError` | 读取图表时抛异常——否则所有调用方都会把它当作"没有变化"吞掉 |
| `saveFileOwned` | shim 是否接管了保存汇入点，必须是 `true` |
| `rebound` | shim 打过补丁的东西：`save`、`saveAs`、`saveFile`、`mxUtils.fit` |

判断层次：`hooked` 为假说明 shim 没跑到赋值钩子；`installs` 为 0 说明钩子在了但没有实例（多为 `main.js` 没执行）；`saveFileOwned` 为假说明实例是冻结的或版本不符；`reports` 涨而 `saved` 不涨说明写入被 host 拒了（`src/save.ts` 会把原因作为 JSON `error` 回给页面，body 会把它显示在编辑器上方）。编辑器的 `SEVERE` 控制台行是另一条线索——drawio 捕获自己的初始化失败并以这种方式记日志。

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
