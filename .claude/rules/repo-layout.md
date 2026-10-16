---
paths:
  - "src/**"
  - "tests/**"
  - "editor/**"
  - "docs/**"
  - "lib/**"
  - "package.json"
  - "cordis.patch.yml"
  - "README.md"
---

> 覆盖：仓库定位与各文件/目录职责；何时读：新增、移动或重命名文件，判断代码该落在 host 还是 client 半边，或确认某个模块导出什么时

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-drawioedit`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

- `src/index.ts` —— host 半边入口：`inject = ['webServer', 'fs', 'sessions', 'sandboxPolicy', 'sessionQuery']`，`apply` 里经 `ctx.effect(...)` 注册编辑器静态路由与保存端点；并把 `SHIM_PATH` / `SHIM_REVISION` / `SHIM_SOURCE` / `assertShimUsable` / `EDITOR_PATH` / `editorUrl` / `EDITOR_ROUTE` / `SAVE_ROUTE` re-export 给本包自己的测试，免得它们伸手进内部模块路径。
- `src/serve.ts` —— `EDITOR_ROUTE = '/plugins/dsh-drawioedit/editor'` 前缀路由：路径穿越防护（`normalize` 收敛 `..` 后做包含性检查，越界一律 403；不存在的名字才 404）、content-type 表、`index.html` 的 shim 注入、`SHIM_PATH` 以 `no-store` 提供、其余文件 `public, max-age=86400`。
- `src/save.ts` —— `SAVE_ROUTE = '/plugins/dsh-drawioedit/save'`：只接受 POST，请求体上限 `MAX_DIAGRAM_BYTES = 8 * 1024 * 1024`（超限拒绝而不是截断），`parseSaveRequest` 校验字段及会话 ID，写入走 `fs.resolve` + 带会话沙箱策略和 `replaceIfVersion` 守卫的 `fs.writeText`，响应回带新版本令牌；权限拒绝返回结构化错误码供客户端本地化。
- `src/shim.ts` —— 注入编辑器页面的 pre-load shim 源码（`SHIM_REVISION = 7`；判断运行中是哪一版看 frame 里的 `window.__dshShimState.revision`）、`SHIM_PATH`、模块加载即执行的 `assertShimUsable`（校验包裹、截断、`</script`、花括号配平、模板字面量里残留的 `${`）。
- `src/params.ts` —— 编辑器 URL（`EDITOR_PATH`、`editorUrl()`）与按名字关闭的云集成清单（`DISABLED_INTEGRATIONS`）。
- `src/client/` —— 浏览器半边：`index.ts`（标签类型、body 座位、transports 安装）、`EditorBody.tsx`（iframe 与消息泵；读取有骨架与失败重试，写入有 保存中 / 已保存 / 失败 三态）、`transports.ts`（read/save 模块句柄）、`editor.ts`（消息解析与 save POST）、`locales.ts`、`EditorBody.module.css`。
- `editor/` —— 随包的上游 drawio webapp（裁剪说明见 [`editor-assets.md`](editor-assets.md)）；`package.json` 的 `files` 里带着它。`build-stencils.mjs` 从保留的 XML 重建 `editor/js/stencils.min.js`。
- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**；`lib/index.mjs` 里内嵌了 shim 源码。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `docs/example.png` / `docs/example.drawio` —— README 的截图与它的源文件。
- `tests/` —— 十一个套件（`npm test`）与不进套件的 `tests/debug/`。
- `.claude/rules/` —— `AGENTS.md` 的明细分册，按需读取；**不在** `package.json` 的 `files` 里，因此不随 npm 包分发（放包根而不是 `docs/`：`files` 包含整个 `docs`）。
