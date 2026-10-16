# rules/runtime-mechanisms.md —— 覆盖：编辑器加载、读取、保存与 shim 的技术决策和机制；何时读：改加载路径、读取、保存、沙箱或 shim 行为之前

（原文「技术决策与机制」一节；其中 `editor/` 裁剪部分见 [`editor-assets.md`](editor-assets.md)。）

## 技术决策与机制

**编辑器是应用，所以跑在同源 iframe 里。** draw.io 是整个 webapp，不是能塞进 React 树的组件；父页面要驱动它，iframe 必须与 harness 前端**同源**——跨源的父页面根本读不到里面的文档。因此 `src/index.ts` 为编辑器的文件申请一条 `webServer` 前缀路由，而不是依赖任何隐式的资源映射。

**加载走 `#P` + `#R` 双层 hash，且用 `dshTitle` 而不是 drawio 自己的 `title`。** drawio 的 bootstrap 从 `#P` hash 读 URL 参数，其 JSON 可用 `hash` 字段携带图表，随后被还原为真正的 `location.hash`（`#R` + 编码后的 XML）；裸 `#R` 会被忽略，所以两层都必须有：

```
/plugins/dsh-drawioedit/editor/index.html#P{"client":"1","hash":"#R<encoded xml>","dshTitle":"name.drawio"}
```

`client: 1` 标记嵌入方是宿主应用。文件名走本包自己的 `dshTitle`，**故意不用** drawio 的 `title` 参数：drawio 会对它做百分号解码，而文件名里可能带 `%`。这条路径不需要任何握手，是编辑器唯一可靠的装载方式。

**iframe 带 sandbox。** 生产 body 给 frame 的 sandbox 是 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`（`tests/boot.mjs` 逐字复用同一个字符串）。它阻止 frame 把应用导航走、以及打开标签页没要求的对话框；`allow-same-origin` 是必需的，因为 drawio 把设置存在 `localStorage` 里。Chrome 会告警这一对组合能让 frame 逃出自己的沙箱——这是事实，在这里也可接受：被框住的文档是本插件自己的代码，不是不可信内容；图表是数据，drawio 用 `DOMParser` 解析它，既不执行也不解析外部实体（`tests/offline.mjs` 证明带外部实体的 `DOCTYPE` 不会发起任何请求）。

**读取：`dsh-resource://file/…` + `workspaceFiles.readBytes`。** 标签页的地址给出会话与路径（`parseFileAddress`，`scope` 必须是 `session`），body 经 `workspaceFiles.readBytes(sessionId, path, {}, signal)` 整文件读取。这条缝上的字节是**原生字节**——Remote 在 client 拿到之前已解出二进制字段，所以没有 base64 需要解码——返回值同时带上 host 解析出的**绝对路径**与新鲜度令牌。用绝对路径而不是工作区相对路径是必须的：读取按会话工作区根解析相对路径，而经 `fs` 写入按进程目录解析，把相对路径原样传回去会写到另一个文件。

**保存：`/plugins/dsh-drawioedit/save` + `replaceIfVersion` 守卫。** Workspace Files 是只读缝，改动回不去，所以走应用同源的 POST。shim 把每次改动作为 `{event:'autosave', xml}` 回传，body 取最新的一份写回，并带上读取文件的会话 ID；服务端查找活动会话或读取持久化会话的 header 与最近一次 `sandbox/mode` 事件，并显式把相应沙箱策略传给 `fs.writeText`，否则 HTTP 请求会错误地落到服务进程的默认工作区边界。一次写入完成后 host 回带新令牌，下一次保存必须提供它；空令牌表示不设版本前置条件。守卫是**新鲜度前置条件**：编辑器打开期间 agent 写入的内容会被拒绝，而不是被静默覆盖。客户端把并发收成一条链——同一时刻只有一个保存在飞，等待期间只保留最新的一份图（拖动形状会产生一串改动事件），否则两个保存会拿着同一个令牌、第二个被误判为过期。写成功后 host 把 `{action:'saved'}` 发回编辑器，shim 调 `ui.editor.setModified(false)` 并把状态区换成 `mxResources` 的 `allChangesSaved`，这正是把 drawio 自己的 "Unsaved changes" 变成 "All changes saved" 的那一步——不确认的话，写成功看起来和写失败一样。沙箱拒绝与版本冲突会带结构化错误码，客户端用本地化文案提示修改未保存。frame 上方另有一行**本插件自己的**写入状态（`data-phase` 为 `saving` / `renaming` / `saved`，失败留在原地并给重试）：drawio 上报的是它自己工具栏里的 "All changes saved"，而这一行说的是本插件发起的那次写入，`saved` 约 2 秒后收起，避免与编辑器自己的状态重复。

