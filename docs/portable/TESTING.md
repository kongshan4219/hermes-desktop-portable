# 验收与证据

只接受与目标 commit 和最终 ZIP 哈希一致的报告。测试解压 ZIP 副本，原始 ZIP 不回写。候选 artifact 即使在失败 run 中存在，也不是通过验收的发行包。

## 已发生的云端验证

| 项目 | 状态及证据 |
| --- | --- |
| 官方 Windows unpacked 构建 | 已完成：commit `2ad01fc9b36f41c8ef104ebf1f1d826a3d30ee47`，run [35980926445](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35980926445)；未做 Portable 验收 |
| 首次 Portable 类型检查 | 已通过，run [35982967643](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35982967643)；lint 两处排序失败，后续已修复 |
| 后续类型检查和 lint | 已通过，commit `ac69428123819b3f2ac0528dbc3f7e9250910f9f`，run [35983373767](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35983373767) |
| 完整 Electron 平台套件放在 Windows | 失败：2322 passed / 43 failed / 25 skipped。失败含 getuid、POSIX chmod、ControlMaster、路径格式、Windows临时目录与进程时序；不能把这些测试说成通过 |
| Portable 新增路径/搬迁单元测试 | 上述 run 中通过；仅为单元证据 |
| 完整平台套件迁至普通 Linux runner | 已通过：commit `5e159e0765acc4504e609ac7449be0a0910b429f`，run [35985127566](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35985127566)，2388 passed / 2 skipped；GUI 保持 Chromium sandbox |
| 较早 smoke 编码失败（已解决） | 上述 run 构建/打包成功；中文路径 cmd 输出按 UTF-8 解码导致失败，后续改为 /u + UTF-16LE；最新完整 smoke 已通过 |
| 随包 Git/OpenSSH 首轮 | commit `7901ea456390fbe3b772ea63bcba34991ff1ad0a`，run [35986064975](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35986064975) 构建成功；测试在 PowerShell Expand-Archive 超时，未到达应用启动。改用系统 ZIP API 后重跑 |
| 实际 exe 路径与 SSH config | commit `a840966519cf3b4e5a1f8d66b9cd4a09c8c87d25`，run [35986781900](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35986781900)：私有路径、子进程、中文路径、不同 cwd、缩减 PATH、随包 SSH 配置解析已通过。smoke 随后因测试误把 updater 的结构化拒绝当成 throw 而失败，正在修正断言 |
| 独立 Windows job 凭据失效/重新认证 | 已通过：run 35988037957，job 107597138126；以匹配 source/ZIP 的 cross-machine-report.json 为准 |

## 最新通过的打包程序检查

来源 `fabadc85ec1dc15721239577a7f91ba089c595be`，[run 35990997824](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35990997824)：Windows 构建与完整 ZIP smoke 已通过，Linux 完整套件通过。实际 ZIP SHA256：`e168dd64b52db07ca1b7fc1f813c5b0609d0db110ad6bc616eee3857c6ed6efb`。

已通过：私有 Electron/session/partition 路径、子进程环境、外部环境覆盖、中文/日文/空格/括号路径、不同 cwd、缩减 PATH、随包 SSH 私有配置解析、新输入但未保存的令牌测试、强制加密、禁止覆盖更新、无 flag 上游策略及安装版并发隔离、C→D 跨盘后的 IndexedDB/localStorage/cookies/可用加密令牌、持久文件无原文/base64 测试令牌、升级 data 哨兵、只读 ACL 明确失败、目标宿主目录快照不变、原始 ZIP 哈希不变。

独立 Windows job 的凭据恢复已通过：旧 DPAPI 令牌不可解密，原连接配置字节不变，明确要求重新认证，新令牌加密保存。本地 bootstrap 的 install stamp 和 Git 长路径问题已解决；此 run 完成真实安装并验证 checkout SHA。安装耗时约 15 分钟，renderer 的上游 45 秒连接等待已超时，UI 显示 Retry，首次聊天尚未发送。安装还记录 Browser npm 超时和 TUI null exit code，不能据“bootstrap 完成”宣称所有本地可选工具正常。当前补丁增加普通 Retry 恢复及隔离/运行时修复，尚待下一轮证据。

## 可执行测试

`scripts/portable/smoke.mjs` 在真实 Windows 上解压最终 ZIP；使用官方 fake boot 隔离本地 Agent 安装。验证 exe 实际 Electron paths、session/partition、子进程环境、外部路径变量优先级、缩减 PATH、中文/日文/空格/括号、不同 cwd、加密令牌真实保存及禁止关闭加密、禁止程序覆盖更新、无 flag 的上游行为、与独立安装 profile 同时运行、整体移动后的 cookies/localStorage/已保存令牌、升级哨兵、ACL 拒绝写入、宿主 Hermes/Codex/SSH 目录快照、ZIP 哈希不变。HTTP mock 只证实已保存令牌经过解密并上送，不宣称聊天或 WebSocket 成功。

`scripts/portable/cross-machine.mjs` 在不同 hosted Windows job 中读取第一台机器产生的**合成**令牌密文，要求连接 URL 保留、旧令牌无法使用、提示重新认证、新令牌加密保存。只传测试 fixture；它不进入发行 ZIP 或 Release 资产。

Windows 回归选择 Portable、Windows 专属、bootstrap、backend env、native-token-store、secret-storage-policy；完整 upstream Electron 平台套件仍在 Linux 运行。上游 GUI 套件中既有 skip 必须保留并单独报告，不能计入通过数。

`scripts/portable/local-runtime.mjs` 已接入真实首次 bootstrap 与迁移重建测试；`remote-runtime.mjs` 使用第二份最终 ZIP 连接前者的真实 backend 和官方 mock 模型，测试 HTTP/WS 认证、失败凭据、聊天、工具结果、图片、重连与冷启动持久化。脚本存在不表示已通过；以匹配 ZIP 的 local-runtime-report.json 为准。

## 尚未完成的关键验收

- 真实 bootstrap 流程已完成；实际聊天、完整 venv/Browser Use 重建及联网/离线边界仍未通过。
- SSH 私有配置、known_hosts、变更主机密钥拒绝的完整原生联调；随包 OpenSSH 在普通 Windows 下的完整认证与主机密钥回归。
- 同一机器的另一个 Windows 用户；跨机器 browser cookie 恢复（不能从 DPAPI token 测试推断）。
- 实际远程 gateway mock 的连接成功、认证失败、断线重连、聊天、工具状态、图片显示。
- 已完成 Desktop C→D 跨盘迁移及与无 flag 副本并发；两个 Portable 副本、本地 bootstrap registry/宿主目录/程序目录快照的后续步骤仍待 local-runtime 作业完成。
- 可选本地 rg/ffmpeg 等依赖的私有供应及能力验证。
- 正式 schedule、同步候选 SHA CI、冲突 Issue 和草稿发布链路，等待默认分支合入及权限配置。

未使用真实 Codex/搜索/生图账号，真实服务器 E2E 未执行。未验证項不能改写成通过。发布门禁保持关闭，直到必要证据补齐。

## ac217cca 的补充结果

[run 35994510437](https://github.com/kongshan4219/hermes-desktop-portable/actions/runs/35994510437) 的 Desktop ZIP smoke、平台套件和跨机器凭据继续通过；本地安装停在 Cua runtime contract。TUI native exit code 修复已验证，Browser npm 仍有超时。当前把 PS 5.1 原生 Cua 检查前移到完整打包前，保留实际 version/manifest 输出；关键断言及发布门禁未放松。
