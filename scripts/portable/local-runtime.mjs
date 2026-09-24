// Real local bootstrap and relocation. No fake boot, no user credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { startMockServer, MOCK_REPLY } from '../../tests-js/scripts/mock-server.ts'
import { verifyRemote, waitReady } from './remote-runtime.mjs'

assert.equal(process.platform, 'win32')
const out = path.resolve('portable-out')
const metadata = JSON.parse(fs.readFileSync(path.join(out, 'portable-build.json'), 'utf8'))
const zipName = fs.readdirSync(out).find(n => n.endsWith('.zip'))
const zip = path.join(out, zipName)
const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')
assert.equal(hash, fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split(/\s+/)[0])
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-real-runtime-'))
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
execFileSync(shell, ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PORTABLE_TEST_ZIP, $env:PORTABLE_TEST_DEST)'], {
  env: { ...process.env, PORTABLE_TEST_ZIP: zip, PORTABLE_TEST_DEST: path.join(scratch, '中文 本地 (first)') }
})
let root = fs.realpathSync(path.join(scratch, '中文 本地 (first)', 'Hermes-Portable'))
const rebuiltReply = 'Portable rebuilt runtime answered through its new interpreter.'
let imageUrl = ''
const mock = await startMockServer({ replyForPrompt: prompt => {
  if (prompt.includes('rebuilt runtime')) return rebuiltReply
  if (prompt.includes('remote reconnect')) return 'Portable remote connection recovered.'
  if (prompt.includes('image result verification')) return `Portable mock image result\n\n![Portable CI image](${imageUrl})`
  return MOCK_REPLY
} })
let current
const report = { source: metadata.forkCommit, zipSha256: hash, checks: [], networkRequired: true }
function registry() {
  return execFileSync(shell, ['-NoProfile', '-Command', "@('Path','HERMES_HOME','HERMES_GIT_BASH_PATH') | ForEach-Object { [Environment]::GetEnvironmentVariable($_,'User') }"], { encoding: 'utf8' })
}
function cuaTasks() {
  return execFileSync(shell, ['-NoProfile', '-Command', "@(Get-ScheduledTask -TaskName '*cua*' -ErrorAction SilentlyContinue | Select-Object TaskName,TaskPath,Actions | Sort-Object TaskPath,TaskName) | ConvertTo-Json -Depth 5 -Compress"], { encoding: 'utf8' })
}
const registryBefore = registry()
const cuaTasksBefore = cuaTasks()
const hostPaths = [
  path.join(os.homedir(), '.hermes'), path.join(os.homedir(), '.codex'), path.join(os.homedir(), '.ssh'),
  path.join(process.env.APPDATA, 'Hermes'), path.join(process.env.LOCALAPPDATA, 'hermes'),
  path.join(process.env.LOCALAPPDATA, 'uv'), path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
  path.join(process.env.LOCALAPPDATA, 'npm-cache')
]
function snapshot(dir, programOnly = false) {
  const result = {}
  function walk(p) {
    if (!fs.existsSync(p)) return
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (programOnly && p === dir && e.name === 'data') continue
      const q = path.join(p, e.name)
      if (e.isDirectory()) walk(q)
      else if (e.isFile()) result[path.relative(dir, q)] = crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')
    }
  }
  walk(dir)
  return result
}
const hostBefore = hostPaths.map(dir => snapshot(dir))
const programBefore = snapshot(root, true)
const home = path.join(root, 'data', 'hermes')
fs.mkdirSync(home, { recursive: true })
const config = `model:\n  default: mock-model\n  provider: mock\nproviders:\n  mock:\n    api: ${mock.url}/v1\n    name: Mock\n    api_mode: chat_completions\n    key_env: MOCK_API_KEY\n    models:\n      mock-model: {}\n    context_length: 64000\nauxiliary:\n  title_generation:\n    enabled: false\n`
fs.writeFileSync(path.join(home, 'config.yaml'), config)
fs.writeFileSync(path.join(home, '.env'), 'MOCK_API_KEY=portable-ci-fake-key\n')
fs.writeFileSync(path.join(home, 'user-sentinel.txt'), 'preserve local state')
const mark = name => { report.checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`) }

async function launchAndBootstrap() {
  const env = { ...process.env, HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1' }
  delete env.HERMES_DESKTOP_BOOT_FAKE
  const app = await electron.launch({ executablePath: path.join(root, 'Hermes.exe'), cwd: scratch, args: ['--disable-gpu'], env, timeout: 60000 })
  const page = await app.firstWindow()
  current = { app, page }
  await page.waitForFunction(() => Boolean(window.hermesDesktop?.getBootstrapState))
  const deadline = Date.now() + 25 * 60000
  let selected = false
  let completed = false
  let previous = ''
  let lastState
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.hermesDesktop.getBootstrapState())
    lastState = state
    if (state.error) {
      report.failedBootstrap = state
      throw new Error(`Real bootstrap failed: ${state.error}`)
    }
    if (state.setupChoice && !selected) {
      await page.evaluate(() => window.hermesDesktop.continueBootstrapLocal())
      selected = true
    }
    const stage = Object.entries(state.stages).find(([, s]) => s.state === 'running')?.[0]
    if (stage && stage !== previous) { console.log(`Bootstrap stage: ${stage}`); previous = stage }
    if (state.completedAt) { report.lastBootstrap = state; completed = true; break }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  if (!completed) report.failedBootstrap = lastState
  assert.ok(completed, 'Real local bootstrap must complete within 25 minutes')
  const runtimeSha = await app.evaluate(() => process.getBuiltinModule('child_process').execFileSync('git', [
    '-C', process.getBuiltinModule('path').join(process.env.HERMES_HOME, 'hermes-agent'), 'rev-parse', 'HEAD'
  ], { encoding: 'utf8' }).trim())
  assert.equal(runtimeSha, metadata.forkCommit, 'Fresh and moved runtime must remain on the reviewed source commit')
  report.runtimeCommit = runtimeSha
  const interpreters = await app.evaluate(() => {
    const p = process.getBuiltinModule('path')
    const cp = process.getBuiltinModule('child_process')
    return [
      p.join(process.env.HERMES_HOME, 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
      p.join(process.env.HERMES_HOME, 'uv-tools', 'browser-use', 'Scripts', 'python.exe')
    ].map(exe => JSON.parse(cp.execFileSync(exe, ['-c', 'import json,sys; print(json.dumps(dict(executable=sys.executable,base=sys.base_prefix)))'], { encoding: 'utf8', timeout: 60000 })))
  })
  const privatePython = path.join(root, 'data', 'hermes', 'hermes-agent', '.hermes-runtime', 'python').toLowerCase() + path.sep
  for (const interpreter of interpreters) {
    assert.ok(interpreter.base.toLowerCase().startsWith(privatePython), 'Tool and Agent interpreters must use private managed Python, never runner Python')
    assert.ok(interpreter.executable.toLowerCase().startsWith(path.join(root, 'data').toLowerCase() + path.sep))
  }
  mark('Agent and Browser Use interpreters use checkout-private Python')
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 120000 })
  const connection = await page.evaluate(() => window.hermesDesktop.getConnection())
  assert.ok(connection)
  report.connectionKeys = Object.keys(connection) // Never record backend session tokens.
  // Upstream's renderer has a 45-second connection budget, while a fresh
  // installer can take minutes. Exercise its visible, bounded recovery after
  // installation; do not remove the production timeout or suppress errors.
  const connectionTimeout = page.getByText("Hermes' background service didn't answer in time.", { exact: true })
  // Bootstrap completion can precede this renderer error by 45 seconds. Wait
  // for readiness or the visible error instead of sampling it only once.
  await Promise.race([waitReady(page), connectionTimeout.waitFor({ state: 'visible', timeout: 120000 })])
  if (await connectionTimeout.isVisible()) {
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    mark('one normal Retry after the upstream renderer timed out during a long install')
  }
  return current
}
async function sendAndSee(pair, text, reply) {
  await waitReady(pair.page)
  const composer = pair.page.locator('textarea:visible, [contenteditable="true"]:visible').first()
  await composer.fill(text, { timeout: 120000 })
  await composer.press('Enter')
  await pair.page.getByText(reply, { exact: false }).first().waitFor({ timeout: 120000 })
}
try {
  await launchAndBootstrap()
  mark('fresh local installation through actual packaged Desktop bootstrap')
  assert.equal(registry(), registryBefore)
  assert.equal(cuaTasks(), cuaTasksBefore)
  mark('local installer leaves Windows user PATH/HERMES_HOME/Git Bash settings unchanged')
  await sendAndSee(current, 'Portable local runtime verification', MOCK_REPLY)
  assert.ok(mock.receivedPrompts.length)
  mark('real local backend and provider mock render a chat response')
  await current.page.screenshot({ path: path.join(out, 'local-runtime-window.png') })
  const backend = await current.page.evaluate(() => window.hermesDesktop.getConnection())
  report.checks.push(...await verifyRemote({ zip, scratch, backend, out, setImageUrl: url => { imageUrl = url }, reply: MOCK_REPLY }))
  await current.app.close(); current = null
  const preservedConfig = fs.readFileSync(path.join(root, 'data', 'hermes', 'config.yaml'), 'utf8')
  const moved = path.join(scratch, '移動 runtime (second)')
  fs.renameSync(root, moved)
  root = fs.realpathSync(moved)
  await launchAndBootstrap()
  assert.equal(fs.readFileSync(path.join(root, 'data', 'hermes', 'user-sentinel.txt'), 'utf8'), 'preserve local state')
  assert.equal(fs.readFileSync(path.join(root, 'data', 'hermes', 'config.yaml'), 'utf8'), preservedConfig)
  assert.ok(fs.readdirSync(path.join(root, 'data', 'cache')).some(n => n.startsWith('runtime-before-move-')))
  await sendAndSee(current, 'Portable rebuilt runtime verification', rebuiltReply)
  const browserHelp = await current.app.evaluate(() => process.getBuiltinModule('child_process').execFileSync(
    process.getBuiltinModule('path').join(process.env.HERMES_HOME, 'bin', 'browser-use.exe'), ['--help'],
    { encoding: 'utf8', timeout: 60000 }
  ))
  assert.match(browserHelp, /usage|commands|options/i)
  mark('moved managed browser-use launcher runs after its uv-tool environment is rebuilt')
  mark('moved checkout reconstructs a working venv and preserves user configuration')
  assert.equal(registry(), registryBefore)
  assert.equal(cuaTasks(), cuaTasksBefore)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), hash)
  for (let i = 0; i < hostPaths.length; i++) assert.deepEqual(snapshot(hostPaths[i]), hostBefore[i], `Host runtime profile changed: ${hostPaths[i]}`)
  assert.deepEqual(snapshot(root, true), programBefore, 'Managed persistence must not modify the program files outside data')
  mark('fresh and moved local runtime leave program files, targeted host profiles and caches unchanged')
  report.status = 'passed'
} catch (error) {
  await current?.page.screenshot({ path: path.join(out, 'local-runtime-failure.png') }).catch(() => {})
  report.status = 'failed'
  report.error = String(error.stack || error)
  throw error
} finally {
  await current?.app.close().catch(() => {})
  await mock.close()
  fs.writeFileSync(path.join(out, 'local-runtime-report.json'), JSON.stringify(report, null, 2))
}
