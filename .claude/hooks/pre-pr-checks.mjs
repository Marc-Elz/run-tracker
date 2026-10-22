// PreToolUse hook: before `gh pr create`, run the local checks (there is no CI on purpose).
// Blocks the PR (exit 2) when one fails. Node so it runs the same on Windows and Linux.
import { spawnSync } from 'node:child_process'

let input = ''
for await (const chunk of process.stdin) input += chunk

const { tool_input: toolInput, cwd: sessionCwd } = JSON.parse(input)
const command = toolInput?.command ?? ''
// Only when `gh pr create` is run, not when it merely appears in a string.
if (!/(^|[;&|]\s*)gh\s+pr\s+create\b/m.test(command)) process.exit(0)

// Same checks as `npm run lint` / `test:unit`, but without --fix and without watch mode,
// so the hook never rewrites files or hangs.
const checks = [
  ['type-check', 'npm run type-check'],
  ['oxlint', 'npx oxlint .'],
  ['eslint', 'npx eslint . --cache'],
  ['unit tests', 'npx vitest run'],
]

// Check the tree the PR comes from: in a worktree session that is the session cwd, not the project dir.
const cwd = sessionCwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
for (const [name, cmd] of checks) {
  const result = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' })
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-30).join('\n')
    console.error(`PR blocked: ${name} failed (\`${cmd}\`). Fix it, then open the PR.\n\n${output}`)
    process.exit(2)
  }
}
