// tests/chrome.mjs — the browser the two browser-driven suites launch.
//
// Those suites need a Chrome or Chromium binary. `CHROME_PATH` overrides the search,
// which is what makes them runnable anywhere other than the machine they were written
// on; without it the per-platform default is used.
import { spawn } from 'node:child_process'

/** Default executables, by platform. */
const DEFAULTS = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
}

/**
 * The browser executable to launch.
 * @returns the path or command to spawn.
 */
export function chromeExecutable() {
  const override = process.env.CHROME_PATH
  return override != null && override !== '' ? override : (DEFAULTS[process.platform] ?? 'google-chrome')
}

/**
 * Launch the browser headlessly.
 *
 * A missing executable would otherwise look like a hung test: the connect loop spins
 * until the watchdog fires with no output, which says nothing about the cause.
 * @param args - the browser's own arguments.
 * @returns the child process.
 */
export function spawnChrome(args) {
  const executable = chromeExecutable()
  const child = spawn(executable, args, { stdio: 'ignore' })
  child.on('error', (error) => {
    console.error(`cannot launch ${executable}: ${error.message}`)
    console.error('set CHROME_PATH to a Chrome or Chromium executable')
    process.exit(2)
  })
  return child
}
