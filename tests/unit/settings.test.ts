import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openSettings } from '../../src/main/settings.js'
import { DEFAULT_SETTINGS, sanitiseSettings } from '../../src/shared/settings.js'
import { tempDir } from '../helpers.js'

const root = tempDir('settings')
const file = () => join(root.path, 'settings.json')

describe('sanitiseSettings', () => {
  it('answers defaults for garbage', () => {
    expect(sanitiseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitiseSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitiseSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps good fields and repairs bad ones individually', () => {
    expect(sanitiseSettings({ columns: 4, drawerOpen: 'yes' })).toEqual({
      columns: 4,
      drawerOpen: DEFAULT_SETTINGS.drawerOpen
    })
  })

  it('rejects a column count off the snap list: the divider could not drag it back', () => {
    expect(sanitiseSettings({ columns: 7, drawerOpen: false }).columns).toBe(
      DEFAULT_SETTINGS.columns
    )
  })
})

describe('openSettings', () => {
  it('reads defaults when no file exists', () => {
    expect(openSettings(file()).read()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a patch without blanking other fields', () => {
    const store = openSettings(file())
    store.write({ columns: 3 })
    store.write({ drawerOpen: false })
    expect(openSettings(file()).read()).toEqual({ columns: 3, drawerOpen: false })
  })

  it('survives a corrupt file', () => {
    writeFileSync(file(), '{ not json')
    expect(openSettings(file()).read()).toEqual(DEFAULT_SETTINGS)
  })

  it('writes atomically: the stored file is always whole JSON', () => {
    const store = openSettings(file())
    store.write({ columns: 4 })
    expect(() => JSON.parse(readFileSync(file(), 'utf8'))).not.toThrow()
  })

  it('sanitises what the renderer sends', () => {
    const store = openSettings(file())
    store.write({ columns: 999 as never })
    expect(store.read().columns).toBe(DEFAULT_SETTINGS.columns)
  })
})
