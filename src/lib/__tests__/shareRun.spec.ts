import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: true }))
const plugins = vi.hoisted(() => ({
  writeFile: vi.fn<(options: unknown) => Promise<{ uri: string }>>(async () => ({
    uri: 'file:///cache/run.gpx',
  })),
  appendFile: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  stat: vi.fn<(options: unknown) => Promise<object>>(async () => ({})),
  readdir: vi.fn<(options: unknown) => Promise<{ files: { name: string }[] }>>(async () => ({ files: [] })),
  deleteFile: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  share: vi.fn<(options: unknown) => Promise<unknown>>(async () => ({})),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: plugins.writeFile, appendFile: plugins.appendFile,
    stat: plugins.stat,
    readdir: plugins.readdir,
    deleteFile: plugins.deleteFile,
  },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }))

import { clearSharedFiles, reshareFile, shareFile, shareGpx } from '../shareRun'

describe('shareGpx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.value = true
  })

  it('writes the file to the cache, then opens the share sheet with it', async () => {
    await shareGpx('run.gpx', '<gpx/>')
    expect(plugins.writeFile).toHaveBeenCalledWith({
      path: 'run.gpx',
      data: '<gpx/>',
      directory: 'CACHE',
      encoding: 'utf8',
    })
    expect(plugins.share).toHaveBeenCalledWith({ title: 'run.gpx', files: ['file:///cache/run.gpx'] })
  })

  it('is silent when the share sheet is dismissed', async () => {
    plugins.share.mockRejectedValueOnce(new Error('Share canceled'))
    await expect(shareGpx('run.gpx', '<gpx/>')).resolves.toBeUndefined()
  })

  it('fails when the file cannot be written or the share breaks', async () => {
    plugins.writeFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(shareGpx('run.gpx', '<gpx/>')).rejects.toThrow('disk full')
    plugins.share.mockRejectedValueOnce(new Error('boom'))
    await expect(shareGpx('run.gpx', '<gpx/>')).rejects.toThrow('boom')
  })

  it('downloads the file in the browser', async () => {
    native.value = false
    URL.createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:x')
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await shareGpx('run.gpx', '<gpx/>')
    expect(click).toHaveBeenCalledOnce()
    expect(plugins.share).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('writes pieces one by one, the first as the file and the rest appended', async () => {
    async function* pieces() {
      yield '{"a":['
      yield '1,'
      yield '2]}'
    }
    await shareFile('backup.json', pieces(), 'application/json')
    expect(plugins.writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: '{"a":[' }))
    expect(plugins.appendFile.mock.calls.map(([o]) => (o as { data: string }).data)).toEqual([
      '1,',
      '2]}',
    ])
    expect(plugins.share).toHaveBeenCalledWith({
      title: 'backup.json',
      files: ['file:///cache/run.gpx'],
    })
  })

  it('shares any file, here JSON, through the same cache and share sheet', async () => {
    await shareFile('backup.json', '{}', 'application/json')
    expect(plugins.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'backup.json', data: '{}' }),
    )
    expect(plugins.share).toHaveBeenCalledOnce()
  })

  it('returns where the file was written, so it can be shared again', async () => {
    expect(await shareFile('backup.json', '{}', 'application/json')).toBe('file:///cache/run.gpx')
  })

  describe('reshareFile', () => {
    it('opens the share sheet again for a file that is still in the cache', async () => {
      expect(await reshareFile('backup.json', 'file:///cache/backup.json')).toBe(true)
      expect(plugins.stat).toHaveBeenCalledWith({ path: 'backup.json', directory: 'CACHE' })
      expect(plugins.writeFile).not.toHaveBeenCalled()
      expect(plugins.share).toHaveBeenCalledWith({
        title: 'backup.json',
        files: ['file:///cache/backup.json'],
      })
    })

    it('says no when the file is gone, and in the browser', async () => {
      plugins.stat.mockRejectedValueOnce(new Error('File does not exist'))
      expect(await reshareFile('backup.json', 'file:///x')).toBe(false)
      expect(plugins.share).not.toHaveBeenCalled()
      native.value = false
      expect(await reshareFile('backup.json', 'file:///x')).toBe(false)
    })

    it('is silent when the sheet is dismissed', async () => {
      plugins.share.mockRejectedValueOnce(new Error('Share canceled'))
      expect(await reshareFile('backup.json', 'file:///x')).toBe(true)
    })
  })

  describe('clearSharedFiles', () => {
    it('deletes old backups and GPX exports from the cache and nothing else', async () => {
      plugins.readdir.mockResolvedValueOnce({
        files: [
          { name: 'run-tracker-backup-2026-11-02.json' },
          { name: 'run-2026-10-26-0705.gpx' },
          { name: 'WebView' },
          { name: 'other.json' },
          { name: 'run-tracker-backup-x.json.bak' },
        ],
      })
      await clearSharedFiles()
      expect(plugins.readdir).toHaveBeenCalledWith({ path: '', directory: 'CACHE' })
      expect(plugins.deleteFile.mock.calls.map(([o]) => (o as { path: string }).path)).toEqual([
        'run-tracker-backup-2026-11-02.json',
        'run-2026-10-26-0705.gpx',
      ])
    })

    it('does nothing in the browser and never throws', async () => {
      native.value = false
      await clearSharedFiles()
      expect(plugins.readdir).not.toHaveBeenCalled()
      native.value = true
      plugins.readdir.mockRejectedValueOnce(new Error('no access'))
      await expect(clearSharedFiles()).resolves.toBeUndefined()
    })
  })
})
