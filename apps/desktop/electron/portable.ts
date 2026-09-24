import fs from 'node:fs'
import path from 'node:path'

import type { App } from 'electron'

export interface PortablePaths {
  root: string
  data: string
  desktop: string
  hermes: string
  home: string
  cache: string
  logs: string
  crash: string
  ssh: string
}

let active: PortablePaths | null = null

export function portablePaths(): PortablePaths | null {
  return active
}

// Only a flag beside the actual executable enables this mode. Environment
// variables and the current working directory are deliberately not inputs.
export function detectPortable(executable: string): PortablePaths | null {
  const root = path.dirname(fs.realpathSync(executable))
  const flag = path.join(root, 'portable.flag')

  if (!fs.existsSync(flag)) {
    return null
  }

  if (!fs.lstatSync(flag).isFile()) {
    throw new Error('portable.flag must be a regular file beside Hermes.exe.')
  }

  const data = path.join(root, 'data')
  const home = path.join(data, 'home')

  return {
    root,
    data,
    home,
    desktop: path.join(data, 'desktop'),
    hermes: path.join(data, 'hermes'),
    cache: path.join(data, 'cache'),
    logs: path.join(data, 'logs'),
    crash: path.join(data, 'crash'),
    ssh: path.join(home, '.ssh')
  }
}

function writableDirectory(dir: string) {
  fs.mkdirSync(dir, { recursive: true })

  // A redirected managed directory defeats containment. Fail before main.ts
  // imports any modules that can read credentials or initialize a session.
  if (fs.realpathSync(dir).toLowerCase() !== path.resolve(dir).toLowerCase()) {
    throw new Error(`Portable managed directory must not be a link: ${dir}`)
  }

  const probe = path.join(dir, `.portable-write-${process.pid}`)
  const fd = fs.openSync(probe, 'wx')

  fs.closeSync(fd)
  fs.unlinkSync(probe)
}

export function preparePortableRuntime(p: PortablePaths) {
  const marker = path.join(p.data, 'portable-location.json')
  let previous: string | undefined

  if (fs.existsSync(marker)) {
    previous = JSON.parse(fs.readFileSync(marker, 'utf8')).root
  }

  if (previous && path.resolve(previous).toLowerCase() !== p.root.toLowerCase()) {
    const runtime = path.join(p.hermes, 'hermes-agent')
    const environments = [
      [path.join(runtime, 'venv'), 'venv'],
      [path.join(p.hermes, 'uv-tools', 'browser-use'), 'browser-use-env'],
      [path.join(p.hermes, 'bin', 'browser-use.exe'), 'browser-use.exe']
    ]

    if (environments.some(([source]) => fs.existsSync(source))) {
      // venv and uv-tool launchers contain absolute paths. Never edit
      // arbitrary user files or pretend the old interpreter is relocatable.
      const backup = path.join(p.cache, `runtime-before-move-${Date.now()}`)

      fs.mkdirSync(backup)
      for (const [source, name] of environments) {
        if (fs.existsSync(source)) {
          fs.renameSync(source, path.join(backup, name))
        }
      }

      const complete = path.join(runtime, '.hermes-bootstrap-complete')

      if (fs.existsSync(complete)) {
        fs.renameSync(complete, path.join(backup, '.hermes-bootstrap-complete'))
      }
    }
  }

  fs.writeFileSync(marker, JSON.stringify({ schemaVersion: 1, root: p.root }))
}

