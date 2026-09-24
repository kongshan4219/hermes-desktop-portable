// Trusted default-branch automation only. Never execute upstream/candidate
// scripts in this write-token job; validation runs in a separate read-only job.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

const repository = process.env.GITHUB_REPOSITORY
assert.equal(repository, 'kongshan4219/hermes-desktop-portable')
assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
const token = process.env.GH_TOKEN
assert.ok(token)
const apiBase = 'https://api.github.com'
async function api(route, method = 'GET', body) {
  const r = await fetch(apiBase + route, { method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (!r.ok) {
    const error = new Error(`GitHub ${method} ${route}: HTTP ${r.status}`)
    error.status = r.status
    throw error
  }
  return r.status === 204 ? null : r.json()
}
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 120000 }).trim()
const baseline = JSON.parse(fs.readFileSync('docs/portable/upstream.json', 'utf8'))
const releases = await api(`/repos/${baseline.repository}/releases?per_page=100`)
const release = releases.filter(r => !r.draft && !r.prerelease).sort((a, b) => b.published_at.localeCompare(a.published_at))[0]
assert.ok(release, 'No stable upstream release found')
const tag = release.tag_name
assert.match(tag, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/)
assert.ok(!tag.includes('..') && !tag.endsWith('/') && !tag.endsWith('.lock'))
git('fetch', '--no-tags', `https://github.com/${baseline.repository}.git`, `refs/tags/${tag}`)
const upstream = git('rev-parse', 'FETCH_HEAD^{commit}')
assert.match(upstream, /^[a-f0-9]{40}$/)
const desktop = JSON.parse(git('show', `${upstream}:apps/desktop/package.json`))
const ancestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0
if (upstream === baseline.sha || ancestor(upstream, baseline.sha)) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Stable ${tag} (${upstream}) is already contained in the adopted baseline. No downgrade or sync PR.\n`)
  process.exit(0)
}
const branch = `portable/sync/${upstream}`
const marker = `<!-- portable-upstream:${upstream} -->`
const run = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
const existing = await api(`/repos/${repository}/pulls?state=all&head=${repository.split('/')[0]}:${encodeURIComponent(branch)}`)
const open = existing.find(pr => pr.state === 'open')
if (existing.some(pr => pr.state === 'closed')) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Candidate ${upstream} has a closed PR; no automatic reopening. Review that decision on GitHub.\n`)
  process.exit(0)
}
if (open) {
  // A failed candidate needs a fix or an explicit manual retry, not an
  // unbounded daily rebuild of the same source. Human PR updates already
  // trigger portable-ci; workflow_dispatch is the recovery path for a run
  // interrupted after PR creation but before validation.
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${open.head.sha}\npr_number=${open.number}\n`)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Manual revalidation of ${open.head.sha}: ${open.html_url}\n`)
  } else {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Existing candidate ${open.head.sha}: ${open.html_url}. No scheduled retry; inspect its checks, fix the PR or run this workflow manually.\n`)
  }
  process.exit(0)
}
// Recover an interrupted push-before-PR without generating a new commit or
// force-pushing the existing candidate.
let existingBranch
try { existingBranch = await api(`/repos/${repository}/git/ref/heads/${branch}`) }
catch (error) { if (error.status !== 404) throw error }
if (existingBranch) {
  const candidate = existingBranch.object.sha
  git('fetch', 'origin', `refs/heads/${branch}`)
  const recorded = JSON.parse(git('show', `${candidate}:docs/portable/upstream.json`))
  assert.equal(recorded.sha, upstream, 'Existing sync branch has different provenance')
  assert.ok(ancestor(upstream, candidate), 'Candidate must include the upstream commit')
  const pr = await api(`/repos/${repository}/pulls`, 'POST', {
    title: `Portable: sync stable ${tag}`, head: branch, base: 'main', draft: true,
    body: `${marker}\nRecovered an existing candidate after an interrupted automation run.\nUpstream ${tag}: ${upstream}\nCandidate: ${candidate}\nValidation: ${run}\nReview Desktop paths, credentials, installer and updater changes. No public release is approved.`
  })
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${candidate}\npr_number=${pr.number}\n`)
  process.exit(0)
}
git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
git('switch', '-c', branch)
const merge = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-commit', upstream], { encoding: 'utf8' })
if (merge.status !== 0) {
  const conflicts = git('diff', '--name-only', '--diff-filter=U')
  spawnSync('git', ['merge', '--abort'])
  const body = `${marker}\nStable upstream: ${tag}\nSHA: ${upstream}\nRun: ${run}\n\nMerge stopped. No candidate was pushed.\n\nConflicting files:\n\n\`\`\`text\n${conflicts || '(merge failed before a conflict list was available)'}\n\`\`\`\n\nResolve on a new branch without an ours/theirs blanket replacement, then run Portable CI for that exact commit.`
  const query = encodeURIComponent(`repo:${repository} is:issue ${upstream} in:body`)
  const issues = await api(`/search/issues?q=${query}&per_page=100`)
  const issue = issues.items.find(i => i.body?.includes(marker))
  if (issue) await api(`/repos/${repository}/issues/${issue.number}`, 'PATCH', { body, state: 'open' })
  else await api(`/repos/${repository}/issues`, 'POST', { title: `Portable upstream sync blocked: ${tag}`, body })
  throw new Error('Upstream merge conflict recorded in tracking issue')
}
// This becomes the adopted record only if the maintainer merges this PR.
fs.writeFileSync('docs/portable/upstream.json', JSON.stringify({ ...baseline, adoptedTag: tag, ref: tag, sha: upstream,
  desktopVersion: desktop.version, portableRevision: 1, releaseApproved: false }, null, 2) + '\n')
git('add', 'docs/portable/upstream.json')
git('commit', '-m', `merge(portable): propose stable upstream ${tag}`)
const candidate = git('rev-parse', 'HEAD')
const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` }
// Never force push: a simultaneous maintainer change is a hard stop.
execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { env, timeout: 120000, stdio: 'pipe' })
const changed = git('diff', '--name-only', baseline.sha, upstream, '--', 'apps/desktop', 'scripts/install.ps1', 'hermes_cli/managed_uv.py')
const body = `${marker}\n## Candidate\nStable upstream ${tag}; Desktop ${desktop.version}\nUpstream SHA: ${upstream}\nCandidate SHA: ${candidate}\n\nNo merge conflicts. Portable patches retained by a normal merge.\n\n## Review focus\n\`\`\`text\n${changed.slice(0,40000)}\n\`\`\`\n\n## Validation\n${run}\nThe same execution calls the read-only reusable build with candidate SHA ${candidate}; PR event recursion is not required. Consult its actual conclusion.\n\nReview startup paths, saved credentials, installer, updater and backend compatibility. No real user servers or model accounts are tested. Public release remains blocked until acceptance and human approval.`
const pr = await api(`/repos/${repository}/pulls`, 'POST', { title: `Portable: sync stable ${tag}`, head: branch, base: 'main', body, draft: true })
fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${candidate}\npr_number=${pr.number}\n`)
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${pr.html_url}\nCandidate: ${candidate}\nUpstream: ${upstream}\n`)
