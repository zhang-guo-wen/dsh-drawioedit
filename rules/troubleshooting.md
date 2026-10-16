# rules/troubleshooting.md —— 覆盖：`window.__dshShimState` 诊断字段与判断层次；何时读：编辑器打不开、不保存、停在 splash 或怀疑 host 是旧版本时

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
