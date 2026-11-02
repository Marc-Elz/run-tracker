import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: true }))
const plugins = vi.hoisted(() => ({
  writeFile: vi.fn<(options: unknown) => Promise<{ uri: string }>>(async () => ({
    uri: 'file:///cache/run.gpx',
  })),
  appendFile: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  share: vi.fn<(options: unknown) => Promise<unknown>>(async () => ({})),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: plugins.writeFile, appendFile: plugins.appendFile },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }))

import { shareFile, shareGpx } from '../shareRun'

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
})
