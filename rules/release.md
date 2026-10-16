# rules/release.md —— 覆盖：发版步骤与安装验证；何时读：准备发版、改版本号、打 tag 或核对发布内容时

## 发版

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，默认分支上后续的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 都是最新的。
3. 提交源码与 `lib/`（不要把 `lib/` 落在外面的工作区）。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-drawioedit <version>"
   git push dsh-drawioedit main --follow-tags
   ```

5. 验证安装：`npx @deepseek-ai/dsh plugin --profile web add "git+https://github.com/zhang-guo-wen/dsh-drawioedit.git#v<version>"`，重启宿主后打开一个 `.drawio` 文件，确认编辑器进画布且一次改动被写回。

推送与发版的时间窗口、tag 与 npm 发布的三者边界遵循工作区根 `AGENTS.md` 的「推送时间规则 / 打 tag、发版与 npm 发布规则」：**未经用户明确要求不得递增版本号、不打 tag、不推送**。