export function initializePortable(app: App): PortablePaths | null {
  if (process.platform !== 'win32') {
    return null
  }

  const p = detectPortable(app.getPath('exe'))

  if (!p) {
    return null
  }

  for (const dir of [p.data, p.desktop, p.hermes, p.home, p.cache, p.logs, p.crash, p.ssh]) {
    writableDirectory(dir)
  }

  const local = path.join(p.home, 'AppData', 'Local')
  const roaming = path.join(p.home, 'AppData', 'Roaming')
  const temp = path.join(p.cache, 'temp')

  for (const dir of [local, roaming, temp]) {
    writableDirectory(dir)
  }

  // Native file dialogs can resolve these under the redirected USERPROFILE.
  // Create them before redirecting it, and override Electron's cached paths too.
  const userFolders = {
    desktop: 'Desktop',
    documents: 'Documents',
    downloads: 'Downloads',
    pictures: 'Pictures',
    music: 'Music',
    videos: 'Videos'
  } as const

  for (const name of Object.keys(userFolders) as (keyof typeof userFolders)[]) {
    const dir = path.join(p.home, userFolders[name])

    writableDirectory(dir)
    app.setPath(name, dir)
  }

  // Preserve OS process plumbing, not the launching shell's credentials,
  // Python environment, Git configuration, or another Hermes installation.
  // This changes only this process and its children; never Windows settings.
  const keep = /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|PATHEXT|OS|PROCESSOR_.*|NUMBER_OF_PROCESSORS|PROGRAMFILES(?:\(X86\))?|PROGRAMW6432|COMMONPROGRAMFILES(?:\(X86\))?|COMMONPROGRAMW6432|PROGRAMDATA|ALLUSERSPROFILE|USERNAME|USERDOMAIN|USERDOMAIN_ROAMINGPROFILE|COMPUTERNAME|SESSIONNAME|HERMES_DESKTOP_BOOT_FAKE|HERMES_DESKTOP_BOOT_FAKE_STEP_MS|HERMES_DESKTOP_SKIP_QUIT_CONFIRM)$/i

  for (const key of Object.keys(process.env)) {
    if (!keep.test(key)) {
      delete process.env[key]
    }
  }

  const windows = process.env.SystemRoot || 'C:\\Windows'

  const managedPath = [
    path.join(p.hermes, 'node'),
    path.join(p.hermes, 'bin'),
    path.join(p.hermes, 'npm'),
    path.join(p.hermes, 'cua', 'bin'),
    path.join(p.hermes, 'git', 'cmd'),
    path.join(p.hermes, 'git', 'bin'),
    path.join(p.root, 'resources', 'portable', 'git', 'cmd'),
    path.join(p.root, 'resources', 'portable', 'git', 'usr', 'bin'),
    path.join(windows, 'System32'),
    path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.join(windows, 'System32', 'OpenSSH'),
    windows
  ]

  Object.assign(process.env, {
    HOME: p.home,
    USERPROFILE: p.home,
    HOMEDRIVE: path.parse(p.home).root.replace(/[\\/]$/, ''),
    HOMEPATH: p.home.slice(path.parse(p.home).root.length - 1),
    APPDATA: roaming,
    LOCALAPPDATA: local,
    TEMP: temp,
    TMP: temp,
    PATH: managedPath.join(path.delimiter),
    HERMES_HOME: p.hermes,
    HERMES_GIT_BASH_PATH: path.join(p.root, 'resources', 'portable', 'git', 'bin', 'bash.exe'),
    HERMES_CUA_DRIVER_CMD: path.join(p.hermes, 'cua', 'bin', 'cua-driver.exe'),
    HERMES_DESKTOP_USER_DATA_DIR: p.desktop,
    HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_ISOLATED_BACKEND: '1',
    HERMES_DESKTOP_PORTABLE: '1',
    XDG_CONFIG_HOME: path.join(p.home, '.config'),
    XDG_DATA_HOME: path.join(p.home, '.local', 'share'),
    XDG_CACHE_HOME: p.cache,
    CODEX_HOME: path.join(p.home, '.codex'),
    UV_CACHE_DIR: path.join(p.cache, 'uv'),
    UV_TOOL_DIR: path.join(p.hermes, 'uv-tools'),
    UV_TOOL_BIN_DIR: path.join(p.hermes, 'bin'),
    UV_NO_MODIFY_PATH: '1',
    UV_MANAGED_PYTHON: '1',
    UV_NO_CONFIG: '1',
    UV_PYTHON_INSTALL_DIR: path.join(p.hermes, 'hermes-agent', '.hermes-runtime', 'python'),
    UV_PYTHON_INSTALL_BIN: '0',
    UV_PYTHON_INSTALL_REGISTRY: '0',
    PIP_CACHE_DIR: path.join(p.cache, 'pip'),
    NPM_CONFIG_CACHE: path.join(p.cache, 'npm'),
    NPM_CONFIG_USERCONFIG: path.join(p.home, '.npmrc'),
    NPM_CONFIG_PREFIX: path.join(p.hermes, 'npm'),
    PLAYWRIGHT_BROWSERS_PATH: path.join(p.cache, 'browsers'),
    HF_HOME: path.join(p.cache, 'huggingface'),
    TORCH_HOME: path.join(p.cache, 'torch'),
    CUA_DRIVER_RS_HOME: path.join(p.hermes, 'cua', 'home'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(p.home, '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0'
  })

  app.setPath('home', p.home)
  app.setPath('appData', roaming)
  app.setPath('userData', p.desktop)
  app.setPath('sessionData', p.desktop)
  app.setPath('temp', temp)
  app.setPath('crashDumps', p.crash)
  app.setAppLogsPath(p.logs)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(p.cache, 'chromium'))

  const config = path.join(p.ssh, 'config')

  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, '# Portable SSH configuration. No host profile is imported.\n', { flag: 'wx' })
  }

  preparePortableRuntime(p)
  active = p
  fs.writeFileSync(
    path.join(p.data, 'portable-diagnostics.json'),
    JSON.stringify({ enabled: true, executable: app.getPath('exe'), ...p, version: app.getVersion() }, null, 2)
  )

  return p
}

export function portableSshOptions(): string[] {
  if (!active) {
    return []
  }

  const knownHosts = path.join(active.ssh, 'known_hosts').replaceAll('\\', '/')

  return [
    '-F', path.join(active.ssh, 'config'),
    '-o', `UserKnownHostsFile="${knownHosts}"`,
    '-o', 'GlobalKnownHostsFile=none',
    '-o', 'IdentityAgent=none',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityFile=none'
  ]
}

export function portableSshBinary(): string | null {
  return active ? path.join(active.root, 'resources', 'portable', 'git', 'usr', 'bin', 'ssh.exe') : null
}
