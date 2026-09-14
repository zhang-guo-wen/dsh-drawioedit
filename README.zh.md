# dsh-drawioedit

[English](README.md) | 中文

一个**独立**的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在 Web 侧栏中用上游 [draw.io](https://github.com/jgraph/drawio) 编辑器编辑 `.drawio` 图表，改动会**写回标签页打开的那个文件**。

它是 [`dsh-drawio`](https://github.com/zhang-guo-wen/dsh-drawio) 的编辑版姊妹插件——后者用 maxGraph 只读渲染 `.drawio`。两者互相独立，可单独安装，也可同时安装。

> 与 draw.io Ltd 无从属或背书关系。"draw.io" 是 draw.io Ltd 的注册商标。本包内嵌其 Apache-2.0 许可的编辑器；详见 [NOTICE](NOTICE)。

## 能做什么

- `.drawio` 文件在侧栏标签页里用完整的上游编辑器打开。
- 每次改动都写回同一个文件：改动后一秒内自动写回，以及 **Ctrl+S**、工具栏保存按钮、File → Save / Save As、编辑器自己那条 "Unsaved changes. Click here to save." 提示。
- 编辑器用文件名给图表命名，而不是显示 "Untitled Diagram"。
- 编辑器启动全程不访问任何第三方主机，图表不会离开本机。

## 为什么需要第二个插件

maxGraph 是**库**，而且和 draw.io 使用的不是同一个渲染器。`.drawio` 文件只存边的端点和一个 `edgeStyle` 名字，**从不存路由后的拐点**，所以每个查看器各自计算路径，两者就会分叉。可见症状是边标签压在节点文字上。本插件用 draw.io 自己的代码渲染，因此输出与 draw.io 完全一致。

| | `dsh-drawio` | `dsh-drawioedit` |
|---|---|---|
| 只读预览 | ✅ 1 MB 产物 | — |
| 编辑能力 | — | ✅ 上游 draw.io 编辑器 |
| 写回原文件 | — | ✅ |
| 渲染保真度 | 良好 | 完全一致 |
| 部署体积 | ~1 MB | ~119 MB |

## 状态

每一环都已在真实浏览器里验证。浏览器驱动的测试就是证据：`tests/boot.mjs` 完全按面板的方式加载编辑器并断言**用户能看到的结果**，`tests/offline.mjs` 断言浏览器**实际发出了哪些请求**。

| 部分 | 状态 |
|---|---|
| 编辑器启动到画布，并画出交给它的图表 | ✅ 浏览器验证 |
| 启动所需资源全部存在（无 4xx） | ✅ 浏览器验证 |
| 改动回传面板并写回文件 | ✅ 浏览器验证（`reports`、`saved`） |
| 保存命令写回文件，而不是弹 drawio 的下载框 | ✅ 浏览器 + shim 测试验证 |
| 图表用文件名标注 | ✅ 浏览器验证 |
| 菜单在菜单栏旁边展开，且不出面板 | ✅ 浏览器验证 |
| 启动全程不访问任何远程主机 | ✅ 浏览器网络日志验证 |
| 保存端点带版本守卫（`replaceIfVersion`） | ✅ HTTP 验证 |

### 需要重启还是刷新？

插件分两半，更新方式不同。

| 半边 | 内容 | 改动如何到达浏览器 |
|---|---|---|
| client 产物（`lib/client.js`） | 标签类型、iframe body、保存通道 | 由 harness 热替换，或刷新页面 |
| host 半边（`lib/index.mjs`） | 编辑器路由、保存端点，**以及 shim 源码** | **重启 `dsh web`** |

shim 属于 host 半边：host 从内存里把它发出去，所以改 `src/shim.ts` 在 host 重启前不生效。这很容易被误判成编辑器坏了，所以 shim 会自报版本 —— `window.__dshShimState.revision` 就是"我现在跑的是哪个 shim"的答案。

## 安装

```sh
cd "$DSH_HOME/profiles/web"
pnpm add link:C:/path/to/this-repo          # 或：npm install <path-or-git-url>
```

然后在该 profile 的 `package.json` 里**两处**都登记为 bundle：

```jsonc
{
  "dsh": { "profile": { "bundles": ["@zhang-guo-wen/dsh-drawioedit"] } },
  "dependencies": { "@zhang-guo-wen/dsh-drawioedit": "link:C:/path/to/this-repo" }
}
```

启动前先确认组合结果：

```sh
dsh --profile web --dump-config | grep -A2 drawioedit
```

## 编辑器如何被驱动

编辑器是**应用**而非组件，因此运行在同源的 iframe 中（必须同源——跨源的父页面根本读不到它）。

**加载。** drawio 的 bootstrap 从 `#P` hash 读取 URL 参数，其 JSON 可用 `hash` 字段携带图表，随后被还原为真正的 `location.hash`（`#R` + 编码后的 XML）：

```
/plugins/dsh-drawioedit/editor/index.html#P{"client":"1","hash":"#R<encoded xml>","dshTitle":"name.drawio"}
```

裸 `#R` 会被忽略，所以两层都必须有。`dshTitle` 携带文件名供 shim 使用；这里**故意不用** drawio 自己的 `title` 参数，因为 drawio 会对它做百分号解码，而文件名里可能带 `%`。

**保存。** shim 把每次改动作为 `{event:'autosave', xml}` 回传，标签页 body 把它 POST 到 `/plugins/dsh-drawioedit/save`。该端点经 `ctx.fs` 写入，并带上读取时观察到的版本号作为新鲜度守卫 —— 所以编辑器打开期间 agent 写入的内容会被拒绝，而不是被覆盖。写成功后 host 会把 `{action:'saved'}` 发回编辑器，这正是把 drawio 自己的 "Unsaved changes" 变成 "All changes saved" 的那一步。

### 为什么需要 shim

drawio 的 `#create=` 握手在同源 iframe 里用不了：它的消息监听器在 `evt.source == (window.opener || window.parent)` 不成立时直接返回（App.js），这个身份判断是为它 embed 代码打开的弹出窗口写的。编辑器还把实例藏在闭包里 —— DOM 里没有引用，也没有任何全局变量暴露它，而 shim 运行时 `window.EditorUi` 还不存在。

所以 shim 拦截 `window.EditorUi` 的赋值，并在实例被构造时抓住它。包装用的是**只转发**的 `Proxy`，而不是拷贝原型的函数：drawio 在类写完**之前**就赋了全局，`mxEventSource` 混入随后替换掉原型，而一个持有赋值那一刻原型的包装会让所有子类在构造时缺少 `setEventSource` —— 编辑器就永远停在启动页。

抓住实例之后，shim 会：

- 把改动作为 `{event:'autosave', xml}` 上报，并接受 `{action:'create', data}` 装载图表；
- **接管 `ui.saveFile`** —— 所有保存命令唯一汇入的那个方法。只替换 *action* 是不够的：File 菜单在构建时就抓走了它的 action，那时 shim 还没拿到实例。要另存副本仍可用 Export as，副本应该走那里；
- 用面板打开的文件名给图表命名；
- 让文档不残留滚动位置，并把展开的弹窗保持在 frame 内 —— 因为 drawio 是按它自己量到的**文档**来安放弹窗的。

shim 在服务时注入，位置在 `bootstrap.js` 与 `main.js` 之间，因此 vendored 编辑器文件保持原样，改动只在一处。**这依赖 drawio 内部实现**：若 drawio 升级后改名 `EditorUi`、`saveFile` 或 `getFileData`，它就会坏。`shim` 测试会在源码无法解析或钩子抓不到实例时立刻报错，但它无法发现私有 API 被改名 —— 发现这件事的是 `boot.mjs`，因为它在真实浏览器里断言编辑器的最终状态。

### 图表不出本机

编辑器从应用源提供，启动全程没有任何第三方请求。这一开始并非如此：drawio 的每个云集成默认都会联网加载第三方 SDK。现在它们在 `src/params.ts` 里按名字逐个关闭，`offline` 测试会在启动期间出现任何远程主机时失败。

## 测试

`npm test` 跑八个无需密钥的测试套件，其中两个驱动真实的 headless Chrome —— 它们会按所在平台的默认位置查找浏览器；若装在别处，用 `CHROME_PATH` 指向 Chrome/Chromium 可执行文件。

| 套件 | 证明什么 |
|---|---|
| `artifact` | 两个提交的产物都不早于其源码 |
| `smoke` | 构建出的 client 产物能按浏览器方式加载（模块表里只有 `react`），并注册标签类型与 body |
| `serve` | 编辑器路由提供真实文件、拒绝路径穿越、把 shim 注入到正确位置 |
| `save` | 保存端点用 `replaceIfVersion` 守卫写入，并拒绝畸形请求 |
| `shim` | shim 能解析、钩住编辑器类、抓住实例、上报改动、接管保存汇入点 |
| `shimdelivery` | shim 经插件路由在定义编辑器的脚本之前到达 |
| `boot` | 编辑器启动到画布、画出图表、回传、命名，并让菜单在菜单栏旁边展开 |
| `offline` | 编辑器启动全程未访问远程主机，且它请求的每个资源都存在 |

`offline` 里"请求的每个资源都存在"不是装饰：本 checkout 曾经缺少 `editor/mxgraph/css/common.css`，而它是 `div.mxPopupMenu { position: absolute }` 唯一的声明处。缺了它，drawio 算出的弹窗坐标会被忽略，菜单就顺着文档流跑到工具栏下面去。**其它测试全都照过**（编辑器照样能启动），所以真正抓住它的是那条 4xx 断言。

`tests/debug/` 放的是开发 embed 协议期间用的浏览器驱动与 bundle 扫描工具，不进套件。其中 `tests/debug/scan-assets.mjs` 是**故意有噪声**的：它报出来的大多数是 drawio 从自己形状库里解析的 stencil 图标名。

## 诊断

在 DevTools 里切到编辑器 frame，读 `window.__dshShimState`：

| 字段 | 含义 |
|---|---|
| `revision` | 浏览器正在跑的 shim 版本；它是 host 半边代码，所以这一项能抓出"host 是旧的" |
| `hooked` / `installs` | 类已被拦截、实例已被抓住（`installs` ≥ 1） |
| `reports` | 编辑器读取了图表并上报 —— 一次改动或一次保存 |
| `saved` | host 确认了写入；不涨的话 drawio 会一直显示 "Unsaved changes" |
| `keys` | Ctrl+S 兜底监听看到了按键 |
| `errors` / `lastError` | 读取图表时抛异常 —— 否则所有调用方都会把它当作"没有变化"吞掉 |
| `saveFileOwned` | shim 是否接管了保存汇入点，必须是 `true` |
| `rebound` | shim 打过补丁的东西：`save`、`saveAs`、`saveFile`、`mxUtils.fit` |

## 目录结构

```
editor/                     上游 draw.io webapp，已裁剪（119 MB）
src/index.ts                host 半边：编辑器路由与保存端点
src/serve.ts                提供编辑器文件、注入 shim、拒绝路径穿越
src/save.ts                 保存端点与其版本守卫
src/shim.ts                 shim 源码与版本号
src/params.ts               编辑器 URL：云集成开关与文件名
src/client/index.ts         注册标签类型与 body
src/client/EditorBody.tsx   iframe、消息桥、写入串行化
src/client/editor.ts        消息解析、base64 解码、保存请求
src/client/transports.ts    读取与保存通道
tests/boot.mjs              在 headless Chrome 里驱动编辑器，断言用户能看到的结果
tests/offline.mjs           启动编辑器并断言浏览器实际发出了什么请求
tests/chrome.mjs            两个浏览器套件所启动的浏览器来自哪里
build-client.mjs            把浏览器半边打包成 loader 交接格式
cordis.patch.yml            本包插入的组合行
```

`editor/` 由上游 webapp 裁剪而来：去掉 `WEB-INF/`（Java jar）、`js/integrate.min.js`、service worker，以及未压缩的旧 `mxgraph/src` 源码 —— 从 148.6 MB 降到 119.0 MB。`mxgraph/css/common.css` 保留，原因见上。

## 构建

```sh
npm install
npm run build      # host 半边走 tsdown，浏览器半边走 build-client.mjs
npm run typecheck  # 对**已发布**的 @deepseek-ai/* 包做 tsc
npm test           # 八个无需密钥的套件，其中两个驱动浏览器
```

`lib/` 已提交，因此本仓库从 git 安装无需构建步骤。

### 为什么浏览器半边自带打包器

harness 单仓用 `packages/client/tsdown.client.ts` 构建 client 产物，而它并未发布。这里显式声明 `platform: 'browser'`：在 rolldown 的 `node` 平台下，若某依赖的 `exports` 把平台条件排在 `import` 之前，它的**服务端入口**会被内联，而那个入口可能在模块顶层 `require("module")` —— 这是浏览器模块表回答不了的标识符。

## 许可

Apache-2.0。内嵌编辑器为 Apache-2.0，其图标集与 stencil 库附带额外条款；详见 [NOTICE](NOTICE)。
