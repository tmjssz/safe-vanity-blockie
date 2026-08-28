#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type Candidate,
  compileFace,
  type FaceSpec,
  faceSpecForTarget,
  formatScore,
  parseFaceSpec,
  selectReported,
} from '@safe-vanity-blockie/core'
import { loadSafeConstants, verifyWithProtocolKit } from '@safe-vanity-blockie/safe-config'
import { CliError, HELP_TEXT, type MineArgs, parseArgs } from './args.js'
import { createPool, type PoolProgress, type PoolResult, WORKER_BLOCK } from './pool.js'
import {
  buildGalleryHtml,
  buildResultStrip,
  buildResultsJson,
  defaultOutPath,
  formatDuration,
  formatLeaderboard,
  type ResultConfig,
  resultColumnsForWidth,
} from './report.js'

/**
 * A builtin template name, a comma-separated list of expressions, or a path to a FaceSpec JSON file.
 * The first two are core's to resolve (see `faceSpecForTarget`); only the file case is the CLI's.
 */
export function resolveFaceSpec(target: string): FaceSpec {
  // Anything that is not shaped like a path is a name, and named targets throw with the list of
  // what would have been accepted — so a typo is never read as a missing file, and vice versa.
  if (!target.includes('/') && !target.endsWith('.json')) return faceSpecForTarget(target)

  let text: string
  try {
    text = readFileSync(target, 'utf8')
  } catch (error) {
    throw new CliError(
      `could not read face spec "${target}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new CliError(
      `could not parse face spec "${target}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parseFaceSpec(json)
}

function formatRate(rate: number): string {
  return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M/s` : `${Math.round(rate / 1000)}k/s`
}

function progressLineText(progress: PoolProgress, best: Candidate | undefined): string {
  const summary = best ? `best ${formatScore(best.score, best.maxScore)}` : 'no candidates yet'
  return (
    `${formatDuration(progress.elapsedMs)} · ${progress.scanned.toLocaleString('en-US')} nonces · ` +
    `${formatRate(progress.rate)} · ${summary}`
  )
}

/**
 * Which mine filters are actually excluding something, named as the flags that set them.
 *
 * One list, read by both messages that report exclusions, so they cannot come to name different
 * sets of filters — and so a filter added to `selectReported` cannot leave either message quietly
 * describing the search by the wrong criteria. A flag at its permissive value is left out: naming
 * a filter that excluded nothing sends the reader to relax a control that is not the one holding
 * results back.
 */
export function activeFilterFlags(options: {
  twoColor: boolean
  minContrast: number
  minMatch: number
}): string[] {
  return [
    options.twoColor ? '--two-color' : undefined,
    options.minContrast > 0 ? '--min-contrast' : undefined,
    options.minMatch > 0 ? '--min-match' : undefined,
  ].filter((flag): flag is string => flag !== undefined)
}

/** ANSI: move the cursor up `lines` rows and clear everything from there down. */
function cursorUpAndClear(lines: number): string {
  return lines > 0 ? `\u001b[${lines}A\u001b[0J` : ''
}

/**
 * The live progress display: the current best blockie drawn in the same layout the final
 * report uses, with the status line beneath it. Just the status line until a candidate exists.
 */
export function buildProgressBlock(
  progress: PoolProgress,
  selection: { twoColor: boolean; minContrast: number; minMatch: number; keep: number },
  columnsPerRow: number,
): string[] {
  // Filter live exactly as the final report does, so the faces you watch converge are the
  // ones you end up with -- retention is score-ranked and blind to these flags.
  const { reported } = selectReported(progress.best, selection)
  const strip = buildResultStrip(reported, {
    maxResults: RESULT_COLUMNS,
    columnsPerRow,
  }).map((line) => (line === '' ? '' : `${' '.repeat(OUTPUT_INDENT)}${line}`))
  const status = progressLineText(progress, reported[0])
  // Blank lines above and below set the images apart from whatever surrounds them.
  return strip.length > 0 ? ['', ...strip, '', status] : [status]
}

// Retention is score-ranked and blind to --two-color/--min-contrast, which are applied
// afterwards. Over-retain so filtering has candidates left to show; only two-colour
// blockies are common enough for this to matter (a grid is two-colour only when no cell
// uses the spot colour).
const RETENTION_MULTIPLIER = 20
const MIN_RETENTION = 200

/** How many results are drawn side by side, live and in the final report. */
const RESULT_COLUMNS = 8

/** Every result line is written with this much left indent. */
const OUTPUT_INDENT = 2

/** Assumed width when the stream is piped and reports no size. */
const ASSUMED_WIDTH = 100

/** How many blockies fit side by side on this stream right now. Re-read on every draw so a
 *  terminal resize is picked up without restarting the run. */
function columnsFor(stream: NodeJS.WriteStream): number {
  return resultColumnsForWidth((stream.columns ?? ASSUMED_WIDTH) - OUTPUT_INDENT, RESULT_COLUMNS)
}

/** How long, in ms, a non-TTY progress log may go without a new line while the run continues. */
const PROGRESS_LOG_INTERVAL_MS = 30_000

/**
 * How long after the first interrupt a further SIGINT is treated as a duplicate of the same
 * keypress rather than a second Ctrl+C.
 *
 * One keypress reaches the CLI twice under a launcher that forwards signals (`npm run`, `npx`,
 * `pnpm run`): the terminal signals every process in the foreground group, which includes this
 * one, and the launcher then forwards the signal it received to its child on top of that. The
 * two arrive milliseconds apart, so counting signals read the duplicate as "quit and discard"
 * and threw away the very results the same keypress had just promised to keep. Nobody can read
 * the notice and decide to abandon the run inside a second, so a signal this soon is not a
 * decision -- while a deliberate second Ctrl+C still gets through and still force-quits.
 */
const FORCE_QUIT_GRACE_MS = 1000

/**
 * SIGINT handling for a mine run: the first interrupt stops the workers and keeps their results,
 * a deliberate second one force-quits a run that will not stop. Duplicate deliveries of one
 * keypress are ignored (see `FORCE_QUIT_GRACE_MS`).
 */
export function createInterruptHandler(options: {
  onStop: () => void
  onForceQuit: () => void
  graceMs?: number
  now?: () => number
}): () => void {
  const graceMs = options.graceMs ?? FORCE_QUIT_GRACE_MS
  const now = options.now ?? Date.now
  let interruptedAt: number | undefined
  return () => {
    if (interruptedAt === undefined) {
      interruptedAt = now()
      options.onStop()
      return
    }
    // Measured from the first interrupt, not from the last signal seen, so a run that keeps
    // receiving duplicates cannot push the force-quit out of reach.
    if (now() - interruptedAt < graceMs) return
    options.onForceQuit()
  }
}

/**
 * Writes one output file and reports where it landed, by absolute path.
 *
 * Absolute because the reader is frequently not standing where the run started: the default
 * `--out` is a bare filename, `npm run` moves the cwd to the package root, and a run stopped
 * with Ctrl+C hours later is read in whatever directory the terminal is in now. A relative name
 * leaves them guessing which directory it was relative to.
 *
 * A bad path must not cost a multi-hour run its report, so a failure comes back as a message for
 * the caller to print rather than as a throw. The failure names the absolute path too -- that is
 * usually what makes the reason obvious.
 */
export function writeOutputFile(path: string, contents: string): { ok: boolean; message: string } {
  const absolute = resolve(path)
  try {
    writeFileSync(absolute, contents)
    return { ok: true, message: `Wrote ${absolute}` }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Warning: could not write ${absolute} (${reason}).` }
  }
}

export async function runMine(options: MineArgs): Promise<number> {
  const faceSpec = resolveFaceSpec(options.target)
  const maxScore = compileFace(faceSpec).maxScore

  process.stderr.write(`Reading Safe constants from ${options.rpcUrl}…\n`)
  const setup = await loadSafeConstants({
    rpcUrl: options.rpcUrl,
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    isL1SafeSingleton: options.isL1SafeSingleton,
  })

  const bounded = Number.isFinite(options.maxIterations)
  // Ceil so the ranges cover the whole budget; totalCount below trims the tail workers back so
  // the run scans exactly --max-iterations rather than up to workers-1 nonces past it.
  const perWorker = bounded ? Math.ceil(options.maxIterations / options.workers) : WORKER_BLOCK
  const budget = bounded
    ? `${options.maxIterations.toLocaleString('en-US')} nonces`
    : 'until Ctrl+C'

  process.stderr.write(
    `chain ${setup.chainId} · Safe ${options.safeVersion} · target "${faceSpec.name}" ` +
      `· ${options.workers} workers · ${budget}\n`,
  )

  // Retain far more than --keep so filtering below still has candidates to show.
  const retain = Math.max(options.keep * RETENTION_MULTIPLIER, MIN_RETENTION)

  let lastProgress: PoolProgress | undefined
  let lastLoggedAt = 0
  let drawnLines = 0
  const liveSelection = {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
    minMatch: options.minMatch,
    keep: RESULT_COLUMNS,
  }
  let loggedBestScore = -1

  /** The candidate the live block puts first, i.e. the best one that survives the filters. */
  const liveTop = (progress: PoolProgress): Candidate | undefined =>
    selectReported(progress.best, liveSelection).reported[0]

  /** Moves back over the drawn block and clears it, leaving the cursor where the block began. */
  const eraseLiveBlock = () => {
    process.stderr.write(cursorUpAndClear(drawnLines))
    drawnLines = 0
  }

  /** Redraws the live block in place: up over the previous one, then clear and rewrite. */
  const redraw = (block: string[]) => {
    process.stderr.write(`${cursorUpAndClear(drawnLines)}${block.join('\n')}\n`)
    drawnLines = block.length
  }

  const pool = createPool({
    constantsHex: setup.constantsHex,
    faceSpec,
    start: options.start,
    workers: options.workers,
    perWorker,
    totalCount: bounded ? options.maxIterations : undefined,
    keep: retain,
    onProgress: (progress) => {
      lastProgress = progress
      if (process.stderr.isTTY) {
        redraw(buildProgressBlock(progress, liveSelection, columnsFor(process.stderr)))
        return
      }
      // No terminal to redraw on: emit newline-terminated lines, throttled so a long
      // unattended run does not flood the log. The face is logged only when the best
      // improves, which is bounded by the score range and is the part worth recording.
      const now = Date.now()
      // The filtered top, matching what the block and the final report show. Triggering on the
      // unfiltered progress.best[0] would end the log on a "best" higher than any reported
      // result, and re-log an unchanged face whenever a filtered-out candidate beat it.
      const best = liveTop(progress)
      if (best && best.score > loggedBestScore) {
        loggedBestScore = best.score
        lastLoggedAt = now
        process.stderr.write(
          `${buildProgressBlock(progress, liveSelection, columnsFor(process.stderr)).join('\n')}\n`,
        )
      } else if (now - lastLoggedAt >= PROGRESS_LOG_INTERVAL_MS) {
        lastLoggedAt = now
        process.stderr.write(`${progressLineText(progress, best)}\n`)
      }
    },
  })

  const onResize = () => {
    // Previously drawn lines may have re-wrapped, so the cursor-up count is no longer valid.
    drawnLines = 0
  }
  // On stderr, not stdout: the live block is drawn on stderr, and stdout may be redirected to a
  // file that never emits 'resize'.
  process.stderr.on('resize', onResize)

  // Installing a handler suppresses Node's default terminate, so Ctrl+C alone can no longer kill
  // a wedged run. Honour the first interrupt as a graceful stop and let a later one through.
  const onSigint = createInterruptHandler({
    onStop: () => {
      // Erase the live block before writing beneath it. Otherwise these lines land between the
      // cursor and the block, and every later cursor-up count is short by that many rows --
      // leaving stale block rows stranded above the final report.
      eraseLiveBlock()
      process.stderr.write('\nStopping workers, keeping the best results found so far…\n')
      process.stderr.write('Press Ctrl+C again to quit immediately and discard them.\n')
      pool.stop()
    },
    onForceQuit: () => {
      process.stderr.write('\nInterrupted again; exiting without saving results.\n')
      process.off('SIGINT', onSigint)
      process.kill(process.pid, 'SIGINT')
    },
  })
  process.on('SIGINT', onSigint)

  let result: PoolResult
  try {
    result = await pool.run()
  } finally {
    process.off('SIGINT', onSigint)
    process.stderr.off('resize', onResize)
    if (process.stderr.isTTY) {
      // Erase the live block so the final report below is not a visual duplicate of it.
      eraseLiveBlock()
    } else if (lastProgress) {
      // Always record the final state, even if the throttle above just skipped it.
      process.stderr.write(`${progressLineText(lastProgress, liveTop(lastProgress))}\n`)
    }
  }

  const { reported, droppedCount, usedFallback } = selectReported(result.candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
    minMatch: options.minMatch,
    keep: options.keep,
  })

  const activeFlags = activeFilterFlags(options)
  if (usedFallback) {
    process.stderr.write(
      `No result passed the ${activeFlags.join(' / ')} filter${activeFlags.length === 1 ? '' : 's'}; showing unfiltered results.\n`,
    )
  } else if (droppedCount > 0) {
    process.stderr.write(
      `Dropped ${droppedCount.toLocaleString('en-US')} candidate${droppedCount === 1 ? '' : 's'} that failed ${activeFlags.join(' / ')}.\n`,
    )
  }

  if (reported.length > 0 && reported.length < options.keep) {
    process.stderr.write(
      `Showing ${reported.length} result${reported.length === 1 ? '' : 's'}, fewer than --keep ${options.keep}; ` +
        'that is all the candidates available.\n',
    )
  }

  if (reported.length === 0) {
    process.stdout.write('No candidates found. Try a larger --max-iterations.\n')
    return 1
  }

  const top = reported[0]

  // A multi-hour run must not lose its results to one transient RPC failure here. Distinguish a
  // genuine mismatch (verifyWithProtocolKit's own comparison failed -- the results may be wrong)
  // from any other error (network/RPC -- the check just could not run) and keep going either way,
  // so the leaderboard and --out/--gallery files are always written.
  let selfCheck: 'passed' | 'failed' | 'not-performed'
  try {
    await verifyWithProtocolKit(setup, top.saltNonce, top.address)
    selfCheck = 'passed'
    process.stdout.write(`self-check passed: predictSafeAddress agrees with ${top.address}\n\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('self-check failed')) {
      selfCheck = 'failed'
      process.stderr.write(
        `\n${message}\n` +
          'SELF-CHECK FAILED: predictSafeAddress disagrees with the fast derivation. ' +
          'The results below may be WRONG -- do not deploy without investigating.\n\n',
      )
    } else {
      selfCheck = 'not-performed'
      process.stderr.write(
        `Warning: could not perform the self-check (${message}); continuing without it.\n\n`,
      )
    }
  }

  const reportStrip = buildResultStrip(reported, {
    maxResults: RESULT_COLUMNS,
    columnsPerRow: columnsFor(process.stdout),
  })
  for (const line of reportStrip) {
    process.stdout.write(line === '' ? '\n' : `${' '.repeat(OUTPUT_INDENT)}${line}\n`)
  }
  process.stdout.write('\n')
  process.stdout.write(formatLeaderboard(reported, options.keep))

  const config: ResultConfig = {
    owners: options.owners,
    threshold: options.threshold,
    safeVersion: options.safeVersion,
    chainId: String(setup.chainId),
    target: faceSpec.name,
    maxScore,
    start: options.start,
    scanned: result.scanned,
    nextStart: result.nextStart,
    workers: options.workers,
    perWorker,
    generatedAt: new Date().toISOString(),
    isL1SafeSingleton: options.isL1SafeSingleton ?? false,
    selfCheck,
    elapsedMs: result.elapsedMs,
  }

  // A bad --out path must not cost a multi-hour run its gallery, deploy command and --start
  // resume line. Report the failure and keep going; the results are already on stdout.
  const writeOutput = (path: string, contents: string): void => {
    const { ok, message } = writeOutputFile(path, contents)
    const stream = ok ? process.stdout : process.stderr
    stream.write(`${message}\n`)
  }

  if (options.out || options.gallery) process.stdout.write('\n')
  if (options.out) writeOutput(options.out, buildResultsJson(config, reported))
  if (options.gallery) writeOutput(options.gallery, buildGalleryHtml(config, reported))

  const deployFlags = [
    `--salt ${top.saltNonce}`,
    `--owners ${options.owners.join(',')}`,
    `--threshold ${options.threshold}`,
    `--safe-version ${options.safeVersion}`,
    options.isL1SafeSingleton ? '--l1-singleton' : undefined,
  ].filter((flag): flag is string => flag !== undefined)
  process.stdout.write(
    `\nDeploy the top result:\n  safe-vanity-blockie deploy ${deployFlags.join(' ')} --rpc ${options.rpcUrl}\n`,
  )

  process.stdout.write(
    `\nMined ${result.scanned.toLocaleString('en-US')} nonces in ` +
      `${formatDuration(result.elapsedMs)} (${formatRate((result.scanned / Math.max(1, result.elapsedMs)) * 1000)}).\n`,
  )

  process.stdout.write(
    `\nResume without rescanning:\n  --start ${result.nextStart} --workers ${options.workers}\n`,
  )
  process.stdout.write(
    '\nReminder: a matching identicon is cosmetic. Never trust it as proof of an address.\n',
  )
  return selfCheck === 'failed' ? 1 : 0
}

export async function main(argv: string[]): Promise<number> {
  const defaults = {
    workers: Math.max(1, availableParallelism() - 1),
    deployerKey: process.env.SAFE_VANITY_DEPLOYER_KEY || undefined,
    // Stamped at launch, not when the file is written, so the name marks when the run began --
    // and so the whole run has one name, whatever it does or does not find.
    out: defaultOutPath(new Date()),
  }
  const command = parseArgs(argv, defaults)

  if (command.kind === 'help') {
    process.stdout.write(HELP_TEXT)
    return 0
  }
  if (command.kind === 'deploy') {
    const { runDeploy } = await import('./deploy.js')
    return runDeploy(command.options)
  }
  return runMine(command.options)
}

// Only run when invoked as the executable. Without this guard, importing cli.js from a test
// would execute main() with vitest's own argv and fail on "unknown option".
// argv[1] is resolved through realpath because npm installs bins as symlinks into
// node_modules/.bin, while import.meta.url is always the real path -- comparing them
// unresolved makes `npx safe-vanity-blockie` a silent no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
