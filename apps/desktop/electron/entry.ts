import { app, dialog } from 'electron'

import { initializePortable } from './portable'

import { wslgLaunchArgs } from './wslg-launch'
import { spawnWslgLaunch } from './wslg-launch-process'

try {
  initializePortable(app)
} catch (error) {
  const message = `Portable initialization failed. Move the complete folder to a writable location. No fallback profile was opened.\n${error instanceof Error ? error.message : String(error)}`

  console.error(message)
  if (!process.argv.includes('--portable-diagnostics')) {
    dialog.showErrorBox('Hermes Portable', message)
  }
  app.exit(1)
  throw error
}

const args = wslgLaunchArgs(process.argv.slice(1), process.env, process.platform)

if (args) {
  // Keep the launcher alive until the child exits: npm's concurrently must not
  // tear down Vite during this handoff. No backend, windows or single-instance
  // lock are created in this parent. The child has an explicit platform flag,
  // so it goes straight into main on its first pass.
  const child = spawnWslgLaunch(args)

  child.once('error', error => {
    console.error('[hermes] WSLg launch failed:', error)
    app.exit(1)
  })
  child.once('exit', code => app.exit(code ?? 1))

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => child.kill(signal))
  }
} else {
  await import('./main')
}

