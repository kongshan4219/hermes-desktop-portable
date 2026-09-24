# Hermes Desktop Portable（社区候选构建）

状态：开发及验收中，尚未批准发布。保留官方 Electron Desktop UI；这不是 Nous Research 官方签名发行版。

上游基线是 `NousResearch/hermes-agent` 的 `be59f0411e8fffa1e6f48425f7885c5c6badb705`，Desktop 版本 `0.17.6`。这是经审计的 main 快照，不冒充稳定 Release。Agent 的版本号与 Desktop 不同。机器记录在 [upstream.json](upstream.json)。

完整解压候选 ZIP，然后双击 `Hermes.exe`。同目录的 `portable.flag` 启用 Portable；不要只复制 exe。无 flag 时仍执行上游默认路径与凭据策略。不要通过删除 flag 升级便携版，否则会切换至另一套数据位置。

| 目录 | 用途 |
| --- | --- |
| `data/desktop` | Desktop JSON 配置、窗口状态、Chromium cookies/localStorage/IndexedDB、持久 session partitions |
| `data/hermes` | 本地 Agent 配置、会话、日志、checkout、Python/venv、Git/Node/uv 等受管运行时 |
| `data/home` | 应用及子进程的私有 HOME、AppData、Codex 配置、`.ssh/config` 和 known_hosts |
| `data/cache` | Chromium、uv/pip/npm、浏览器和模型缓存、临时文件、迁移前 venv 备份 |
| `data/logs`、`data/crash` | Electron 日志与 crash dumps；部分上游日志保留在 `data/hermes/logs` |
| `data/portable-diagnostics.json` | 启用状态、exe 与数据实际路径、Desktop 版本，不包含令牌 |
| `portable-build.json` | 固定上游和 fork SHA、revision、架构、构建环境及 Actions run |

Portable 优先于外部 `HERMES_HOME`、Desktop profile、Python/Codex/缓存环境变量；不会自动导入本机 Hermes、Codex 或 SSH 凭据。初始化只改变当前应用及其子进程的环境，不修改 Windows 用户/系统环境。不可写或被链接重定向的受管顶层目录会报错停止，没有 AppData 回退。

用户明确选择的外部文件、项目目录、SSH 私钥仍由用户管理；其绝对路径不保证随便携目录迁移。服务器上的数据仍留在服务器。

## 依赖边界

ZIP 包含官方 Electron、渲染器及原生 Desktop 模块，不包含预装 Python Agent、模型或个人数据。直接 URL 远程模式不需要开发工具链。SSH/Git/Bash 随包提供未修改的官方 PortableGit 2.55.0.5，下载 URL 与 SHA256 固定并记录在 metadata，不依赖系统安装的开发工具。该新增供应方式仍须匹配本次 CI 验收。不会关闭 TLS 或 SSH 主机密钥校验。

首次使用本地模式会下载受管 Python、Node、uv、Browser Use、Cua 及依赖；Git 已随 ZIP 提供。Cua 0.28.2 使用固定 SHA256 的官方 ZIP 私有解压，不运行其全局安装脚本，不注册开机任务或修改用户 PATH。安装器随 ZIP 固定，checkout 固定到构建的 fork SHA，避免用 fork SHA 向官方仓库下载不存在的脚本。可选 ripgrep/ffmpeg 不通过 winget/choco/scoop 装入系统；独立便携依赖供应及相关能力仍待完成。便携、离线、全部依赖随包是三项不同目标。

移动整个目录后，旧 Python venv 与 Browser Use 的 uv 环境/启动器会保留在 `data/cache/runtime-before-move-*`，完成标记会失效，启动本地模式需要重新构建 venv。配置、会话和 checkout 不因此删除；重建可能需要联网。Desktop 的同机跨盘移动已通过；完整本地重建仍待验证。真实 bootstrap 已完成；长安装可能超过上游界面 45 秒连接等待，需要完成后点击一次 Retry。最近一次安装中 TUI 与私有 Cua 已成功，浏览器 npm 仍超时；不能据此宣称所有本地工具或搬迁已可用。

## 凭据与迁移

Portable 强制以 Electron safeStorage/Windows DPAPI 保存 Desktop gateway/OAuth 令牌，不接受明文降级。换用户/机器后可能无法解密，连接配置保留，需重新认证。浏览器 cookie 也受 Windows 加密限制。不要假设复制目录就保留登录。

本地 Agent 的原有凭据格式保持不变，例如 `.env` 可能包含明文 API key；Portable 只改变归档位置，不声称把整个 data 加密。应保护 data 及备份。独立 Windows 机器已实测旧令牌不可解密、配置保留和安全重新认证；同机另一 Windows 用户及跨机器 cookie 未验证，详见 [TESTING.md](TESTING.md)。

## 升级与回退

1. 关闭所有该目录中的 Hermes 进程。
2. 备份整个 `data`。
3. 将新 ZIP 解压到新目录，核对 SHA256。
4. 将旧 `data` 复制到新目录，保留新包的程序文件和 flag。
5. 启动验证；本地运行时可能重建。

Portable 禁止程序原地覆盖更新，避免被安装版或无补丁上游二进制替换。上游当前将本地 Agent 和 Desktop 更新耦合，这个入口一并拒绝；远程服务器更新仍是用户主动操作。本项目测试不连接或更新真实服务器。卸载便携版采用关闭应用后删除目录的方式，保留所需 data 备份。

若新版本迁移了数据格式，旧版本不一定可读。回退应恢复升级前备份，而不是用旧程序直接读取已迁移数据。

保留上游 MIT 许可证、Electron/Chromium 声明，以及 PortableGit 的 GPL 和随附第三方许可证。PortableGit 原始源码：https://github.com/git-for-windows/git/tree/v2.55.0.windows.5 。当前未使用代码签名证书。候选 artifact 不是正式 Release；完整状态以匹配 SHA 的 CI 报告为准。
