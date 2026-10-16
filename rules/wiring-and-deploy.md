# rules/wiring-and-deploy.md —— 覆盖：组合接线（profile 层、扩展点契约、inject 服务）与安装/生效语义；何时读：安装、卸载、改 `cordis.patch.yml` 或 `dsh` 字段，或遇到「改了却不生效」时

## 组合接线

`cordis.patch.yml` 只做一件事——把插件行插进 profile 组合出来的 bundle 层：

```yaml
- insert:
    - id: drawioedit
      name: '@guowenzhang/dsh-drawioedit'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这个补丁文件，`dsh.client.platform` 为 `web`，`dsh.client.inject` 列出浏览器半边 apply 用到的服务提供包——`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-renderer`、`@deepseek-ai/dsh-client-ui-sidebar-right`。`exports` 另导出 `./client`（`lib/client.js`）与 `./cordis.patch.yml`。

扩展点归 `@deepseek-ai/dsh-client-ui-sidebar-right` 所有，本插件只按它的契约贡献两项：标签类型进 `ctx.sidebarRightTabs`（`id: '@guowenzhang/dsh-drawioedit'`、`kind: 'drawio-edit'`、`patterns: ['*.drawio']`、`title: basenameOf`），body 进点名座位 `sidebar.right.pane.tab`，key 同为该实现 id。宿主 profile 必须组合该包，所有随附的 web profile 都满足；没有它时 `inject` 拿不到服务，标签页不会出现。

host 侧另有五处接线：`inject = ['webServer', 'fs', 'sessions', 'sandboxPolicy', 'sessionQuery']`，`webServer` 提供路由注册表（前缀路由 + 精确路由），`fs` 提供带新鲜度守卫的写入，`sessions`、`sandboxPolicy` 与 `sessionQuery` 为 HTTP 保存请求恢复标签页所属会话的写入权限（包括宿主重启后的持久化会话）。`ctx.remote.workspaceFiles` 是 client 侧读取文件用的 Remote 命名空间，在 `dsh.client.inject` 之外由浏览器半边按需取用。

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
npx @deepseek-ai/dsh plugin --profile web add "git+https://github.com/zhang-guo-wen/dsh-drawioedit.git#v1.0.0"

# 本地目录开发安装；包管理器建 symlink，重建 lib/ 后重启即生效，无需重装
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-drawioedit

# 卸载：依赖条目与 bundle 层一起移除
npx @deepseek-ai/dsh plugin --profile web remove @guowenzhang/dsh-drawioedit
```

`lib/` 已提交进仓库，所以装完即可运行，**使用者不需要构建**；下载里带着 `editor/`（约 43 MiB）。本地目录安装建的是 symlink，`file:` 依赖则可能退化成物理拷贝，那时改源码不会影响正在跑的 dsh。装完确认层进了组合：

```sh
npx @deepseek-ai/dsh web
npx @deepseek-ai/dsh --profile web --dump-config | grep -A2 drawioedit
```

插件的两半更新方式不同：

- **client 半边按内容 revision 提供。** 产物变了刷新页面就会取到新的；`HANDOFF_ID` 就是这个 revision 的标识，改动 client 后必须 bump 它或强刷浏览器，否则浏览器一直跑旧 bundle。
- **host 半边是进程内模块。** 重建 `lib/index.mjs` 不会替换正在运行的那份代码，只有重启宿主才会加载新产物。编辑器路由、保存端点与 **shim 源码**都在这半边，所以改 `src/shim.ts` 在重启前不生效。
- `HANDOFF_ID` 在 `build-client.mjs` 里，值为 `@guowenzhang/dsh-drawioedit`，必须与 `lib/client.js` 包裹里的 `id` 及 `tests/smoke.mjs` 断言的 id 一致。
- `--dump-config` 只反映组合，不反映进程内代码；判断浏览器跑的是哪一版 shim，看编辑器 frame 里的 `window.__dshShimState.revision`（见 [`troubleshooting.md`](troubleshooting.md)）。
