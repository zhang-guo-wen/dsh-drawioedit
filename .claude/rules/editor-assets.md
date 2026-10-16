---
paths:
  - "editor/**"
  - "build-stencils.mjs"
---

> 覆盖：随包 `editor/` 上游资源的裁剪范围、保留项与体积；何时读：改 `editor/` 或 `build-stencils.mjs`、升级 drawio webapp、排查图形库/模板缺失或打包体积时

## editor/ 的裁剪

**`editor/` 的裁剪。** 由上游 webapp 裁剪而来：去掉 `WEB-INF/`（Java jar）、`js/integrate.min.js`、service worker，以及未压缩的旧 `mxgraph/src` 源码。进一步只保留 `stencils/` 中的 `arrows.xml`、`basic.xml`、`bpmn.xml`、`flowchart.xml`，并从它们重建 `js/stencils.min.js`；专业图形的 `img/lib/` 图标与「更多图形」预览图也已移除。`js/diagramly/` 顶层、`js/diagramly/sidebar/` 和 `js/grapheditor/` 的开发版 JS 源码不随包分发，生产环境按需加载的 `vsdx`、`emf`、`graphml` 等子目录保留；`?dev=1` 不支持。云、网络模板及依赖已移除图形库的专业模板已删除，并同步清理 `templates/index.xml` 对应条目。shim 将「更多图形」及搜索限制在通用图形、流程图、ER、UML、BPMN、DFD、C4 等已保留分类。解包后约 43 MiB。已有图表若引用被移除的专业形状，可能无法正确显示。`mxgraph/css/common.css` **必须保留**：它是 `div.mxPopupMenu { position: absolute }` 唯一的声明处。
