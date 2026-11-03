---
description: "@guowenzhang/dsh-drawioedit 的行为验证记录：每次验证的环境绑定、产物哈希、逐项读数与未覆盖项。"
kind: "package-reference"
---

# 行为验证记录

本页回答一个问题：**每个结论各自被什么证据支持、怎么复现。**
**没跑过的结论不写成本页的结论**；失败、未覆盖与受阻项如实保留。
读数必须绑定产物哈希：重建 `lib/` 之后旧读数不再是结论。

生成：`node tools/testing/record.mjs dsh-drawioedit --title "<行为>" [--run <证据 json>] [--instance <test-instance.json>]`

## 1、发版 1.3.0：.drawio 优先用图表编辑器打开与 UI 规范收敛（2026-11-03，产物 `16A3398E` / `96AE41AB`）

### 环境与产物绑定

| 项 | 值 |
|---|---|
| 日期 | 2026-11-03T22:20:07+08:00 |
| 插件 | @guowenzhang/dsh-drawioedit@1.3.0（HEAD f7e9f4d，工作树 2 项未提交） |
| 宿主 | （未绑定隔离实例；如为源码内验证请写明） |
| DSH_HOME | （未绑定） |
| 端口 / URL | （未绑定） |
| Node | v24.12.0 |
| lib/index.mjs | `16a3398e17e95e60e975c3a318894dccc6ab9c93418b4924084d1c13735b1279`（35372 字节，2026-11-03T14:19:18.780Z） |
| lib/client.js | `96ae41ab9e706ca5c4ec6e139070624e99ecb61de183b87681f47ca728660f17`（35263 字节，2026-11-03T14:19:18.872Z） |
| 证据文件 | `.scratch/test-system/runs/2026-11-03-221951-dsh-drawioedit.json` |

### 车道结果

| 车道 | 状态 | 退出码 | 耗时 |
|---|---|---|---|
| typecheck | passed | 0 | 1.1s |
| build | passed | 0 | 0.7s |
| metadata | passed | 0 | 0.4s |
| unit | passed | 0 | 33.2s |
| artifact | passed | 0 | 33.4s |

### 逐项读数

- `npm run typecheck`：`tsc --noEmit -p tsconfig.json`，退出码 0（1.1s）。
- `npm run build`：tsdown（host）+ `build-client.mjs` + `build-stencils.mjs`，退出码 0；产物 `lib/index.mjs` 35372 字节、`lib/client.js` 35263 字节，SHA256 见上表。重建后 `git status` 无 `lib/` 改动，仓库里已提交的产物与当前工具链重建结果一致。
- `npm test`（unit 与 artifact 两条车道各跑一次，结果一致）：11 个 node 套件全部以 `OK:` 收尾、共 202 条 `ok` 读数、0 失败（每条约 33s，含真实 headless Chrome）。
- 产物与资源套件读数：两个已提交 bundle 都不早于源码；stencil XML / 打包副本 / 调色板预览一致；81 个索引核心模板与生产 import 齐备；`editor/mxgraph/css/common.css` 等编辑器资源全部存在。
- 端到端读数（headless Chrome，仓库自带宿主页）：标签页注册与 `readBytes` 读图通过；编辑器路由端到端通过；保存端点对畸形请求与版本冲突的守卫通过；重命名保留内容并拒绝碰撞、陈旧版本、越界路径；shim 注入位置与交付正确；编辑器在 pane 内启动并报告所持图表。
- `offline` 套件：编辑器启动全程未访问任何远程主机（云集成已关闭）。
- `npm pack --dry-run`：779 个文件，压缩 12116382 字节（约 12.1 MB）、解包 44781515 字节（42.7 MiB），与 README 的双语数字一致；包内不含密钥或本地数据。

### 本节未覆盖

- 未在隔离 Harness 实例里装载 1.3.0 做真实点击验收（打开 `.drawio`、在图表编辑器与源码视图间切换、改动写回）；本节浏览器证据来自仓库自带的 headless Chrome `boot` / `offline` 套件。
- 未采集手机断点（320–430px）、深浅色主题与 `prefers-reduced-motion` 的像素/性能读数。
- `prepublishOnly` 只跑 `artifact`、`stencils`、`editor-assets`、`smoke`；本次发布前的完整套件以这里记录的 `npm test` 为准，已跑。

---
