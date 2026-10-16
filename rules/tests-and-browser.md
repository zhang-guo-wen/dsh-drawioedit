# rules/tests-and-browser.md —— 覆盖：十一个套件各自证明什么、真实浏览器驱动与调试工具；何时读：改测试、判断该补哪个套件、套件失败或需要真实浏览器验证时

## 测试

`npm test` 跑十一个无需密钥的套件；其中 `boot` 与 `offline` 驱动真实的 headless Chrome，默认按平台查找（Windows `C:/Program Files/Google/Chrome/Application/chrome.exe`、macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、Linux `google-chrome`），装在别处就用 `CHROME_PATH` 指向 Chrome/Chromium 可执行文件；找不到可执行文件时探针会明确打印原因并以 2 退出，而不是看起来像挂死。

| 套件 | 证明什么 |
|---|---|
| `artifact` | 两个提交的产物都不早于其源码（`lib/client.js` 不早于 `src/client`，`lib/index.mjs` 不早于 `src/**/*.ts`） |
| `stencils` | 保留的四个 XML 与 `js/stencils.min.js` 中的压缩副本逐字节相同，专业库未重新混入安装包 |
| `editor-assets` | 未压缩开发 JS 已移除、按需导入器保留，模板索引 XML 有效且每个条目都指向随包文件 |
| `smoke` | 构建出的 client 产物能按浏览器方式加载（模块表里只有 `react`），注册标签类型与 body，并经 Client Remote 的 `readBytes` 读出一份图表 |
| `serve` | 编辑器路由提供真实文件、拒绝路径穿越（含 `%2e%2e%2f` 编码形式）、把 shim 注入到 `bootstrap.js` 之后与 `main.js` 之前，并交叉核对 client 产物引用的是同一条路由 |
| `save` | 保存端点用标签页会话的权限与 `replaceIfVersion` 守卫写入、拒绝未知会话、畸形请求与非 POST，且对畸形请求不做任何写入尝试 |
| `rename` | 重命名端点用标签页会话的权限与 `replaceIfVersion` 守卫改名、拒绝重名（409，不覆盖目标）、路径穿越（400）、过期版本与会话工作区外的文件，且改名后内容逐字保留 |
| `shim` | shim 能解析（`vm.Script`）、钩住编辑器类、抓住实例、上报改动、接管保存汇入点 |
| `shimdelivery` | shim 经插件路由在定义编辑器的脚本之前到达，且响应不带 `max-age` |
| `boot` | 编辑器启动到画布、画出图表、回传、命名，并让菜单在菜单栏旁边展开 |
| `offline` | 编辑器启动全程未访问远程主机、外部实体未被解析、请求的每个资源都存在、控制台没有初始化失败 |

`artifact` 存在的理由不是形式主义：`npm run build` 曾被发现在重建 host 半边时把 `lib/client.js` 留在旧版本，于是修复能通过 typecheck 与测试（测试跑的是产物）而产物仍是旧代码。`boot` 存在的理由同样具体：更窄的套件在一个坏掉的编辑器上也会全绿——host 可以把每个字节都用 200 发出去，shim 也可以钩住类，而应用仍停在 splash 上。

`offline` 的资源断言是有价值的：`editor/mxgraph/css/common.css` 是 `div.mxPopupMenu { position: absolute }` 唯一的声明处，缺了它编辑器照样能启动——菜单只是顺着文档流跑到工具栏下面——所以真正抓住资源缺失的是那条 4xx 断言。`tests/debug/` 放的是开发 embed 协议期间用的浏览器驱动与 bundle 扫描工具（`capture-docs-shot.mjs`、`cdp-check.mjs`、`live-probe.mjs`、`protocol.mjs`、`sandbox-probe.mjs`、`scan-assets.mjs`、`scan-bundle.mjs`、`scan-urlparams.mjs`），不进套件，其中 `scan-assets.mjs` 是**故意有噪声**的。

另一条 `npm test` 之外的入口：`npm run test:metadata` 跑 `tests/plugin-metadata.test.mjs`（包元数据检查）。
