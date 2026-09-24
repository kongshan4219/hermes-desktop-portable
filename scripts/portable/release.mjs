// Executed from the trusted default-branch checkout, never from the artifact.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const repository = process.env.GITHUB_REPOSITORY
const sha = process.env.APPROVED_SHA
assert.equal(repository, 'kongshan4219/hermes-desktop-portable')
assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
assert.match(sha, /^[a-f0-9]{40}$/)
const out = 'portable-out'
const metadata = JSON.parse(fs.readFileSync(path.join(out, 'portable-build.json'), 'utf8'))
assert.equal(metadata.forkCommit, sha)
const smoke = JSON.parse(fs.readFileSync('evidence/portable-out/smoke-report.json', 'utf8'))
const foreign = JSON.parse(fs.readFileSync('credential-evidence/cross-machine-report.json', 'utf8'))
for (const report of [smoke, foreign]) {
  assert.equal(report.source, sha)
  assert.equal(report.status, 'passed')
}
const sums = fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split(/\s+/)
const zipName = sums[1]
assert.match(zipName, /^Hermes-[A-Za-z0-9.+-]+-portable\.\d+-win-x64\.zip$/)
const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, zipName))).digest('hex')
assert.equal(hash, sums[0])
assert.equal(hash, smoke.zipSha256)
assert.equal(hash, foreign.zipSha256)
const tag = `desktop-${metadata.desktopVersion}-portable.${metadata.portableRevision}-${sha.slice(0, 12)}`
const token = process.env.GH_TOKEN
async function api(route, method = 'GET', body) {
  const r = await fetch(`https://api.github.com/repos/${repository}${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (!r.ok) throw new Error(`Release API ${method} ${route}: HTTP ${r.status}`)
  return r.json()
}
const releases = await api('/releases?per_page=100')
let release = releases.find(r => r.tag_name === tag)
if (release && !release.draft) throw new Error('Refusing to modify an existing public release')
const body = `Community-maintained Hermes Desktop Portable candidate; not an official signed distribution.\n\nDesktop: ${metadata.desktopVersion}; Portable revision: ${metadata.portableRevision}\nUpstream: ${metadata.upstreamRepository}@${metadata.upstreamRef} (${metadata.upstreamCommit})\nFork SHA: ${sha}\nBuild and validation: ${metadata.actionsRun}\nZIP SHA256: ${hash}\n\nData, Chromium sessions and application-managed runtime paths are scoped to data beside Hermes.exe. Portable disables program overwrite updates and requires Windows encryption for saved Desktop credentials.\n\nRuntime dependencies: Electron and native Desktop modules are included. Local Agent installation/reconstruction downloads Python, Git, Node and packages when necessary. SSH depends on the Windows OpenSSH capability. Optional ripgrep/ffmpeg are not automatically installed system-wide. See docs/portable for current coverage and limitations.\n\nMigration: same-machine persistence tests and independent-machine DPAPI failure/re-authentication tests are attached to the run. Do not assume copied credentials or browser cookies work under another Windows account or machine.\n\nUpgrade: close Hermes; back up data; extract into a new directory; copy data; launch and verify. Moving a Python venv requires reconstruction; the previous venv is retained under data/cache. Data schema migrations may prevent rollback without the backup.\n\nNo code-signing certificate was used. Preserve the included licenses. No real model account or real remote server was tested. Review docs/portable/TESTING.md before manually publishing.`
if (!release) release = await api('/releases', 'POST', { tag_name: tag, target_commitish: sha, name: `Hermes Desktop ${metadata.desktopVersion} Portable ${metadata.portableRevision}`, body, draft: true, prerelease: false })
else release = await api(`/releases/${release.id}`, 'PATCH', { body })
for (const name of [zipName, 'SHA256SUMS.txt', 'portable-build.json']) {
  const bytes = fs.readFileSync(path.join(out, name))
  const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`
  const existing = release.assets.find(a => a.name === name)
  if (existing) {
    assert.equal(existing.digest, digest, `Draft asset ${name} differs; no overwrite is allowed`)
    continue
  }
  const url = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: bytes })
  assert.ok(r.ok, `Upload ${name}: HTTP ${r.status}`)
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Draft only: ${release.html_url}\nSource: ${sha}\nZIP SHA256: ${hash}\n`)
