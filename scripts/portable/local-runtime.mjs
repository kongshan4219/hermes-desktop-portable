// Real local bootstrap and relocation. No fake boot, no user credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { startMockServer, MOCK_REPLY } from '../../tests-js/scripts/mock-server.ts'

assert.equal(process.platform, 'win32')
const out = path.resolve('portable-out')
const metadata = JSON.parse(fs.readFileSync(path.join(out, 'portable-build.json'), 'utf8'))
const zipName = fs.readdirSync(out).find(n => n.endsWith('.zip'))
const zip = path.join(out, zipName)
const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex')
assert.equal(hash, fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split(/\s+/)[0])
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-real-runtime-'))
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
execFileSync(shell, ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:PORTABLE_TEST_ZIP -DestinationPath $env:PORTABLE_TEST_DEST'], {
  env: { ...process.env, PORTABLE_TEST_ZIP: zip, PORTABLE_TEST_DEST: path.join(scratch, '中文 本地 (first)') }
})
let root = fs.realpathSync(path.join(scratch, '中文 本地 (first)', 'Hermes-Portable'))
const rebuiltReply = 'Portable rebuilt runtime answered through its new interpreter.'
const mock = await startMockServer({ replyForPrompt: prompt => prompt.includes('rebuilt runtime') ? rebuiltReply : MOCK_REPLY })
let current
const report = { source: metadata.forkCommit, zipSha256: hash, checks: [], networkRequired: true }
function registry() {
  return execFileSync(shell, ['-NoProfile', '-Command', "@('Path','HERMES_HOME','HERMES_GIT_BASH_PATH') | ForEach-Object { [Environment]::GetEnvironmentVariable($_,'User') }"], { encoding: 'utf8' })
}
const registryBefore = registry()
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
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.hermesDesktop.getBootstrapState())
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
  assert.ok(completed, 'Real local bootstrap must complete within 25 minutes')
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 120000 })
  const connection = await page.evaluate(() => window.hermesDesktop.getConnection())
  assert.ok(connection)
  report.connectionKeys = Object.keys(connection) // Never record backend session tokens.
  return current
}
async function sendAndSee(pair, text, reply) {
  const composer = pair.page.locator('textarea:visible, [contenteditable="true"]:visible').first()
  await composer.fill(text, { timeout: 120000 })
  await composer.press('Enter')
  await pair.page.getByText(reply, { exact: false }).first().waitFor({ timeout: 120000 })
}
try {
  await launchAndBootstrap()
  mark('fresh local installation through actual packaged Desktop bootstrap')
  await sendAndSee(current, 'Portable local runtime verification', MOCK_REPLY)
  assert.ok(mock.receivedPrompts.length)
  mark('real local backend and provider mock render a chat response')
  assert.equal(registry(), registryBefore)
  mark('local installer leaves Windows user PATH/HERMES_HOME/Git Bash settings unchanged')
  await current.page.screenshot({ path: path.join(out, 'local-runtime-window.png') })
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
  mark('moved checkout reconstructs a working venv and preserves user configuration')
  assert.equal(registry(), registryBefore)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), hash)
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = String(error.stack || error)
  throw error
} finally {
  await current?.app.close().catch(() => {})
  await mock.close()
  fs.writeFileSync(path.join(out, 'local-runtime-report.json'), JSON.stringify(report, null, 2))
}
