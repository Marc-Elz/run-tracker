// Checks that this machine can build and run Run Tracker. No dependencies, works on Windows, Linux and macOS.
// Usage: npm run doctor
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const home = homedir()

/** required: needed to work on the web app. device: needed to build/run on the phone. optional: later phases. */
const results = []
const add = (level, name, ok, detail, hint) => results.push({ level, name, ok, detail, hint })

function run(cmd, args = []) {
  // On Windows .cmd shims (npm, gh, adb) need a shell; pass one command string to avoid Node's args+shell warning
  const r = isWin
    ? spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', shell: true, cwd: root })
    : spawnSync(cmd, args, { encoding: 'utf8', cwd: root })
  if (r.error || r.status !== 0) return null
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
}

const firstLine = (s) => s.split(/\r?\n/)[0]
const hint = (win, linux, mac = linux) => (isWin ? win : isMac ? mac : linux)

// ---- Node ----
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const nodeVersion = process.versions.node
const [major, minor] = nodeVersion.split('.').map(Number)
// Vite requires ^20.19 || >=22.12 (see package.json engines)
const nodeOk = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22
add(
  'required',
  'Node.js',
  nodeOk,
  `v${nodeVersion}`,
  `Need ${pkg.engines?.node ?? '>=22.12'}. Use the version in .nvmrc: ${hint('install from nodejs.org or `nvm-windows`, then `nvm use`', '`nvm install && nvm use`')}`,
)

// ---- git / gh ----
const git = run('git', ['--version'])
add(
  'required',
  'git',
  !!git,
  git ? firstLine(git) : 'not found',
  hint('install Git for Windows', 'install git with your package manager'),
)

const gh = run('gh', ['--version'])
if (!gh) {
  add(
    'required',
    'GitHub CLI (gh)',
    false,
    'not found',
    hint('`winget install GitHub.cli`', 'install `gh` from cli.github.com'),
  )
} else {
  const authed = run('gh', ['auth', 'status']) !== null
  add(
    'required',
    'GitHub CLI logged in',
    authed,
    authed ? firstLine(gh) : 'not logged in',
    'run `gh auth login`',
  )
}

// ---- dependencies ----
add(
  'required',
  'npm dependencies',
  existsSync(join(root, 'node_modules')),
  existsSync(join(root, 'node_modules')) ? 'node_modules present' : 'node_modules missing',
  'run `npm install`',
)

// ---- Java ----
// Gradle uses JAVA_HOME, else the java on PATH. It needs a full JDK (javac, not just a JRE) at the
// version android/app/capacitor.build.gradle compiles to.
const javaMin = 21
const exe = isWin ? '.exe' : ''
const javaHome = process.env.JAVA_HOME
const javac = javaHome ? join(javaHome, 'bin', `javac${exe}`) : 'javac'
const javacOut =
  javaHome && !existsSync(javac)
    ? null
    : run(isWin && javaHome ? `"${javac}"` : javac, ['-version'])
const [, v1, v2] = javacOut?.match(/javac (\d+)(?:\.(\d+))?/) ?? []
const javaMajor = v1 === '1' ? Number(v2) : Number(v1) // Java 8 reports 1.8
const studioJbr = [
  isWin &&
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
  !isWin && !isMac && '/opt/android-studio/jbr',
  !isWin && !isMac && join(home, 'android-studio', 'jbr'),
  isMac && '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
]
  .filter(Boolean)
  .find((p) => existsSync(join(p, 'bin', `javac${exe}`)))
add(
  'device',
  'Java (JDK)',
  javaMajor >= javaMin,
  javacOut
    ? `${firstLine(javacOut)}${javaHome ? ` (JAVA_HOME=${javaHome})` : ' (PATH)'}`
    : javaHome
      ? `no javac in JAVA_HOME=${javaHome} (a JRE, not a JDK?)`
      : 'no javac on PATH',
  `Need a JDK ${javaMin}+ with javac. ${studioJbr ? `Set JAVA_HOME to Android Studio's JDK: ${studioJbr}` : hint('Install Android Studio (it includes a JDK) and set JAVA_HOME to its jbr folder', `Install a JDK ${javaMin} (e.g. \`sudo pacman -S jdk${javaMin}-openjdk\`, \`sudo apt install openjdk-${javaMin}-jdk\`) or set JAVA_HOME to Android Studio's jbr folder`)}`,
)

