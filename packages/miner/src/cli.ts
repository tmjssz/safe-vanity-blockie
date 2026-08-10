#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  compileFace,
  getTemplate,
  parseFaceSpec,
  TEMPLATES,
  type Candidate,
  type FaceSpec,
} from '@safe-vanity-blockie/core'
import { CliError, HELP_TEXT, parseArgs, type MineArgs } from './args.js'
import { WORKER_BLOCK, createPool, type PoolProgress } from './pool.js'
import {
  asciiFor,
  buildResultStrip,
  resultColumnsForWidth,
  buildGalleryHtml,
  buildResultsJson,
  filterCandidates,
  formatDuration,
  formatScore,
  formatLeaderboard,
  type ResultConfig,
} from './report.js'
import { loadSafeConstants, verifyWithProtocolKit } from './setup.js'

/** A builtin template name, or a path to a FaceSpec JSON file. */
export function resolveFaceSpec(target: string): FaceSpec {
  if (Object.hasOwn(TEMPLATES, target)) return getTemplate(target)
  if (!target.includes('/') && !target.endsWith('.json')) return getTemplate(target) // throws with the list

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
  selection: { twoColor: boolean; minContrast: number; keep: number },
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

export interface SelectReportedResult {
  reported: Candidate[]
  /** Candidates removed by --two-color / --min-contrast filtering; 0 when the fallback fired. */
  droppedCount: number
  /** True when filtering would have emptied the list, so the unfiltered candidates were used. */
  usedFallback: boolean
}

/**
 * Applies --two-color / --min-contrast filtering to the over-retained leaderboard, falls back to
 * the unfiltered list if filtering would empty it, and trims to --keep. Pure and independent of
 * the network so it can be unit tested directly.
 */
export function selectReported(
  candidates: Candidate[],
  options: { twoColor: boolean; minContrast: number; keep: number },
): SelectReportedResult {
  const filtered = filterCandidates(candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
  })
  const usedFallback = filtered.length === 0 && candidates.length > 0
  const usable = usedFallback ? candidates : filtered
  const droppedCount = usedFallback ? 0 : candidates.length - filtered.length
  return { reported: usable.slice(0, options.keep), droppedCount, usedFallback }
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

  const perWorker = Number.isFinite(options.maxIterations)
    ? Math.ceil(options.maxIterations / options.workers)
    : WORKER_BLOCK
  const budget = Number.isFinite(options.maxIterations)
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
    keep: RESULT_COLUMNS,
  }
  let loggedBestScore = -1

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
      const best = progress.best[0]
      if (best && best.score > loggedBestScore) {
        loggedBestScore = best.score
        lastLoggedAt = now
        process.stderr.write(
          `${buildProgressBlock(progress, liveSelection, columnsFor(process.stderr)).join('\n')}\n`,
        )
      } else if (now - lastLoggedAt >= PROGRESS_LOG_INTERVAL_MS) {
        lastLoggedAt = now
        process.stderr.write(`${progressLineText(progress, progress.best[0])}\n`)
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
  // a wedged run. Honour the first interrupt as a graceful stop and let the second one through.
  let interrupted = false
  const onSigint = () => {
    if (interrupted) {
      process.stderr.write('\nInterrupted again; exiting without saving results.\n')
      process.off('SIGINT', onSigint)
      process.kill(process.pid, 'SIGINT')
      return
    }
    interrupted = true
    // Erase the live block before writing beneath it. Otherwise these lines land between the
    // cursor and the block, and every later cursor-up count is short by that many rows --
    // leaving stale block rows stranded above the final report.
    eraseLiveBlock()
    process.stderr.write('\nStopping workers, keeping the best results found so far…\n')
    process.stderr.write('Press Ctrl+C again to quit immediately and discard them.\n')
    pool.stop()
  }
  process.on('SIGINT', onSigint)

  let result
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
      process.stderr.write(`${progressLineText(lastProgress, lastProgress.best[0])}\n`)
    }
  }

  const { reported, droppedCount, usedFallback } = selectReported(result.candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
    keep: options.keep,
  })

  if (usedFallback) {
    process.stderr.write(
      'No result passed the --two-color / --min-contrast filters; showing unfiltered results.\n',
    )
  } else if (droppedCount > 0) {
    const criteria = [
      options.twoColor ? '--two-color' : undefined,
      options.minContrast > 0 ? '--min-contrast' : undefined,
    ].filter((criterion): criterion is string => criterion !== undefined)
    process.stderr.write(
      `Dropped ${droppedCount.toLocaleString('en-US')} candidate${droppedCount === 1 ? '' : 's'} that failed ${criteria.join(' / ')}.\n`,
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

  if (options.out) {
    writeFileSync(options.out, buildResultsJson(config, reported))
    process.stdout.write(`\nWrote ${options.out}\n`)
  }
  if (options.gallery) {
    writeFileSync(options.gallery, buildGalleryHtml(config, reported))
    process.stdout.write(`Wrote ${options.gallery}\n`)
  }

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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
