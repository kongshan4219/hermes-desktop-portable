# 云端维护

所有开发通过 GitHub 分支/PR 与托管 runner 进行，无需用户本地终端或云服务器。本任务默认分支不自动合并，不 force push，不公开发布。

## 工作流与权限

| 文件 | 用途 | 权限 |
| --- | --- | --- |
| portable-ci.yml | PR/main push/手动入口 | contents read |
| portable-build.yml | 固定 source_sha 的可复用 Windows 构建与跨机器凭据测试；完整 Electron 平台套件在普通 ubuntu-24.04 | contents read，无 secrets |
| upstream-sync.yml | 每日 03:23 UTC 或手动提出稳定上游候选，调用相同 source_sha 验证 | 提案 job contents/PR/issues write；构建 job read |
| portable-release.yml | 手动给出已合入且通过验收的完整 SHA，再构建并仅创建 draft Release | 仅 draft job contents write；运行代码来自可信默认分支 |

普通 runner 为 windows-2022 / ubuntu-24.04，没有 self-hosted、larger runner、预算调整或 PAT。所有第三方 Actions 固定 SHA。fork 的上游 CI/Nix 入口加入官方仓库 guard，避免启动专用大 runner；不把跳过结果当作 Portable 通过。

## 上游版本策略

初始基线是已审计 main 快照，`adoptedTag=null`。尚无被证实的独立 Desktop Release 通道，采用同仓库公开稳定 Release，候选 SHA 必须包含 Desktop package.json。排除 draft/prerelease；记录实际 Desktop package 版本，不将 Agent tag 的版本伪装成 Desktop 版本。

将 tag 解引用到完整 commit，再正常 merge 到候选分支。最新稳定 tag 若已是初始快照祖先，不倒退。`upstream.json` 仅在候选分支提出新的 adopted 值；只有人工合入默认分支后才成为实际已合入基线。每次同步重置发布批准。

分支名以完整上游 SHA 固定；已有 PR 不重复创建或覆盖人工提交；定时检测不每天重跑同一候选，失败后需修复 PR 或通过 workflow_dispatch 明确重试，人工 PR 更新仍触发 portable-ci；已关闭候选不自动重开。冲突不采用 ours/theirs 总覆盖，不推送冲突标记。冲突记录在带唯一 SHA 标记的 Issue，包含文件及 run。

## 首次网页设置（待人工批准）

1. 先审查并批准合入本任务草稿 PR，工作流才进入默认分支。尚未执行此步骤。
2. Settings → General → Features 启用 Issues（审计时此 fork 的 Issues 关闭）；否则冲突跟踪 Issue 会报错停止。
3. Settings → Actions → General 检查允许上述固定 Actions，启用 “Allow GitHub Actions to create and approve pull requests”。无需扩大构建 job 权限。
4. Actions → Portable upstream sync → Enable workflow（fork 的 schedule 可能默认关闭）。手动运行验证，再确认后续定时执行。
5. 建议在分支规则中要求 Portable CI 实际检查；不以被 guard 跳过的上游 All checks 作准。本任务不修改保护规则。

GitHub 的 GITHUB_TOKEN 普通 push 不递归触发 Actions。当前 PR opened/synchronize/reopened 的机器人触发可能产生需审批的 run；同步不依赖这些事件，而在同一 run 调用 reusable workflow，并核对 checkout SHA。workflow_dispatch 与 schedule 依赖默认分支上的定义。定时可能延迟或丢弃；公开仓库约 60 天无活动可被停用，使用 Actions 网页重新启用，不提交无意义活动。

官方说明：[GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)、[触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[启用/停用](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)。

## 发布门禁

`releaseApproved=false` 是当前未完成关键验收的明确门禁。完成 TESTING 中的阻塞项并审查证据后，再通过 PR 更新该值，不能为了获得绿色构建而直接改为 true。

在 Actions → Portable draft release，选择 main，填写已审查且已合入 main 的完整 40 位 SHA。工作流验证祖先关系、基线批准、测试报告、metadata 和 ZIP SHA256，使用同一个通过测试的 ZIP。draft job 不执行候选源码，不接触真实模型/服务器凭据。已有公开 Release 不修改；同名不同内容的草稿资产也不覆盖。

Release 永远由工作流创建为 draft，正式发布仍由维护者网页审查。工作流文件存在不表示 schedule、机器人 PR、冲突 Issue 或 draft 发布已实际验证；准确状态见 HANDOFF。