// ---- Android SDK ----
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  isWin && join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Android', 'Sdk'),
  isMac && join(home, 'Library', 'Android', 'sdk'),
  !isWin && !isMac && join(home, 'Android', 'Sdk'),
].filter(Boolean)
const sdk = sdkCandidates.find((p) => existsSync(p))
add(
  'device',
  'Android SDK',
  !!sdk,
  sdk ?? 'not found',
  'Install Android Studio (it installs the SDK), open it once to finish setup, then set ANDROID_HOME to the SDK folder',
)

// ---- adb ----
const adbBin = isWin ? 'adb.exe' : 'adb'
const sdkAdb = sdk && join(sdk, 'platform-tools', adbBin)
const adbCmd = run('adb', ['version']) ? 'adb' : sdkAdb && existsSync(sdkAdb) ? sdkAdb : null
add(
  'device',
  'adb',
  !!adbCmd,
  adbCmd ?? 'not found',
  `Install "Android SDK Platform-Tools" in Android Studio's SDK Manager and add platform-tools to PATH${isWin ? ' (%LOCALAPPDATA%\\Android\\Sdk\\platform-tools)' : ' (~/Android/Sdk/platform-tools)'}`,
)

// ---- connected phone ----
if (adbCmd) {
  const out = run(adbCmd.includes(' ') ? `"${adbCmd}"` : adbCmd, ['devices']) ?? ''
  const lines = out
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
  const ready = lines.filter((l) => l.endsWith('\tdevice'))
  const unauthorized = lines.filter((l) => l.endsWith('\tunauthorized'))
  if (ready.length) {
    add(
      'device',
      'Phone connected',
      true,
      `${ready.length} device(s): ${ready.map((l) => l.split('\t')[0]).join(', ')}`,
    )
  } else if (unauthorized.length) {
    add(
      'device',
      'Phone connected',
      false,
      'unauthorized',
      'Unlock the phone and accept the "Allow USB debugging?" prompt',
    )
  } else {
    add(
      'device',
      'Phone connected',
      false,
      'no device found',
      'Enable Developer options (tap Build number 7 times), switch on USB debugging, plug in the cable' +
        (isWin ? '' : '; on Linux you may need a udev rule for your phone'),
    )
  }
} else {
  add('device', 'Phone connected', false, 'skipped (no adb)', 'Fix adb first')
}

// ---- Docker (later phases) ----
const docker = run('docker', ['--version'])
add(
  'optional',
  'Docker',
  !!docker,
  docker ? firstLine(docker) : 'not found',
  'Docker Desktop (needed from Phase 4 for routing services)',
)
if (docker) {
  const running = run('docker', ['info']) !== null
  add(
    'optional',
    'Docker running',
    running,
    running ? 'daemon reachable' : 'daemon not running',
    'Start Docker Desktop',
  )
}

// ---- report ----
const icon = { true: '\u2713', false: '\u2717' }
const labels = {
  required: 'Required',
  device: 'For running on the phone',
  optional: 'Optional (later phases)',
}
for (const level of ['required', 'device', 'optional']) {
  console.log(`\n${labels[level]}`)
  for (const r of results.filter((x) => x.level === level)) {
    console.log(`  ${icon[r.ok]} ${r.name}: ${r.detail}`)
    if (!r.ok && r.hint) console.log(`      -> ${r.hint}`)
  }
}

const missing = (level) => results.filter((r) => r.level === level && !r.ok).length
console.log('')
if (missing('required')) {
  console.log(`Not ready: ${missing('required')} required item(s) missing.`)
  process.exit(1)
}
console.log(
  missing('device')
    ? `Ready for web development. ${missing('device')} item(s) missing before you can run on the phone.`
    : 'Ready for web development and for running on the phone.',
)
