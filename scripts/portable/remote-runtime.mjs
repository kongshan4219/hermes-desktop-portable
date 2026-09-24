// Exercises the packaged remote client against a real isolated Hermes backend
// with upstream mock inference. The proxy only controls transport availability.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { _electron as electron } from 'playwright'

// Same readiness condition as the upstream E2E fixture: the composer can be
// mounted while a full-window boot or onboarding overlay still owns input.
export async function waitReady(page) {
  await page.waitForFunction(() => {
    let node = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    if (!node) return false
    while (node) {
      if (getComputedStyle(node).position === 'fixed') {
        const r = node.getBoundingClientRect()
        if (r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight) return false
      }
      node = node.parentElement
    }
    return true
  }, undefined, { timeout: 120000 })
}

export async function verifyRemote({ zip, scratch, backend, out, setImageUrl, reply }) {
  const destination = path.join(scratch, '远程 第二份 (remote)')
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  execFileSync(shell, ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PORTABLE_TEST_ZIP, $env:PORTABLE_TEST_DEST)'], {
    env: { ...process.env, PORTABLE_TEST_ZIP: zip, PORTABLE_TEST_DEST: destination }
  })
  const root = fs.realpathSync(path.join(destination, 'Hermes-Portable'))
  const sockets = new Set()
  const upstream = new URL(backend.baseUrl)
  let upgrades = 0
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const proxy = http.createServer((req, res) => {
    if (req.url === '/portable-ci.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' })
      res.end(png)
      return
    }
    const target = http.request(new URL(req.url, upstream), { method: req.method, headers: { ...req.headers, host: upstream.host } }, response => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    target.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(target)
  })
  proxy.on('upgrade', (req, socket, head) => {
    const request = http.request(new URL(req.url, upstream), { headers: { ...req.headers, host: upstream.host } })
    request.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      upgrades += 1
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`)
      for (let i = 0; i < response.rawHeaders.length; i += 2) socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`)
      socket.write('\r\n')
      if (head.length) upstreamSocket.write(head)
      if (upstreamHead.length) socket.write(upstreamHead)
      for (const s of [socket, upstreamSocket]) {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
        s.on('error', () => {})
      }
      socket.pipe(upstreamSocket).pipe(socket)
      socket.on('close', () => upstreamSocket.destroy())
      upstreamSocket.on('close', () => socket.destroy())
    })
    request.on('response', response => { response.resume(); socket.destroy() })
    request.on('error', () => socket.destroy())
    request.end()
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const remoteUrl = `http://127.0.0.1:${proxy.address().port}`
  setImageUrl(`${remoteUrl}/portable-ci.png`)
  let app
  let page
  const checks = []
  const mark = name => { checks.push({ name, status: 'passed' }); console.log(`PASS ${name}`) }
  async function launch(fake = false) {
    const env = { ...process.env, HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1' }
    delete env.HERMES_DESKTOP_BOOT_FAKE
    if (fake) Object.assign(env, { HERMES_DESKTOP_BOOT_FAKE: '1', HERMES_DESKTOP_BOOT_FAKE_STEP_MS: '20' })
    app = await electron.launch({ executablePath: path.join(root, 'Hermes.exe'), cwd: scratch, args: ['--disable-gpu'], env, timeout: 60000 })
    page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.hermesDesktop?.getConnectionConfig))
  }
  async function send(text, answer) {
    await waitReady(page)
    const composer = page.locator('textarea:visible, [contenteditable="true"]:visible').first()
    await composer.fill(text, { timeout: 120000 })
    await composer.press('Enter')
    await page.getByText(answer, { exact: false }).last().waitFor({ timeout: 120000 })
  }
  try {
    // Only the seeding launch uses fake boot. All remote assertions below use
    // the ordinary production connection path, including version negotiation.
    await launch(true)
    await page.evaluate(({ remoteUrl, token }) => window.hermesDesktop.saveConnectionConfig({
      mode: 'remote', remoteAuthMode: 'token', remoteUrl, remoteToken: token
    }), { remoteUrl, token: backend.token })
    await app.close(); app = null
    await launch()
    const descriptor = await page.evaluate(() => window.hermesDesktop.getConnection())
    assert.equal(descriptor.mode, 'remote')
    assert.equal(descriptor.baseUrl, remoteUrl)
    const tested = await page.evaluate(() => window.hermesDesktop.testConnectionConfig({ mode: 'remote' }))
    assert.equal(tested.ok, true)
    mark('second Portable copy connects remotely through real authenticated HTTP and WebSocket')
    const error = await page.evaluate(async remoteUrl => {
      try {
        await window.hermesDesktop.testConnectionConfig({ mode: 'remote', remoteAuthMode: 'token', remoteUrl, remoteToken: 'deliberately-invalid-test-token' })
        return ''
      } catch (e) { return String(e) }
    }, remoteUrl)
    assert.match(error, /unauthor|401|403|reject|WebSocket/i)
    mark('remote client rejects an invalid synthetic credential')
    await send('Portable remote chat verification', reply)
    mark('remote chat uses real gateway and mock model response')
    await send('E2E_INTERIM_TRIGGER Portable tool verification', 'All done! Here is the complete summary of what I found.')
    await page.getByText('Let me start by planning the approach.', { exact: false }).first().waitFor()
    mark('upstream scripted tool execution and interim/final results render remotely')
    await send('Portable image result verification', 'Portable mock image result')
    await page.waitForFunction(() => Array.from(document.images).some(img => img.alt === 'Portable CI image' && img.complete && img.naturalWidth > 0), undefined, { timeout: 60000 })
    mark('remote mock image result loads in the real renderer')
    const before = upgrades
    for (const socket of sockets) socket.destroy()
    const deadline = Date.now() + 60000
    while (upgrades <= before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
    assert.ok(upgrades > before, 'Renderer must reopen the interrupted WebSocket')
    await send('Portable remote reconnect verification', 'Portable remote connection recovered.')
    mark('remote WebSocket disconnect recovers and subsequent chat succeeds')
    await app.close(); app = null
    await launch()
    const restored = await page.evaluate(() => window.hermesDesktop.getConnectionConfig())
    assert.equal(restored.remoteUrl, remoteUrl)
    assert.equal(restored.remoteTokenSet, true)
    assert.equal((await page.evaluate(() => window.hermesDesktop.getConnection())).mode, 'remote')
    assert.equal(fs.existsSync(path.join(root, 'data', 'hermes', 'hermes-agent', 'venv')), false)
    mark('remote cold restart preserves configuration without installing a local Python runtime')
    await page.screenshot({ path: path.join(out, 'remote-runtime-window.png') })
    return checks
  } catch (error) {
    await page?.screenshot({ path: path.join(out, 'remote-runtime-failure.png') }).catch(() => {})
    throw error
  } finally {
    await app?.close().catch(() => {})
    for (const socket of sockets) socket.destroy()
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
  }
}
