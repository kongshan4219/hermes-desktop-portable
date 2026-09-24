// Runs the actual executable from copies of the final ZIP. No product sandbox,
// TLS or SSH verification flags are disabled. The upstream fake boot is only
// used to isolate Desktop persistence from downloading a local Agent.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

assert.equal(process.platform, 'win32', 'This integration test requires native Windows')
const out = path.resolve(process.argv[2] || 'portable-out')
const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'))
const zip = path.join(out, pkg.file)
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')
assert.equal(digest(), pkg.sha256)
const report = { source: pkg.source, zipSha256: pkg.sha256, checks: [], limitations: [
  'Fake boot does not validate local Agent installation or runtime rebuild.',
  'HTTP credential mock does not validate real model providers, SSH, chat/tools/images or a real remote server.',
  'Cross-machine and cross-user credential recovery require the separate Windows job.'
] }
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-portable-'))
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
let current
let installed
const mark = name => { report.checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`) }
const checked = name => report.checks.some(c => c.name === name)

function extract(name) {
  const dest = path.join(scratch, name)
  execFileSync(shell, ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:PORTABLE_TEST_ZIP -DestinationPath $env:PORTABLE_TEST_DEST'], {
    env: { ...process.env, PORTABLE_TEST_ZIP: zip, PORTABLE_TEST_DEST: dest }, timeout: 120000
  })
  return fs.realpathSync(path.join(dest, 'Hermes-Portable'))
}
function snapshot(dir) {
  const result = {}
  function walk(p) {
    if (!fs.existsSync(p)) return
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name)
      if (e.isDirectory()) walk(q)
      else if (e.isFile()) result[path.relative(dir, q)] = crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')
    }
  }
  walk(dir)
  return result
}
const hostPaths = [
  path.join(os.homedir(), '.hermes'), path.join(os.homedir(), '.codex'), path.join(os.homedir(), '.ssh'),
  path.join(process.env.APPDATA, 'Hermes'), path.join(process.env.LOCALAPPDATA, 'hermes')
]
const before = hostPaths.map(snapshot)

async function launch(root, extra = {}) {
  const app = await electron.launch({
    executablePath: path.join(root, 'Hermes.exe'),
    cwd: scratch,
    args: ['--disable-gpu'],
    timeout: 60000,
    env: {
      ...process.env,
      HERMES_DESKTOP_BOOT_FAKE: '1', HERMES_DESKTOP_BOOT_FAKE_STEP_MS: '20', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
      HERMES_HOME: path.join(scratch, 'forbidden-hermes'),
      HERMES_DESKTOP_USER_DATA_DIR: path.join(scratch, 'forbidden-desktop'),
      OPENAI_API_KEY: 'portable-test-must-not-inherit',
      ...extra
    }
  })
  const page = await app.firstWindow({ timeout: 60000 })
  await page.waitForFunction(() => Boolean(window.hermesDesktop?.saveConnectionConfig), { timeout: 60000 })
  return { app, page }
}
async function inspect(app) {
  return app.evaluate(({ app, session, safeStorage }) => {
    const child = process.getBuiltinModule('child_process').execFileSync(process.env.ComSpec, ['/d', '/c', 'set'], { encoding: 'utf8' })
    return {
      paths: Object.fromEntries(['home', 'userData', 'sessionData', 'temp', 'logs', 'crashDumps'].map(k => [k, app.getPath(k)])),
      storage: session.defaultSession.getStoragePath(),
      available: safeStorage.isEncryptionAvailable(),
      sandboxDisabled: app.commandLine.hasSwitch('no-sandbox'),
      partition: session.fromPartition('persist:portable-ci').getStoragePath(),
      childHomeCorrect: child.includes(`HERMES_HOME=${process.env.HERMES_HOME}`),
      inheritedCredential: child.includes('portable-test-must-not-inherit'),
      hermes: process.env.HERMES_HOME,
      path: process.env.PATH
    }
  })
}
async function stop(pair) {
  if (!pair) return
  await pair.app.evaluate(async ({ session }) => {
    await session.defaultSession.cookies.flushStore()
    session.defaultSession.flushStorageData()
  })
  await pair.app.close()
}
const token = 'portable-ci-synthetic-Zq7Z4hV9nX2pL8sK3tB6wR1yM5jD0fG'
const received = []
const server = http.createServer((req, res) => {
  if (req.headers['x-hermes-session-token']) received.push(req.headers['x-hermes-session-token'])
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, auth_required: false, version: '0.0.0-portable-mock' }))
})
server.on('upgrade', (_req, socket) => socket.destroy())
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const remoteUrl = `http://127.0.0.1:${server.address().port}`

try {
  const root = extract('中文 日本 (first)')
  assert.equal(fs.existsSync(path.join(root, 'data')), false)
  current = await launch(root)
  const info = await inspect(current.app)
  for (const value of [...Object.values(info.paths), info.storage, info.hermes, info.partition]) {
    assert.ok(value.toLowerCase().startsWith(path.join(root, 'data').toLowerCase() + path.sep), value)
  }
  assert.ok(info.available)
  assert.equal(info.sandboxDisabled, false)
  assert.ok(info.childHomeCorrect)
  assert.equal(info.inheritedCredential, false)
  assert.equal(fs.existsSync(path.join(scratch, 'forbidden-hermes')), false)
  assert.equal(fs.existsSync(path.join(scratch, 'forbidden-desktop')), false)
  report.runtime = info
  mark('actual Electron paths, hostile environment precedence, child process, reduced PATH, Unicode path and unrelated cwd')
  assert.equal((await current.page.evaluate(() => window.hermesDesktop.getSecretStorageEncryption())).on, true)
  const refusal = await current.page.evaluate(async () => {
    try { await window.hermesDesktop.setSecretStorageEncryption(false); return '' } catch (e) { return String(e) }
  })
  assert.match(refusal, /Portable requires/)
  const saved = await current.page.evaluate(async ({ remoteUrl, token }) => window.hermesDesktop.saveConnectionConfig({
    mode: 'remote', remoteAuthMode: 'token', remoteToken: token, remoteUrl
  }), { remoteUrl, token })
  assert.equal(saved.remoteTokenSet, true)
  fs.mkdirSync(path.join(out, 'cross-machine'), { recursive: true })
  fs.copyFileSync(path.join(root, 'data', 'desktop', 'connection.json'), path.join(out, 'cross-machine', 'connection.json'))
  await current.page.evaluate(() => localStorage.setItem('portable-ci-sentinel', 'preserved'))
  await current.app.evaluate(async ({ session }) => {
    await session.defaultSession.cookies.set({ url: 'https://portable.invalid', name: 'portable', value: 'preserved', expirationDate: Date.now() / 1000 + 86400 })
  })
  const update = await current.page.evaluate(() => window.hermesDesktop.updates.check())
  assert.equal(update.reason, 'portable-manual-update')
  const applyError = await current.page.evaluate(async () => {
    try { await window.hermesDesktop.updates.apply(); return '' } catch (e) { return String(e) }
  })
  assert.match(applyError, /Portable program updates/)
  mark('real credential save, forced encryption and overwrite updater refusal')
  await current.page.screenshot({ path: path.join(out, 'portable-window.png') })

  const ordinary = extract('ordinary')
  fs.unlinkSync(path.join(ordinary, 'portable.flag'))
  const installedData = path.join(scratch, 'installed-profile')
  installed = await launch(ordinary, { HERMES_DESKTOP_USER_DATA_DIR: installedData, HERMES_HOME: path.join(scratch, 'installed-hermes') })
  assert.equal(await installed.app.evaluate(({ app }) => app.getPath('userData')), installedData)
  assert.notEqual(installed.app.process().pid, current.app.process().pid)
  assert.equal(fs.existsSync(path.join(ordinary, 'data')), false)
  assert.equal((await installed.page.evaluate(() => window.hermesDesktop.getSecretStorageEncryption())).on, false)
  await stop(installed); installed = null
  mark('flag absent preserves upstream overrides/policy and simultaneous installed/Portable instances remain separate')

  await stop(current); current = null
  const target = path.join(scratch, '移動 日本 (moved)')
  fs.renameSync(root, target)
  const moved = fs.realpathSync(target)
  current = await launch(moved)
  assert.equal(await current.page.evaluate(() => localStorage.getItem('portable-ci-sentinel')), 'preserved')
  assert.equal(await current.app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ url: 'https://portable.invalid' }))[0]?.value), 'preserved')
  received.length = 0
  await current.page.evaluate(async url => {
    try { await window.hermesDesktop.testConnectionConfig({ mode: 'remote', remoteUrl: url }) } catch { /* mock refuses WS; assert header below */ }
  }, remoteUrl)
  assert.ok(received.includes(token), 'Moved application must decrypt and send its previously saved token')
  assert.equal(fs.existsSync(root), false)
  mark('same-machine directory move preserves localStorage, cookies and usable encrypted credential')
  await stop(current); current = null

  const needle = [Buffer.from(token), Buffer.from(Buffer.from(token).toString('base64'))]
  const data = path.join(moved, 'data')
  for (const relative of Object.keys(snapshot(data))) {
    const bytes = fs.readFileSync(path.join(data, relative))
    assert.equal(needle.some(n => bytes.includes(n)), false, `Credential leaked in ${relative}`)
  }
  mark('no raw or base64 test token in managed persistent files')
  fs.writeFileSync(path.join(data, 'upgrade-sentinel.txt'), 'retain me')
  const upgrade = extract('upgrade')
  fs.cpSync(data, path.join(upgrade, 'data'), { recursive: true })
  current = await launch(upgrade)
  assert.equal(fs.readFileSync(path.join(upgrade, 'data', 'upgrade-sentinel.txt'), 'utf8'), 'retain me')
  assert.equal(await current.page.evaluate(() => localStorage.getItem('portable-ci-sentinel')), 'preserved')
  await stop(current); current = null
  mark('documented new-folder upgrade preserves existing data')

  const blocked = extract('readonly')
  fs.mkdirSync(path.join(blocked, 'data'))
  execFileSync('icacls.exe', [path.join(blocked, 'data'), '/deny', `${process.env.USERNAME}:(OI)(CI)(W)`])
  try {
    const result = await new Promise((resolve, reject) => {
      const p = spawn(path.join(blocked, 'Hermes.exe'), ['--portable-diagnostics'], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] })
      let error = ''
      const timer = setTimeout(() => { p.kill(); reject(new Error('Read-only startup hung')) }, 30000)
      p.stderr.on('data', d => { error += d })
      p.on('error', reject)
      p.on('exit', code => { clearTimeout(timer); resolve({ code, error }) })
    })
    assert.notEqual(result.code, 0)
    assert.match(result.error, /Portable initialization failed/)
  } finally {
    execFileSync('icacls.exe', [path.join(blocked, 'data'), '/remove:d', process.env.USERNAME])
  }
  mark('read-only directory fails closed before importing application state')
  for (let i = 0; i < hostPaths.length; i++) assert.deepEqual(snapshot(hostPaths[i]), before[i], `Host profile changed: ${hostPaths[i]}`)
  mark('targeted host Hermes, Codex and SSH profile snapshots unchanged')
  assert.equal(digest(), pkg.sha256)
  mark('tested ZIP unchanged and contains no test-generated data')
} catch (error) {
  await current?.page.screenshot({ path: path.join(out, 'portable-failure.png') }).catch(() => {})
  report.failure = String(error.stack || error)
  throw error
} finally {
  await stop(current).catch(() => {})
  await stop(installed).catch(() => {})
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  report.status = report.failure ? 'failed' : 'passed'
  fs.writeFileSync(path.join(out, 'smoke-report.json'), JSON.stringify(report, null, 2))
  if (checked('tested ZIP unchanged and contains no test-generated data')) fs.rmSync(scratch, { recursive: true, force: true })
}
