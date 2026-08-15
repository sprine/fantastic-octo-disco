import { describe, expect, it } from 'vitest'
import { canonicalisePath } from '../../src/main/canonicalPath.js'

const pure = { resolveSymlinks: false } as const

describe('canonicalisePath', () => {
  it('resolves relative input against cwd', () => {
    expect(canonicalisePath('b.jpg', { ...pure, platform: 'linux', cwd: '/a' })).toBe('/a/b.jpg')
  })

  it('folds case where the platform is case-insensitive', () => {
    const darwin = { ...pure, platform: 'darwin' as const, cwd: '/' }
    expect(canonicalisePath('/Photos/IMG.JPG', darwin)).toBe(canonicalisePath('/photos/img.jpg', darwin))
  })

  it('preserves case on linux, where two such paths are two files', () => {
    const linux = { ...pure, platform: 'linux' as const, cwd: '/' }
    expect(canonicalisePath('/Photos/IMG.JPG', linux)).not.toBe(canonicalisePath('/photos/img.jpg', linux))
  })

  it('normalises NFD to NFC so APFS and user input agree', () => {
    const darwin = { ...pure, platform: 'darwin' as const, cwd: '/' }
    const nfd = '/photos/cafe\u0301.jpg' // e + combining acute, as APFS returns it
    const nfc = '/photos/caf\u00e9.jpg'
    expect(canonicalisePath(nfd, darwin)).toBe(canonicalisePath(nfc, darwin))
  })

  it('normalises Windows separators and drive case', () => {
    const win = { ...pure, platform: 'win32' as const, cwd: 'C:\\base' }
    expect(canonicalisePath('C:\\Photos\\IMG.JPG', win)).toBe('c:/photos/img.jpg')
    expect(canonicalisePath('D:/x/y.png', win)).toBe(canonicalisePath('d:\\X\\Y.PNG', win))
  })

  it('strips a trailing separator but keeps the root', () => {
    const linux = { ...pure, platform: 'linux' as const, cwd: '/' }
    expect(canonicalisePath('/a/b/', linux)).toBe('/a/b')
    expect(canonicalisePath('/', linux)).toBe('/')
  })

  it('collapses . and .. segments', () => {
    const linux = { ...pure, platform: 'linux' as const, cwd: '/' }
    expect(canonicalisePath('/a/./b/../c.jpg', linux)).toBe('/a/c.jpg')
  })

  it('returns a resolved path for a file that does not exist yet', () => {
    expect(canonicalisePath('/definitely/not/here.jpg', { platform: 'linux', cwd: '/' })).toBe(
      '/definitely/not/here.jpg'
    )
  })
})
