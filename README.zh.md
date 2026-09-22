# dsh-drawioedit

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在 Web 侧栏中用上游
[draw.io](https://github.com/jgraph/drawio) 编辑器编辑 `.drawio` 图表，改动会**写回标签页打开的那个文件**。

![上游 draw.io 编辑器打开一个 .drawio 文件](docs/example.png)

它是 [`dsh-drawio`](https://github.com/zhang-guo-wen/dsh-drawio) 的编辑版姊妹插件——后者用 maxGraph 只读渲染
`.drawio`。两者互相独立，可单独安装，也可同时安装。本插件用 draw.io 自己的代码渲染，因此输出与 draw.io 完全一致；
代价是体积——约 119 MB，而只读预览约 1 MB。

> 与 draw.io Ltd 无从属或背书关系。"draw.io" 是 draw.io Ltd 的注册商标。本包内嵌其 Apache-2.0 许可的编辑器；
> 详见 [NOTICE](NOTICE)。

## 这个插件能做什么

- `.drawio` 文件在侧栏标签页里用完整的上游编辑器打开，并用文件名标注，而不是显示 "Untitled Diagram"。
- 每次改动都写回同一个文件：改动后一秒内自动写回，以及 **Ctrl+S**、工具栏保存按钮、File → Save / Save As、
  编辑器自己那条 "Unsaved changes. Click here to save." 提示。
- 编辑器启动全程不访问任何第三方主机，图表不会离开本机。

## 安装

构建好的 `lib/` 随仓库提交，所以**你这边不需要构建**；下载包含随包携带的编辑器（约 119 MB）。`dsh plugin` 会同时加
依赖条目与 profile 的 bundle 条目——不要手写 profile 清单。

```sh
npx @deepseek-ai/dsh plugin --profile web add git+https://github.com/zhang-guo-wen/dsh-drawioedit.git

# 本地 checkout 会建成软链，重建 lib/ 后下次启动即生效
npx @deepseek-ai/dsh plugin --profile web add /绝对路径/dsh-drawioedit

# 重启 host，并确认层已生效
npx @deepseek-ai/dsh web
npx @deepseek-ai/dsh --profile web --dump-config | grep -A2 drawioedit
```

卸载用 `dsh plugin --profile web remove @guowenzhang/dsh-drawioedit`，依赖与层一起移除。

所安装的 profile 必须组合了 `@deepseek-ai/dsh-client-ui-sidebar-right`——本插件所贡献的标签注册表由它拥有。
所有随附的 web profile 都满足这一点。

## 编辑器如何被驱动

编辑器是**应用**而非组件，因此运行在同源的 iframe 中（必须同源——跨源的父页面根本读不到它）。

**加载。** drawio 的 bootstrap 从 `#P` hash 读取 URL 参数，其 JSON 可用 `hash` 字段携带图表，随后被还原为真正的
`location.hash`（`#R` + 编码后的 XML）：

```
/plugins/dsh-drawioedit/editor/index.html#P{"client":"1","hash":"#R<encoded xml>","dshTitle":"name.drawio"}
```

裸 `#R` 会被忽略，所以两层都必须有。`dshTitle` 携带文件名供 shim 使用；这里**故意不用** drawio 自己的 `title`
参数，因为 drawio 会对它做百分号解码，而文件名里可能带 `%`。

**读取。** 标签页的 `dsh-resource://file/…` 地址给出会话与路径，body 经
`workspaceFiles.readBytes(sessionId, path, {}, signal)` 整文件读取。这条缝上的字节字段是**原生字节**——Remote 在
client 拿到之前就已解出二进制字段，所以没有 base64 需要解码——返回值同时带上 host 解析出的绝对路径，以及之后写入
时作为守卫的新鲜度令牌。

**保存。** shim 把每次改动作为 `{event:'autosave', xml}` 回传，标签页 body 把它 POST 到
`/plugins/dsh-drawioedit/save`。该端点经 `ctx.fs` 写入，并带上读取时观察到的版本号作为新鲜度守卫——所以编辑器打开
期间 agent 写入的内容会被拒绝，而不是被覆盖。写成功后 host 会把 `{action:'saved'}` 发回编辑器，这正是把 drawio
自己的 "Unsaved changes" 变成 "All changes saved" 的那一步。

**为什么需要 shim。** drawio 的 `#create=` 握手在同源 iframe 里用不了——它的消息监听器在
`evt.source == (window.opener || window.parent)` 不成立时直接返回（App.js），这个身份判断是为它 embed 代码打开的
弹出窗口写的；而编辑器又把实例藏在闭包里，没有任何全局变量暴露它。所以 shim 拦截 `window.EditorUi` 的赋值，用**只
转发**的 `Proxy` 抓住实例，并接管 `ui.saveFile`——所有保存命令唯一汇入的那个方法。shim 在服务时注入，位置在
`bootstrap.js` 与 `main.js` 之间，因此 vendored 编辑器文件保持原样。**这依赖 drawio 内部实现**：若 drawio 升级后
改名 `EditorUi`、`saveFile` 或 `getFileData`，它就会坏；发现这件事的是 `tests/boot.mjs`，因为它在真实浏览器里断言
编辑器的最终状态。实现见 `src/shim.ts`。

**云集成保持关闭。** drawio 的每个云集成默认都会联网加载第三方 SDK；现在它们在 `src/params.ts` 里按名字逐个关闭，
`offline` 测试会在启动期间出现任何远程主机时失败。

## 测试

`npm test` 跑八个无需密钥的测试套件，其中两个驱动真实的 headless Chrome——它们会按所在平台的默认位置查找浏览器；
若装在别处，用 `CHROME_PATH` 指向 Chrome/Chromium 可执行文件。

| 套件 | 证明什么 |
|---|---|
| `artifact` | 两个提交的产物都不早于其源码 |
| `smoke` | 构建出的 client 产物能按浏览器方式加载（模块表里只有 `react`），注册标签类型与 body，并经 Client Remote 的 `readBytes` 读出一份图表 |
| `serve` | 编辑器路由提供真实文件、拒绝路径穿越、把 shim 注入到正确位置 |
| `save` | 保存端点用 `replaceIfVersion` 守卫写入，并拒绝畸形请求 |
| `shim` | shim 能解析、钩住编辑器类、抓住实例、上报改动、接管保存汇入点 |
| `shimdelivery` | shim 经插件路由在定义编辑器的脚本之前到达 |
| `boot` | 编辑器启动到画布、画出图表、回传、命名，并让菜单在菜单栏旁边展开 |
| `offline` | 编辑器启动全程未访问远程主机，且它请求的每个资源都存在 |

`offline` 的资源断言是有价值的：`editor/mxgraph/css/common.css` 是
`div.mxPopupMenu { position: absolute }` 唯一的声明处，缺了它编辑器照样能启动——菜单只是顺着文档流跑到工具栏下面
——所以真正抓住资源缺失的是那条 4xx 断言。`tests/debug/` 放的是开发 embed 协议期间用的浏览器驱动与 bundle 扫描
工具，不进套件，其中 `scan-assets.mjs` 是**故意有噪声**的。

## 诊断

在 DevTools 里切到编辑器 frame，读 `window.__dshShimState`：

| 字段 | 含义 |
|---|---|
| `revision` | 浏览器正在跑的 shim 版本；它是 host 半边代码，所以这一项能抓出"host 是旧的" |
| `hooked` / `installs` | 类已被拦截、实例已被抓住（`installs` ≥ 1） |
| `reports` | 编辑器读取了图表并上报——一次改动或一次保存 |
| `saved` | host 确认了写入；不涨的话 drawio 会一直显示 "Unsaved changes" |
| `keys` | Ctrl+S 兜底监听看到了按键 |
| `errors` / `lastError` | 读取图表时抛异常——否则所有调用方都会把它当作"没有变化"吞掉 |
| `saveFileOwned` | shim 是否接管了保存汇入点，必须是 `true` |
| `rebound` | shim 打过补丁的东西：`save`、`saveAs`、`saveFile`、`mxUtils.fit` |

## 构建

```sh
npm install
npm run build      # host 半边走 tsdown，浏览器半边走 build-client.mjs
npm run typecheck  # 对**已发布**的 @deepseek-ai/* 包做 tsc
npm test           # 八个无需密钥的套件，其中两个驱动浏览器
```

`typecheck` 只覆盖本包自己的源码，**不覆盖 Client Remote 的方法集**：命名空间由 harness 在运行时生成并装配，而本包
不安装声明它们的 gateway，所以 `ctx.remote` 在这里按不受约束处理。这条边由 `tests/smoke.mjs` 守住——它用一份形状
与生成命名空间一致的 Remote 假件驱动 body 的读取，因此命名空间里没有的方法会让套件失败。

插件的两半更新方式不同：client 产物（`lib/client.js`）由 harness 热替换，或刷新页面；host 半边
（`lib/index.mjs`）承载编辑器路由、保存端点与 shim 源码，需要**重启 `dsh web`**。因此改 `src/shim.ts` 在 host
重启前不生效。`src/` 小到可以直接读：`index.ts`
与 `serve.ts`（路由与 shim 注入）、`save.ts`（带版本守卫的写入）、`params.ts`（编辑器 URL）、`client/`（标签类型、
iframe body、传输层）。

harness 单仓打客户端产物用的脚本并未发布，因此本仓库自己打包浏览器半。这里显式声明 `platform: 'browser'`：在
rolldown 的 `node` 平台下，若某依赖的 `exports` 把平台条件排在 `import` 之前，它的**服务端入口**会被内联，而那个
入口可能在模块顶层 `require("module")`——这是浏览器模块表回答不了的标识符。

`editor/` 由上游 webapp 裁剪而来：去掉 `WEB-INF/`（Java jar）、`js/integrate.min.js`、service worker，以及未压缩
的旧 `mxgraph/src` 源码——从 148.6 MB 降到 119.0 MB。`mxgraph/css/common.css` 保留，原因见上。

## 许可

Apache-2.0。内嵌编辑器为 Apache-2.0，其图标集与 stencil 库附带额外条款；详见 [NOTICE](NOTICE)。