**为什么需要 shim。** drawio 的 `#create=` 握手在同源 iframe 里用不了：它的消息监听器在 `evt.source == (window.opener || window.parent)` 不成立时直接返回（App.js），这个身份判断是为 `Embed.js` 打开的弹出窗口写的，消息因此在没有任何报错的地方被丢掉。编辑器又把实例藏在闭包里——DOM 上没有引用，也没有任何全局暴露它（对照随包构建核实过）。所以 shim 拦截 `window.EditorUi` 的**赋值**（`Object.defineProperty` 的 get/set + `WeakSet`），用**只转发的 `Proxy`** 抓住构造出的实例，并接管 `ui.saveFile`——所有保存命令唯一汇入的那个方法；同时也重新绑定 `ui.actions` 的 `save` / `saveAs`（状态横幅是在点击时才查 action 的）。`Proxy` 而不是包装类是必须的：drawio 在赋值之后才完成这个类，`mxEventSource` mixin 稍后替换 prototype，持有旧 prototype 的包装类会让 `Editor` 这类子类构造时缺 `setEventSource`，drawio 记下 "SEVERE this.setEventSource is not a function" 并永远停在 splash 上。shim 还打了 `mxUtils.fit`（把弹出菜单限制在 frame 内，而不是按文档测量）与文档 `scrollTop` 归零（这个文档是应用 frame，不是页面），并在捕获阶段兜底 Ctrl+S。shim 也认 `{action:'create', data}`（调用编辑器自己的 `executeCreateObject`），但本插件 body 走 URL 加载这条无需握手的路径，因此不依赖它。

**注入位置在 `bootstrap.js` 与 `main.js` 之间。** `injectShim` 在服务时把 `<script src="${SHIM_PATH}"></script>` 插到 `index.html` 里 `bootstrap.js` 那一行之后，所以 `urlParams` 已经就绪、而定义 `EditorUi` 的 `main.js` 还没执行；vendored 编辑器的 HTML 保持原样，这件事只有一个可见的位置。shim 以 `cache-control: no-store` 提供——它是 host 半边代码，陈旧副本从外面看只表现为"编辑器坏了"。`SHIM_REVISION` 记录它自己的版本（当前为 7；历史：2：改为 Proxy 转发；3：保存命令写回文件而不是走 drawio 的下载流程，并清掉未保存提示；4：在保存汇入点拦截而不是在 action 对象上，并把图表按打开的文件命名；5：弹出菜单按 frame 收边，文档不保留滚动位置；6：限制可选图形库）。

**云集成按名字关闭。** drawio 的每个云集成默认都会联网加载第三方 SDK，`src/params.ts` 的 `DISABLED_INTEGRATIONS` 在 URL 里逐个关掉：`gapi`、`db`、`od`、`ms365`、`drive`、`picker`、`tr`、`sockets`。这份清单只有一个家——host 的 `editorUrl()`、`tests/offline.mjs` 的宿主页与生产 body 用的是同一个构造器，所以它们不可能漂移。`offline` 套件在编辑器启动期间出现任何远程主机时失败，并额外证明图里带外部实体的 `DOCTYPE` 不会触发任何请求（drawio 用平台 `DOMParser` 解析，不解析外部实体）。
