import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Hand a file to the user. On the phone: write it to the app cache and open the Android share
 * sheet (Drive, Save to device, Strava ...). In the browser: download it. Closing the share sheet
 * is not an error. The cache file is left for Android to clear: the app the user picked may still
 * be reading it after the sheet closes.
 */
export async function shareFile(
  fileName: string,
  content: string | AsyncIterable<string>,
  mimeType: string,
): Promise<void> {
  const pieces = typeof content === 'string' ? [content] : content
  if (!Capacitor.isNativePlatform()) {
    const parts: string[] = []
    for await (const piece of pieces) parts.push(piece)
    const url = URL.createObjectURL(new Blob(parts, { type: mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    return
  }

  // Written piece by piece: handing a large file to the plugin as one string ran the app out of
  // memory (a 78 MB backup crashed it)
  let uri = ''
  for await (const piece of pieces) {
    const options = {
      path: fileName,
      data: piece,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    }
    if (uri === '') uri = (await Filesystem.writeFile(options)).uri
    else await Filesystem.appendFile(options)
  }
  if (uri === '') uri = (await Filesystem.writeFile({ path: fileName, data: '', directory: Directory.Cache, encoding: Encoding.UTF8 })).uri
  try {
    await Share.share({ title: fileName, files: [uri] })
  } catch (err) {
    // The plugin rejects when the sheet is dismissed
    if (err instanceof Error && /cancel/i.test(err.message)) return
    throw err
  }
}

/** Hand a GPX file to the user, see `shareFile`. */
export const shareGpx = (fileName: string, xml: string) =>
  shareFile(fileName, xml, 'application/gpx+xml')
