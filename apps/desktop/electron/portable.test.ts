import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { detectPortable, preparePortableRuntime } from './portable'

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-中文 日本 (test)-'))
  const exe = path.join(root, 'Hermes.exe')

  folders.push(root)
  fs.writeFileSync(exe, '')

  return { root, exe }
}

it('requires a regular flag beside the real executable', () => {
  const { root, exe } = fixture()

  expect(detectPortable(exe)).toBeNull()
  fs.writeFileSync(path.join(root, 'portable.flag'), '')
  expect(detectPortable(exe)?.data).toBe(path.join(fs.realpathSync(root), 'data'))
  fs.unlinkSync(path.join(root, 'portable.flag'))
  fs.mkdirSync(path.join(root, 'portable.flag'))
  expect(() => detectPortable(exe)).toThrow(/regular file/)
})

it('invalidates a moved venv without deleting configuration, sessions or the old environment', () => {
  const { root, exe } = fixture()

  fs.writeFileSync(path.join(root, 'portable.flag'), '')
  const p = detectPortable(exe)!
  const runtime = path.join(p.hermes, 'hermes-agent')

  fs.mkdirSync(path.join(runtime, 'venv'), { recursive: true })
  fs.mkdirSync(p.cache, { recursive: true })
  fs.writeFileSync(path.join(runtime, 'venv', 'pyvenv.cfg'), 'old absolute interpreter path')
  fs.writeFileSync(path.join(runtime, '.hermes-bootstrap-complete'), 'old marker')
  fs.writeFileSync(path.join(p.hermes, 'config.yaml'), 'sentinel')
  fs.writeFileSync(path.join(p.hermes, 'state.db'), 'sessions')
  fs.writeFileSync(path.join(p.data, 'portable-location.json'), JSON.stringify({ root: path.join(root, 'old') }))
  preparePortableRuntime(p)
  expect(fs.existsSync(path.join(runtime, 'venv'))).toBe(false)
  expect(fs.existsSync(path.join(runtime, '.hermes-bootstrap-complete'))).toBe(false)
  expect(fs.readFileSync(path.join(p.hermes, 'config.yaml'), 'utf8')).toBe('sentinel')
  expect(fs.readFileSync(path.join(p.hermes, 'state.db'), 'utf8')).toBe('sessions')
  const backups = fs.readdirSync(p.cache)

  expect(backups).toHaveLength(1)
  expect(fs.readFileSync(path.join(p.cache, backups[0], 'venv', 'pyvenv.cfg'), 'utf8')).toContain('old absolute')
  preparePortableRuntime(p)
  expect(fs.readdirSync(p.cache)).toEqual(backups)
})
