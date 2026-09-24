# 审计与补丁边界

审计固定提交：`NousResearch/hermes-agent@be59f0411e8fffa1e6f48425f7885c5c6badb705`。

| 结论 | 固定基线中的源码证据 | Portable 处理 |
| --- | --- | --- |
| Desktop 是 Electron，不是 Tauri | `apps/desktop/package.json`：Desktop 0.17.6，Electron 40.10.2、electron-builder 26.15.3；`pack` 调用官方 build + builder --dir | 复用官方构建；Tauri 只负责独立安装器 |
| 真入口先于 main | `scripts/bundle-electron-main.mjs` 的 mainEntry 指向 `electron/entry.ts`；entry 动态 import main | `initializePortable(app)` 在 main 初始化前执行；wslg 静态 imports 无读用户配置副作用 |
| userData override 不覆盖全部浏览器数据 | `main.ts` 的 USER_DATA_OVERRIDE 只调用 setPath userData | 同时设 appData、sessionData、temp、logs、crashDumps、Chromium cache |
| 本地运行时原本会回到系统位置 | `resolveHermesHome`：环境、Desktop override、Windows registry、LocalAppData、legacy home；ACTIVE_HERMES_ROOT/VENV_ROOT | 私有进程环境复用现有 HERMES_HOME，禁止 host backend/PATH Hermes 自动接管 |
| 多份 Desktop 配置落在 userData | `DESKTOP_CONNECTION_CONFIG_PATH`、registry、installation、window-state、active-profile 等常量 | 原功能继续使用同一解析器，重定向到 data/desktop |
| Desktop safeStorage 默认为 opt-in | `secret-storage-policy.ts`、`secretStoragePolicy`、`migrateLegacyEncryptedSecretsOnce`、`encryptDesktopSecret` | Portable 强制 on，绕过转明文迁移，阻止关闭和 allowPlainText 逃生路径；无法解密返回未登录，不删连接 |
| SSH 继承宿主配置与默认 identity | `ssh-config.ts:collectSshConfigHosts`、`ssh-connection.ts:baseSshOptions`、main 的 ssh -G 两个入口 | 私有 HOME、显式 -F/private known_hosts、无宿主 agent/default identities；保留 accept-new 和 changed-key 拒绝 |
| 更新器可能替换 Desktop | `checkUpdates`、`applyUpdates`、`handOffWindowsBootstrapRecovery` | Portable 程序覆盖更新和安装器 handoff 禁用，继续随包 bootstrap；远端流程不重写 |
| 安装器修改 Windows 用户环境 | `scripts/install.ps1` 的 Sync-EnvPath、Set-ManagedNodeFirstOnUserPath、Install-Git、Set-GitBashEnvVar、Set-PathVariable | Portable switch 只修改当前进程；取消系统包管理器 fallback |
| fork SHA 不存在于官方 raw 下载地址 | `bootstrap-runner.ts:downloadInstallScript/resolveInstallScript` 和 install stamp | Portable 优先 resources/portable/install.ps1；HTTPS clone 本 fork，然后 pin 完整 build SHA |
| venv 不能直接保证搬迁 | `scripts/install.ps1:Install-Venv`、Windows console launcher/pyvenv.cfg 包含路径 | 记录根目录；移动时备份 venv 和完成标记，让既有 bootstrap 重建 |
| Windows sandbox 修复可能递归放宽 exeDir ACL | `main.ts` 的 grantAllApplicationPackagesAcl(exeDir) 与自动 --no-sandbox fallback | Portable 禁止递归放宽含 data 的根目录和自动关闭 sandbox；失败需修复环境 |
| 默认协议注册会写宿主 registry | `registerDeepLinkProtocol` | Portable 不自动取代安装版 hermes:// 协议关联；应用内已有 URL/OAuth 流程保留 |

`portable.ts` 不依赖 Electron 实现（仅 type import），持有当前进程状态；SSH 与 bootstrap 读取这份状态，不用外部环境变量启用 Portable。安装器的 HERMES_DESKTOP_PORTABLE 是内部子进程桥接，不是面向用户的新设置。

初始化次序：解析真实 exe → 验证 flag → 创建并验证私有目录 → 清理继承配置/凭据环境 → 设置 Electron 路径 → 检查运行时移动 → import main → 上游单实例锁、sessions、窗口、backend。无 flag 提前返回，不执行 Portable 环境更改。

API/backend 版本协商保持上游代码：backend 健康、serve/dashboard 能力探测、gateway JSON-RPC 和版本不匹配错误均未绕过。未改 Agent core、provider、OAuth 协议或渲染器功能。

局限：Windows 原生 API 可按账户查询已知文件夹，不能仅凭环境变量推断所有第三方模块都遵守隔离；需由实际泄漏检测及本地运行时测试证明。data 下用户自行添加的深层链接、外部项目和外部 SSH key 不应视为自动可搬迁文件。首次 SSH 主机仍沿用上游 TOFU；遇到 changed host key 继续失败。

## 后续运行时审计

run 35990997824 的真实安装发现 Browser npm 超时和 TUI launcher 的 null exit code，Portable 分支改用自持 .NET Process handle；上游 renderer 的 45 秒连接超时保持不变，测试使用一次可见 Retry 验证普通恢复路径。

Cua 官方安装脚本（`trycua/cua/libs/cua-driver/scripts/install.ps1`，已在发布目标 commit `fc188250b4ca8549b8e61f937fdb1fb560770e86` 核对）包含用户 PATH、全局 `cua-driver-serve` 任务重注册和其他进程处理；`-NoAutoStart` 仍可能重注册既有任务，不能作为 Portable 隔离保证。Portable 不执行该脚本，只下载官方 `cua-driver-rs-v0.28.2` 的 `cua-driver-rs-0.28.2-windows-x86_64.zip`，SHA256 `3c1fcf10ff9513b94e4af78ad6a216ab62aa95b2c9a3b70dfbdba9f04e021533`，保留归档随附文件并在私有路径执行原有 runtime contract 检查。现有 `HERMES_CUA_DRIVER_CMD` 指向私有 binary。没有改写 Agent core/provider。

uv 安装的 Browser Use launcher 同样记录绝对解释器路径；移动时备份其私有环境和 exe，并让原有安装流程重新生成。用户配置、会话及其他工具目录不因该操作删除。
