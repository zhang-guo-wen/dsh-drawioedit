# dsh-drawioedit

[English](README.md) | 中文

## 背景：DeepSeek Harness

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness，几乎所有能力都是 [Cordis](https://github.com/cordiverse/cordis) 插件。它处于 **developer preview** 阶段、迭代很快，会有破坏性变更（[文档站](https://deepseek-harness.github.io/deepseek-harness/)，`0.1.7-alpha.*`）；本插件是独立第三方包，`@deepseek-ai/*` 运行时从宿主解析。

## 这个插件解决什么问题

`.drawio` 图表原本没法在 DSH 里编辑；本插件在侧栏里用上游 draw.io 编辑器打开它，并把每次改动写回同一个文件。

## 截图

![上游 draw.io 编辑器打开一个 .drawio 文件](docs/example.png)

这张截图是标签页里的随包编辑器：标题栏显示 `example.drawio` 与一次写入之后的 `All changes saved`；左侧是 draw.io 自己的形状面板，画布上是文件里的那张图。

## 安装

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-drawioedit
```

来自 npm 官方源：<https://www.npmjs.com/package/@guowenzhang/dsh-drawioedit>。装完重启宿主；本地目录开发安装、git 源与排查见 [AGENTS.md](AGENTS.md)。

## 用法

### 在标签页里打开图表

在文件树里点开 `.drawio` 文件，就会打开一个运行完整上游 draw.io 编辑器的侧栏标签页，并用文件名标注，而不是显示 "Untitled Diagram"。标签页里是 draw.io 自己的菜单、工具栏与形状面板；文件从会话工作区读出，在你改动之前不会写入任何内容。

### 边改边存

每次改动都写回标签页打开的那个文件：

| 编辑器里的动作 | 会发生什么 |
|---|---|
| 任意改动 | 一秒内写回，不弹任何对话框 |
| **Ctrl+S** | 立即写回 |
| 工具栏 **Save** 按钮 | 立即写回 |
| **File → Save** 与 **File → Save As** | 写回同一个文件 |
| 编辑器自己那条 "Unsaved changes. Click here to save." 提示 | 立即写回 |

**Export as** 依然会下载一份副本——副本本来就该这么出去。只有 host 确认之后才算保存成功，也正是在那时 drawio 的提示变成 "All changes saved"；若写入被拒——比如标签页打开期间 agent 改过同一个文件——标签页会在编辑器上方给出原因，而不是让它假装成功。

### 认准你在编辑哪个文件

图表以标签页打开的那个文件命名，所以 draw.io 的标题栏显示的是 `example.drawio`，而不是 "Untitled Diagram"。标签页只对应一个文件，因此 **Save As** 写回的仍是这个文件，而不是新建一个；要拿出工作区就用 `Export as`。

## 注意事项

- **这个包约 119 MB**，而只读的 [dsh-drawio](https://github.com/zhang-guo-wen/dsh-drawio) 约 1 MB：下载里带着整个随包编辑器。
- **它依赖 draw.io 的内部实现。** 编辑器由一段注入其页面的小脚本驱动，脚本钩住编辑器类，以及所有保存命令唯一汇入的那个方法；draw.io 升级若改了这两者的名字，编辑就会坏，直到本插件跟上。逐字段的机制见 [AGENTS.md](AGENTS.md)。

## 许可

Apache-2.0。内嵌编辑器为 Apache-2.0，其图标集与 stencil 库附带额外条款；详见 [NOTICE](NOTICE)。

与 draw.io Ltd 无从属或背书关系。"draw.io" 是 draw.io Ltd 的注册商标。本包内嵌其 Apache-2.0 许可的编辑器。

## 延伸阅读

- [AGENTS.md](AGENTS.md) —— 安装变体、构建、iframe 协议、随包编辑器、测试套件与排查。
- [dsh-drawio](https://github.com/zhang-guo-wen/dsh-drawio) —— 姊妹预览插件：只读、maxGraph，约 1 MB 而不是 119 MB。
- [docs/example.drawio](docs/example.drawio) —— 截图里的那张图，想试着编辑的话可以直接用。
- [DeepSeek Harness 文档](https://deepseek-harness.github.io/deepseek-harness/)。
