import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

assert.equal(process.platform, 'win32')
const out = path.resolve('portable-out')
const metadata = JSON.parse(fs.readFileSync(path.join(out, 'portable-build.json'), 'utf8'))
const zip = fs.readdirSync(out).find(name => name.endsWith('.zip'))
assert.ok(zip)
const sums = fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').split(/\s+/)
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, zip))).digest('hex'), sums[0])
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-foreign-'))
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
execFileSync(shell, ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:PORTABLE_TEST_ZIP -DestinationPath $env:PORTABLE_TEST_DEST'], {
  env: { ...process.env, PORTABLE_TEST_ZIP: path.join(out, zip), PORTABLE_TEST_DEST: scratch }
})
const root = path.join(scratch, 'Hermes-Portable')
const desktop = path.join(root, 'data', 'desktop')
fs.mkdirSync(desktop, { recursive: true })
const configFile = path.join(desktop, 'connection.json')
const original = fs.readFileSync('foreign-fixture/connection.json')
fs.writeFileSync(configFile, original)
let app
const report = { source: metadata.forkCommit, zipSha256: sums[0], scope: 'independent hosted Windows machine; synthetic Desktop gateway token; browser Cookie and a second user on the same machine are not covered' }
try {
  app = await electron.launch({ executablePath: path.join(root, 'Hermes.exe'), cwd: scratch, args: ['--disable-gpu'], timeout: 60000,
    env: { ...process.env, HERMES_DESKTOP_BOOT_FAKE: '1', HERMES_DESKTOP_BOOT_FAKE_STEP_MS: '20', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.hermesDesktop?.getConnectionConfig))
  const config = await page.evaluate(() => window.hermesDesktop.getConnectionConfig())
  assert.equal(config.remoteTokenSet, false, 'A different machine must not decode this DPAPI credential')
  assert.match(config.remoteUrl, /^http:\/\/127\.0\.0\.1:/)
  assert.deepEqual(fs.readFileSync(configFile), original, 'Unreadable credential must not erase the saved connection')
  const result = await page.evaluate(async () => {
    try { await window.hermesDesktop.testConnectionConfig({ mode: 'remote' }); return '' } catch (e) { return String(e) }
  })
  assert.match(result, /token.*required|reauth|sign in/i)
  const refreshed = await page.evaluate(url => window.hermesDesktop.saveConnectionConfig({
    mode: 'remote', remoteAuthMode: 'token', remoteUrl: url, remoteToken: 'portable-other-machine-synthetic-new-login'
  }), config.remoteUrl)
  assert.equal(refreshed.remoteTokenSet, true)
  assert.equal(fs.readFileSync(configFile, 'utf8').includes('portable-other-machine-synthetic-new-login'), false)
  report.status = 'passed'
  report.checks = ['configuration preserved', 'foreign DPAPI credential unavailable', 'reauthentication required', 'new credential securely saved']
} catch (error) {
  report.status = 'failed'
  report.error = String(error.stack || error)
  throw error
} finally {
  await app?.close().catch(() => {})
  fs.writeFileSync(path.join(out, 'cross-machine-report.json'), JSON.stringify(report, null, 2))
}
