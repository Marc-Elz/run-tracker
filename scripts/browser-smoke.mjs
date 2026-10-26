// Browser smoke test of the flows that only need a browser: tab bar, a run with the dev GPS
// simulator, GPX download, Settings. Starts the dev server itself, no setup beyond
// `npx playwright install chromium`. Not part of the pre-PR checks; run it when a change touches these flows.
// Usage: npm run test:browser   (SHOTS=<dir> saves screenshots of Settings and the finished run)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const failures = []
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!pass) failures.push(name)
}

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const url = server.resolvedUrls.local[0]

let browser
try {
  browser = await chromium.launch()
} catch (err) {
  console.error('Could not start Chromium. Run `npx playwright install chromium` once.\n', err.message)
  await server.close()
  process.exit(2)
}

try {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const tabBar = () => page.locator('nav').count()
  const within = (box) => box !== null && box.y + box.height <= 740

  await page.goto(url)
  await page.waitForSelector('main.run')
  const tabs = (await page.locator('nav a').allTextContents()).map((t) => t.trim())
  check('tab bar has Run, History, Settings', tabs.join() === 'Run,History,Settings', tabs.join())

  // Settings and History
  await page.locator('nav a', { hasText: 'Settings' }).click()
  await page.waitForSelector('.settings')
  const settings = await page.locator('.settings').innerText()
  check('Settings shows phone-only rows in the browser', settings.includes('Only available on the phone'))
  check('Settings shows metric units', settings.includes('Metric (km, min/km)'))
  check('Settings has no buttons in the browser', (await page.locator('.settings button').count()) === 0)
  check('no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'settings.png') })
  await page.locator('nav a', { hasText: 'History' }).click()
  check('History placeholder renders', (await page.locator('main').innerText()).includes('Coming soon'))

  // A run with the dev GPS simulator: start, pause/resume, stop
  await page.locator('nav a', { hasText: 'Run' }).click()
  await page.waitForSelector('main.run')
  check('Simulate GPS is on by default in dev', await page.locator('.dev input').isChecked())
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForSelector('main.run[data-status="running"]')
  check('tab bar hidden while running', (await tabBar()) === 0)
  await page.waitForTimeout(7000)
  const km = Number(await page.locator('.stat--distance .stat__value').innerText())
  check('distance counts up with the simulator', km > 0, `${km} km`)
  await page.getByRole('button', { name: 'Pause' }).click()
  check('tab bar hidden while paused', (await tabBar()) === 0)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.waitForSelector('main.run[data-status="finished"]')
  check('tab bar hidden on the finished screen', (await tabBar()) === 0)
  check('Export GPX and Done fit at 360x740', within(await page.getByRole('button', { name: 'Export GPX' }).boundingBox()) && within(await page.getByRole('button', { name: 'Done' }).boundingBox()))
  if (shots) await page.screenshot({ path: join(shots, 'finished.png') })

  // GPX download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export GPX' }).click(),
  ])
  const name = download.suggestedFilename()
  check('GPX file name is run-YYYY-MM-DD-HHmm.gpx', /^run-\d{4}-\d{2}-\d{2}-\d{4}\.gpx$/.test(name), name)
  const xml = readFileSync(await download.path(), 'utf8')
  const segments = (xml.match(/<trkseg>/g) ?? []).length
  const points = (xml.match(/<trkpt /g) ?? []).length
  check('GPX has one segment per pause/resume', segments === 2, `${segments} segments, ${points} points`)
  check('GPX points have UTC times', points > 5 && !/<trkpt [^>]*><(?!ele|time)/.test(xml) && /<time>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/time>/.test(xml))

  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForSelector('nav')
  check('tab bar is back after Done', (await tabBar()) === 1)
  check('no console or page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures.length === 0 ? '\nAll browser checks passed' : `\n${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
