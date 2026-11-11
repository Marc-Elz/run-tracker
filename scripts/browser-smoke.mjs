// Browser smoke test of the flows that only need a browser: tab bar, a run with the dev GPS
// simulator, the run summary with its map, History, GPX download, training programs, backup and restore, Settings. Starts the dev server itself, no setup beyond
// `npx playwright install chromium`. Not part of the pre-PR checks; run it when a change touches these flows.
// Usage: npm run test:browser   (SHOTS=<dir> saves screenshots of Settings, the training screens and the finished run)
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

// A git worktree under .claude/worktrees without its own node_modules resolves packages from the parent repo, and Vite then
// refuses to serve MapLibre's worker file from outside the worktree ("e.endsWith is not a function", #90). Fail early instead.
if (!existsSync(new URL('../node_modules', import.meta.url))) {
  console.error('No node_modules in this checkout. Run `npm install` here first (each git worktree needs its own).')
  process.exit(2)
}

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
  // A failed MapTiler request says why in its body (Invalid key / Missing key / Key usage restricted); a bare 403 doesn't.
  const mapTilerFailures = []
  page.on('response', async (r) => {
    if (!new URL(r.url()).hostname.endsWith('maptiler.com') || r.status() < 400) return
    // Chromium hides the body of a CORS-blocked error from the page, so ask again from Node with the page's Referer.
    const again = await fetch(r.url(), { headers: { Referer: url } }).catch(() => null)
    const body = ((await again?.text().catch(() => '')) ?? '').trim().slice(0, 60)
    mapTilerFailures.push(`${r.status()} ${body}`.trim())
  })
  const tabBar = () => page.locator('nav').count()

  await page.goto(url)
  await page.waitForSelector('main.run')
  const tabs = (await page.locator('nav a').allTextContents()).map((t) => t.trim())
  check('tab bar has Run, History, Training, Settings', tabs.join() === 'Run,History,Training,Settings', tabs.join())

  // Settings and History
  await page.locator('nav a', { hasText: 'Settings' }).click()
  await page.waitForSelector('.settings')
  const settings = await page.locator('.settings').innerText()
  check('Settings shows phone-only rows in the browser', settings.includes('Only available on the phone'))
  check('Settings shows metric units', settings.includes('Metric (km, min/km)'))
  check(
    'Settings has no permission buttons in the browser',
    (await page.locator('.settings .row:not(.cues):not(.backup) button').count()) === 0,
  )
  check('Back up is disabled before the first run or program', await page.getByRole('button', { name: 'Back up', exact: true }).isDisabled())
  check('no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'settings.png') })
  await page.locator('nav a', { hasText: 'History' }).click()
  check('History is empty before the first run', (await page.locator('main').innerText()).includes('No runs yet'))

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
  // Stop saves the run and opens its summary
  await page.waitForSelector('main.summary .stats')
  check('Stop opens the run summary', /\/run\/[0-9a-f-]{36}$/.test(page.url()), page.url())
  check('tab bar is back on the summary', (await tabBar()) === 1)
  const stats = await page.locator('.summary .stats').innerText()
  check('summary shows distance, time, moving time, avg pace and moving pace', ['distance', 'time', 'moving time', 'avg pace', 'moving pace'].every((l) => stats.toLowerCase().includes(l)), stats.replace(/\n+/g, ' '))
  check('summary distance is not zero', Number(await page.locator('.summary .stat__value').first().innerText()) > 0)
  await page.waitForSelector('.route-map__canvas canvas', { timeout: 10000 })
  check('route map renders a canvas', (await page.locator('.route-map__canvas canvas').count()) === 1)
  const mapMessage = await page.locator('.route-map__problem').allInnerTexts()
  console.log(`INFO map message: ${mapMessage.join(' | ') || '(none)'}`)
  check('no horizontal scroll on the summary', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  // Five stats in three columns: each value must still fit its column at 360 px (#65)
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('.summary .stat')]
      .map((tile) => ({
        label: tile.querySelector('.stat__label').innerText,
        value: tile.querySelector('.stat__value').innerText,
        over: tile.querySelector('.stat__value').scrollWidth - tile.querySelector('.stat__value').clientWidth,
      }))
      .filter((stat) => stat.over > 0),
  )
  check('no stat value is clipped at 360 px', clipped.length === 0, clipped.map((s) => `${s.label} ${s.value} +${s.over}px`).join(', '))
  // The simulated run lasts seconds; a real one passes an hour and formats as "1:02:05" (#65)
  const hourSlack = await page.evaluate(() => {
    const tile = document.querySelector('.summary .stat')
    const value = tile.querySelector('.stat__value')
    const before = value.innerText
    value.innerText = '1:02:05'
    const slack = Math.round(tile.clientWidth - value.scrollWidth)
    value.innerText = before
    return slack
  })
  check('an hour-long time still fits its column at 360 px', hourSlack >= 0, `${hourSlack}px to spare`)
  if (shots) await page.screenshot({ path: join(shots, 'summary.png') })

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

  // Training: a program with one session, which the backup below then holds too
  await page.locator('nav a', { hasText: 'Training' }).click()
  await page.waitForSelector('main.page')
  check('Training is empty at first', (await page.locator('main').innerText()).includes('No training programs yet'))
  await page.getByRole('link', { name: '+ New program' }).click()
  await page.locator('#program-name').fill('Half marathon')
  await page.locator('#program-goal').fill('Sub 2:00')
  if (shots) await page.screenshot({ path: join(shots, 'program-form.png') })
  await page.locator('form').getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Sub 2:00 · 8 weeks').waitFor()
  check('a new program opens with its weeks', (await page.locator('.week').count()) === 8)
  await page.getByRole('link', { name: '+ Add session to week 1' }).click()
  await page.getByRole('button', { name: 'Intervals' }).click()
  await page.locator('#session-title').fill('6×400 m')
  check('session editor has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'session-editor.png') })
  await page.locator('form').getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.week').first().getByText('6×400 m').waitFor()
  check('the session is listed in its week', (await page.locator('.week').first().innerText()).includes('Intervals'))
  check('program has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'program.png'), fullPage: true })

  // Steps: warm-up, a repeat (starts with one run), cool-down; then drag the cool-down into the repeat
  await page.locator('.week').first().getByText('6×400 m').click()
  await page.getByRole('heading', { name: 'Edit session' }).waitFor()
  const addStep = async (kind, time) => {
    await page.getByRole('button', { name: '+ Add step', exact: true }).click()
    await page.getByRole('button', { name: kind, exact: true }).click()
    if (time) {
      await page.getByRole('button', { name: 'Time', exact: true }).click()
      await page.locator('#step-target-value').fill(time)
    }
    await page.locator('form').getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('heading', { name: 'Edit session' }).waitFor()
  }
  // A short warm-up, so the run below can watch the step panel move on (#101)
  await addStep('Warm-up', '0:05')
  await addStep('Repeat')
  await addStep('Cool-down', '5:00')
  const stepTexts = () => page.locator('.step__text').allInnerTexts()
  check(
    'steps are listed, the repeat holding its run',
    (await stepTexts()).join('|') === 'Warm-up 0:05|2× · 1 step|Run|Cool-down 5:00',
    (await stepTexts()).join('|'),
  )
  // The screen scrolls inside .page: bring both handles on screen before measuring them
  await page.locator('.step__handle').last().scrollIntoViewIfNeeded()
  const from = await page.locator('.step__handle').last().boundingBox()
  const to = await page.locator('.step-list--inner .step__handle').first().boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + ((to.y - from.y) * i) / 10 + 4)
    await page.waitForTimeout(30)
  }
  await page.mouse.up()
  await page.getByText('2× · 2 steps').waitFor()
  check(
    'dragging the cool-down into the repeat saves the new order',
    (await stepTexts()).join('|') === 'Warm-up 0:05|2× · 2 steps|Cool-down 5:00|Run',
    (await stepTexts()).join('|'),
  )
  check('session editor with steps has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'session-steps.png'), fullPage: true })
  await page.getByRole('button', { name: '‹ Cancel' }).click()
  await page.locator('.week').first().waitFor()
  await page.locator('.week').first().getByText('6×400 m').click()
  check(
    'the order is still there when the session is opened again',
    (await stepTexts()).join('|') === 'Warm-up 0:05|2× · 2 steps|Cool-down 5:00|Run',
    (await stepTexts()).join('|'),
  )
  await page.getByRole('button', { name: '‹ Cancel' }).click()
  await page.locator('.week').first().waitFor()

  // Picking, not typing (#143): warm-up 5:00, 8× (run 1:00, walk 1:30), cool-down 5:00 in week 2,
  // with every tap counted and nothing typed. It is deleted again, so the run below is unchanged.
  let taps = 0
  const tap = async (locator) => {
    taps++
    await locator.click()
  }
  const btn = (name) => page.getByRole('button', { name, exact: true })
  const heading = (name) => page.getByRole('heading', { name }).waitFor()
  await tap(page.getByRole('link', { name: '+ Add session to week 2' }))
  await tap(btn('Run/walk'))
  await tap(btn('+ Add step'))
  await heading('New step')
  // The wireframe's open question: is Save in reach on a short phone? The top bar's Save always is;
  // where the form's own buttons land is logged, to compare with the phone
  const topSave = await page.locator('header').getByRole('button', { name: 'Save', exact: true }).boundingBox()
  check('a new step has Save in view at 360×640', topSave !== null && topSave.y + topSave.height <= 640, JSON.stringify(topSave))
  const bottomOf = async (name) => {
    const box = await page.locator('form').getByRole('button', { name, exact: true }).boundingBox()
    return box && Math.round(box.y + box.height)
  }
  const tabTop = Math.round((await page.locator('nav').boundingBox())?.y ?? 0)
  console.log(`INFO new step at 360 px: form Save ends at ${await bottomOf('Save')} px, Save and add next at ${await bottomOf('+ Save and add next')} px, tab bar starts at ${tabTop} px`)
  check('step editor has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'step-new.png') })
  await tap(btn('5:00'))
  await tap(btn('+ Save and add next'))
  await tap(btn('Repeat'))
  for (let i = 0; i < 6; i++) await tap(btn('More times'))
  await tap(btn('+ Save and add next'))
  await heading('New step in repeat')
  await tap(btn('1:00'))
  await tap(btn('+ Save and add next'))
  await page.locator('button[aria-pressed="true"]', { hasText: 'Walk' }).waitFor()
  await tap(btn('1:30'))
  await tap(page.locator('form').getByRole('button', { name: 'Save', exact: true }))
  await heading('Edit session')
  await tap(btn('+ Add step'))
  await page.locator('button[aria-pressed="true"]', { hasText: 'Cool-down' }).waitFor()
  await tap(btn('5:00'))
  await tap(page.locator('form').getByRole('button', { name: 'Save', exact: true }))
  await heading('Edit session')
  check(
    'a session is built from taps alone',
    (await stepTexts()).join('|') === 'Warm-up 5:00|8× · 2 steps|Run 1:00|Walk 1:30|Cool-down 5:00',
    (await stepTexts()).join('|'),
  )
  check('the empty title shows the generated name', (await page.locator('#session-title').getAttribute('placeholder')) === '8× run 1:00 / walk 1:30')
  await tap(btn('‹ Cancel'))
  const week2 = page.locator('.week').nth(1)
  await week2.getByText('8× run 1:00 / walk 1:30').waitFor()
  console.log(`  taps to build the session: ${taps}, nothing typed`)
  check('the program lists the session by its generated name, built in 21 taps', taps === 21, `${taps} taps`)
  await week2.getByText('8× run 1:00 / walk 1:30').click()
  await btn('Delete session').click()
  await page.getByRole('alertdialog').getByText('8× run 1:00 / walk 1:30 is removed from week 2.').waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await page.locator('.week').nth(1).getByText('No sessions').waitFor()

  await page.getByRole('button', { name: '‹ Back' }).click()
  await page.waitForSelector('main.page .row')
  check('Training lists the program',(await page.locator('main .row').innerText()).includes('1 session'))
  if (shots) await page.screenshot({ path: join(shots, 'training.png') })

  // Backup: download the file from Settings (checked below after Delete, by restoring it)
  await page.locator('nav a', { hasText: 'Settings' }).click()
  await page.waitForSelector('.settings')
  const [backupDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Back up', exact: true }).click(),
  ])
  const backupName = backupDownload.suggestedFilename()
  check('backup file is run-tracker-backup-YYYY-MM-DD.json', /^run-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupName), backupName)
  const backupPath = await backupDownload.path()
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
  check(
    'backup holds the one finished run with its points',
    backup.format === 'run-tracker-backup' && backup.runs.length === 1 && backup.runs[0].points.length > 5,
    `${backup.runs.length} run(s)`,
  )
  check(
    'backup holds the program with its session',
    backup.version === 2 && backup.programs.length === 1 && backup.programs[0].sessions.length === 1,
  )
  check('Settings says what was backed up', (await page.locator('.settings').innerText()).includes('Backed up 1 run and 1 program'))

  // The run is listed in History and opens from there; Delete asks first
  await page.locator('nav a', { hasText: 'History' }).click()
  await page.waitForSelector('.history .row')
  check('History lists the run', (await page.locator('.history .row').count()) === 1)
  await page.locator('.history .row').click()
  await page.waitForSelector('main.summary .stats')
  check('a past run opens in the summary', /\/run\//.test(page.url()))
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  check('Delete asks for confirmation', await page.getByRole('alertdialog').isVisible())
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep' }).click()
  check('Keep closes the dialog', (await page.getByRole('alertdialog').count()) === 0)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForSelector('.history')
  check('Delete removes the run and returns to History', (await page.locator('main').innerText()).includes('No runs yet'))

  // Restore the backup: the run comes back, a second restore adds nothing
  await page.locator('nav a', { hasText: 'Settings' }).click()
  await page.waitForSelector('.settings')
  await page.locator('.settings input[type="file"]').setInputFiles(backupPath)
  // The program was never deleted, so it counts as already on this phone
  await page.getByText('Restored 1 run, 1 already on this phone', { exact: true }).waitFor()
  check('restore brings the run back', true)
  await page.locator('.settings input[type="file"]').setInputFiles(backupPath)
  await page.getByText('Restored 0 runs, 2 already on this phone').waitFor()
  check('restoring the same file again adds nothing', true)
  await page.locator('nav a', { hasText: 'History' }).click()
  await page.waitForSelector('.history .row')
  check('History lists the restored run', (await page.locator('.history .row').count()) === 1)

  // Run a session (#40): follow the program, start its next session, then see it ticked off
  await page.locator('nav a', { hasText: 'Run' }).click()
  await page.waitForSelector('main.run')
  check('Run screen points to Training while nothing is followed', (await page.locator('main.run').innerText()).includes('Follow a program in Training'))
  await page.locator('nav a', { hasText: 'Training' }).click()
  await page.waitForSelector('main.page .row')
  await page.locator('main .row').click()
  await page.getByRole('button', { name: 'Follow this program' }).click()
  await page.getByRole('button', { name: '✓ Following' }).waitFor()
  check('the next session is marked on the program', (await page.locator('.week').first().innerText()).includes('NEXT'))
  await page.locator('nav a', { hasText: 'Run' }).click()
  await page.waitForSelector('main.run .session-card')
  const card = await page.locator('.session-card').innerText()
  check('Run screen offers the next session', /next session · week 1/i.test(card) && card.includes('6×400 m'), card.replace(/\n+/g, ' '))
  check('Run screen with a session has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  if (shots) await page.screenshot({ path: join(shots, 'run-session.png') })
  await page.getByRole('button', { name: 'Start session' }).click()
  await page.waitForSelector('main.run[data-status="running"]')
  // The step panel (#101): warm-up 0:05, then 2× (cool-down 5:00, run without a target)
  await page.locator('.step-panel').waitFor()
  const panel = () => page.locator('.step-panel').innerText()
  const first = await panel()
  check('a session run shows its first step', /warm-up/i.test(first) && first.includes('1 / 5') && first.includes('Next: Cool-down 5:00 · rep 1/2'), first.replace(/\n+/g, ' '))
  check('Run screen with a step panel has no horizontal scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
  await page.waitForFunction(() => document.querySelector('.step-panel')?.textContent?.includes('2 / 5'), null, { timeout: 10_000 })
  const second = await panel()
  check('the step moves on from the run clock', /cool-down · rep 1\/2/i.test(second) && /(5:00|4:5\d) LEFT/i.test(second.replace(/\n+/g, ' ')), second.replace(/\n+/g, ' '))
  // The tallest layout must keep Pause in view on a short phone
  await page.setViewportSize({ width: 360, height: 640 })
  const pause = await page.getByRole('button', { name: 'Pause' }).boundingBox()
  check('Pause stays in view at 360×640 with the step panel', pause !== null && pause.y + pause.height <= 640, JSON.stringify(pause))
  if (shots) await page.screenshot({ path: join(shots, 'run-step-panel.png') })
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.waitForSelector('main.summary .stats')
  await page.locator('nav a', { hasText: 'Training' }).click()
  await page.waitForSelector('main.page .row')
  await page.locator('main .row').click()
  await page.locator('.row--done').first().waitFor()
  check('the finished session is ticked off', (await page.locator('.row--done').count()) === 1)
  await page.locator('nav a', { hasText: 'Run' }).click()
  await page.waitForSelector('main.run .session-card')
  check('with every session done the Run screen says so', (await page.locator('.session-card').innerText()).includes('All sessions done'))
  check('and offers a plain Start', await page.getByRole('button', { name: 'Start', exact: true }).isVisible())

  check('MapTiler requests succeed', mapTilerFailures.length === 0, [...new Set(mapTilerFailures)].join(' | '))
  check('no console or page errors',errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures.length === 0 ? '\nAll browser checks passed' : `\n${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
