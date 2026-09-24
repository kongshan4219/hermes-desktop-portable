# 接力状态

仓库：[kongshan4219/hermes-desktop-portable](https://github.com/kongshan4219/hermes-desktop-portable)

开发分支：`portable/bootstrap-windows-ci`。草稿 [PR #1](https://github.com/kongshan4219/hermes-desktop-portable/pull/1)。默认 main 未合并，未公开发布。以 PR 当前 head 为最新源码 SHA；每个产物记录自身完整 SHA，不能用旧 run 代表当前 head。

最新已完成的 run 为 [35997301234](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35997301234)，源码 `a52dc422486e4ef9b6313436f4949bb2311ab7ef`。Windows 类型/lint/精选回归/最终 ZIP smoke、Linux 完整平台套件、独立机器凭据恢复全部通过。PS 5.1 Cua 私有安装/version/manifest 检查及真实本地 bootstrap 均已通过；Windows 用户 PATH/HERMES_HOME/Git Bash 与 Cua 任务未改变。

失败点为首次聊天前的界面就绪等待。截图仍显示上游 45 秒连接等待超时的 Retry 界面；此前测试在 bootstrap 完成瞬间只检查一次错误，未等待稍后出现的错误，实际没有点击 Retry。当前改为等待“可交互界面或明确连接超时”后再执行一次正常 Retry；不改变产品超时、安全检查或错误处理。此修正待当前 head 的 CI 验证。

同时补齐 Portable 父进程的 managed-only Python 限制：各安装阶段相互独立，Browser Use 不能依赖之前 Python 阶段的环境。新增实际 Agent/Browser Use 解释器来源断言，要求都来自当前私有 checkout。该新增行为尚待当前 head CI 验证。Browser npm 仍超时；TUI null exit code 修复已实测成功。远程联调、聊天与完整搬迁重建仍未验收。

先前修复与已观察证据：

- Linux 完整 Electron 套件 2388 passed / 2 skipped；Windows 精选 136 passed / 1 skipped。
- `a8409665...` / `f71350b9...` 已用真实 exe 验证私有 Electron 路径、Unicode、子进程、外部环境覆盖、缩减 PATH 和随包 SSH 配置解析。
- Windows cmd 子进程输出改为 /u + UTF-16LE；PortableGit 使 Expand-Archive 超时后，改用系统 ZIP API；updater IPC 返回结构化拒绝，测试按该真实契约断言。
- 发现并修复 Portable 拒绝上游“未保存测试令牌”明文内存对象的问题：现在只在内存中经现有安全接口加密，不写配置。加入新输入令牌必须到达 HTTP mock 的回归。
- 跨机器凭据恢复已通过；完整本地/远程联调尚未通过，不把脚本已接入当成验收成功。

最近候选 ZIP：`Hermes-0.17.6-portable.1-win-x64.zip`，来源 `a52dc422486e4ef9b6313436f4949bb2311ab7ef`，SHA256 `aa9fc67b40ef042026d1a2ebcda8d324173f6c063daa9c6623c33073dba284d9`，[artifact 10806654306](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35997301234/artifacts/10806654306)。Desktop smoke/跨机器凭据通过，本地聊天及重建未通过；不是发行包。候选保留 7 天，哈希指内层 ZIP。该 ZIP 不含上述待验证的后续修正。

实现位置：`electron/portable.ts` 集中路径/环境/迁移；entry 早期调用；main 处理凭据、更新器、协议注册及 sandbox；ssh-connection 注入私有 SSH options；bootstrap-runner 选择随包安装器；install.ps1 约束 Portable 的进程环境；scripts/portable 负责干净 ZIP、测试、同步和草稿发布。

当前 `releaseApproved=false`。关键未验收项详见 TESTING。不要先改门禁，再补证据。

接续顺序：

1. 读取本目录和根/desktop AGENTS，查询 PR 当前 head 与对应 Portable CI。
2. 下载脱敏 evidence 或读取失败 job 日志；按实际错误修复，不删测试。若只有失败前的 candidate artifact，也不得称为可用 Portable。
3. 先让 Windows 精选回归、Linux 完整平台套件、真实 ZIP smoke 和不同机器凭据测试全部完成。
4. 完成本地 bootstrap/重建与完整远程 mock；补齐 SSH、跨盘与账户隔离。保留安装版行为，避免改 Agent core/provider。
5. 所有代码、测试和文档形成可审查 PR 后，才请求用户网页批准合并。
6. 默认分支合入后，按 MAINTENANCE 启用 Issues、机器人 PR 与定时 workflow；手动验证 sync/release。连接器本身不提供直接 workflow_dispatch/create Release；可由网页 Actions 运行已提交的流程。

GitHub 审计：该仓库是 NousResearch/hermes-agent 的 public fork；连接器可建分支、提交、草稿 PR 并触发 push/PR Actions。无需 PAT。Issues 初始为关闭。本任务没有修改仓库可见性、保护规则、预算、真实云服务器或模型账户。
