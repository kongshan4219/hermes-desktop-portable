# 接力状态

仓库：[kongshan4219/hermes-desktop-portable](https://github.com/kongshan4219/hermes-desktop-portable)

开发分支：`portable/bootstrap-windows-ci`。草稿 [PR #1](https://github.com/kongshan4219/hermes-desktop-portable/pull/1)。默认 main 未合并，未公开发布。以 PR 当前 head 为最新源码 SHA；每个产物记录自身完整 SHA，不能用旧 run 代表当前 head。

已验证源码提交 `5e159e0765acc4504e609ac7449be0a0910b429f`：[run 35985127566](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35985127566)。Linux 完整 Electron 套件 2388 passed / 2 skipped；Windows 类型检查、lint、精选测试和打包通过，smoke 在子进程中文路径解码断言失败。下一提交修正测试编码，并增加固定 SHA256 的官方 PortableGit/OpenSSH，必须重新查询 PR head 对应运行。跨机器凭据与完整本地运行时作业尚未到达执行条件。

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
