# 接力状态

仓库：[kongshan4219/hermes-desktop-portable](https://github.com/kongshan4219/hermes-desktop-portable)

开发分支：`portable/bootstrap-windows-ci`。草稿 [PR #1](https://github.com/kongshan4219/hermes-desktop-portable/pull/1)。默认 main 未合并，未公开发布。以 PR 当前 head 为最新源码 SHA；每个产物记录自身完整 SHA，不能用旧 run 代表当前 head。

最新完整记录为源码 `72011e6ef4d4b4dedf02ac426819443a332a66a2`，[run 35989414777](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35989414777)：Windows 类型/lint/精选回归/打包/最终 ZIP smoke、Linux 完整套件和独立机器凭据恢复均通过。本地 runtime 在 repository 阶段失败：Git checkout 深层文档路径超过 MAX_PATH；ZIP fallback 又把成功 git init 的 stderr 提示当成异常。当前补丁只对 Portable 私有 Git 配置启用 core.longpaths，并以 native exit code 判断 git init。尚未执行到真实 backend、远程联调与 venv 重建，仍需下一轮验证。

前一轮 `3ae28576...` 的 PR 合成 ref `1/merge` install-stamp 问题已修复：构建子进程显式写入真实源码 SHA/branch，打包检查 commit/branch/dirty；修复模式同样固定到审核 SHA。72011e6 的打包断言已通过。

先前修复与已观察证据：

- Linux 完整 Electron 套件 2388 passed / 2 skipped；Windows 精选 136 passed / 1 skipped。
- `a8409665...` / `f71350b9...` 已用真实 exe 验证私有 Electron 路径、Unicode、子进程、外部环境覆盖、缩减 PATH 和随包 SSH 配置解析。
- Windows cmd 子进程输出改为 /u + UTF-16LE；PortableGit 使 Expand-Archive 超时后，改用系统 ZIP API；updater IPC 返回结构化拒绝，测试按该真实契约断言。
- 发现并修复 Portable 拒绝上游“未保存测试令牌”明文内存对象的问题：现在只在内存中经现有安全接口加密，不写配置。加入新输入令牌必须到达 HTTP mock 的回归。
- 跨机器凭据恢复已通过；完整本地/远程联调尚未通过，不把脚本已接入当成验收成功。

最近通过 Desktop smoke / 跨机器凭据、但本地 bootstrap 未通过的 ZIP：`Hermes-0.17.6-portable.1-win-x64.zip`，来源 `72011e6ef4d4b4dedf02ac426819443a332a66a2`，SHA256 `0802dbd5511fddcc497f6a5f9f1948edfadb9d1cca6b75d72612423d58912624`，[artifact 10803966450](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35989414777/artifacts/10803966450)。仅候选，保留 7 天。此处哈希是内层实际 ZIP，不是 GitHub artifact 外层归档哈希。

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
