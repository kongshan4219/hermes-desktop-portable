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
| 完整平台套件迁至普通 Linux runner | 待运行；保留完整套件，不删除失败用例 |
| 最终 ZIP 的真实 exe smoke | 待运行，以 smoke-report.json 为准 |
| 独立 Windows job 凭据失效/重新认证 | 待运行，以 cross-machine-report.json 为准 |

## 可执行测试

`scripts/portable/smoke.mjs` 在真实 Windows 上解压最终 ZIP；使用官方 fake boot 隔离本地 Agent 安装。验证 exe 实际 Electron paths、session/partition、子进程环境、外部路径变量优先级、缩减 PATH、中文/日文/空格/括号、不同 cwd、加密令牌真实保存及禁止关闭加密、禁止程序覆盖更新、无 flag 的上游行为、与独立安装 profile 同时运行、整体移动后的 cookies/localStorage/已保存令牌、升级哨兵、ACL 拒绝写入、宿主 Hermes/Codex/SSH 目录快照、ZIP 哈希不变。HTTP mock 只证实已保存令牌经过解密并上送，不宣称聊天或 WebSocket 成功。

`scripts/portable/cross-machine.mjs` 在不同 hosted Windows job 中读取第一台机器产生的**合成**令牌密文，要求连接 URL 保留、旧令牌无法使用、提示重新认证、新令牌加密保存。只传测试 fixture；它不进入发行 ZIP 或 Release 资产。

Windows 回归选择 Portable、Windows 专属、bootstrap、backend env、native-token-store、secret-storage-policy；完整 upstream Electron 平台套件仍在 Linux 运行。上游 GUI 套件中既有 skip 必须保留并单独报告，不能计入通过数。

## 尚未完成的关键验收

- 全新本地 Agent 自动 bootstrap、真实 backend 可用、搬迁后完整 venv 重建及联网/离线边界。
- SSH 私有配置、known_hosts、变更主机密钥拒绝的完整原生联调；普通 Windows 的 OpenSSH 依赖供应。
- 同一机器的另一个 Windows 用户；跨机器 browser cookie 恢复（不能从 DPAPI token 测试推断）。
- 实际远程 gateway mock 的连接成功、认证失败、断线重连、聊天、工具状态、图片显示。
- 更换盘符、多个 Portable 副本并发、用户环境 registry 前后快照、本地 bootstrap 全过程泄漏检查。
- 可选本地 rg/ffmpeg 等依赖的私有供应及能力验证。
- 正式 schedule、同步候选 SHA CI、冲突 Issue 和草稿发布链路，等待默认分支合入及权限配置。

未使用真实 Codex/搜索/生图账号，真实服务器 E2E 未执行。未验证項不能改写成通过。发布门禁保持关闭，直到必要证据补齐。
