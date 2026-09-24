# 接力状态

仓库：[kongshan4219/hermes-desktop-portable](https://github.com/kongshan4219/hermes-desktop-portable)

开发分支：`portable/bootstrap-windows-ci`。草稿 [PR #1](https://github.com/kongshan4219/hermes-desktop-portable/pull/1)。默认 main 未合并，未公开发布。以 PR 当前 head 为最新源码 SHA；每个产物记录自身完整 SHA，不能用旧 run 代表当前 head。

最新已通过 Windows 最终 ZIP smoke 的源码提交 `3ae28576e6d9c78be0c5ea85e84e2cbb10ff8ca8`：[run 35988037957](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35988037957)。该 run 的 Windows 构建/打包/smoke 与 Linux 完整套件均已通过；独立机器凭据恢复也已通过；本地作业失败于 repository 阶段：官方 install stamp 使用 PR 的 `1/merge`，clone 找不到该 branch；尚未执行远程联调和重建。下一提交显式设置构建子进程的 GITHUB_SHA/ref，并在打包前校验资源内的 install-stamp.json 与源码完整 SHA 一致。前一轮 `f71350b9c11aadd0018da1d7ff019a558b20444f` 的 [run 35987397440](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35987397440)：Linux 完整套件成功，Windows 类型检查、lint、精选回归和 ZIP 构建成功；smoke 在测试误读正在使用的 Chromium 数据库时触发 EBUSY。已改为只比较目标 connection.json。

先前修复与已观察证据：

- Linux 完整 Electron 套件 2388 passed / 2 skipped；Windows 精选 136 passed / 1 skipped。
- `a8409665...` / `f71350b9...` 已用真实 exe 验证私有 Electron 路径、Unicode、子进程、外部环境覆盖、缩减 PATH 和随包 SSH 配置解析。
- Windows cmd 子进程输出改为 /u + UTF-16LE；PortableGit 使 Expand-Archive 超时后，改用系统 ZIP API；updater IPC 返回结构化拒绝，测试按该真实契约断言。
- 发现并修复 Portable 拒绝上游“未保存测试令牌”明文内存对象的问题：现在只在内存中经现有安全接口加密，不写配置。加入新输入令牌必须到达 HTTP mock 的回归。
- 跨机器凭据与完整本地/远程联调需等待 smoke 成功；不把脚本已接入当成验收成功。

最近通过 Desktop smoke / 跨机器凭据、但本地 bootstrap 未通过的 ZIP：`Hermes-0.17.6-portable.1-win-x64.zip`，来源 `3ae28576e6d9c78be0c5ea85e84e2cbb10ff8ca8`，SHA256 `f6c67aef4f15d966a0f9de195b14c9fbb7821322c6c0b135a10d7a815e616ed4`，[artifact 10803231185](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35988037957/artifacts/10803231185)。仅候选，保留 7 天。此处哈希是内层实际 ZIP，不是 GitHub artifact 外层归档哈希。

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
