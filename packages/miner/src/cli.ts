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
import { WORKER_BLOCK, createPool } from './pool.js'
import {
  asciiFor,
  buildGalleryHtml,
  buildResultsJson,
  filterCandidates,
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
      `(max ${maxScore}) · ${options.workers} workers · ${budget}\n`,
  )

  const pool = createPool({
    constantsHex: setup.constantsHex,
    faceSpec,
    start: options.start,
    workers: options.workers,
    perWorker,
    keep: options.keep,
    onProgress: (progress) => {
      const best = progress.best[0]
      const summary = best ? `best ${best.score}/${best.maxScore}` : 'no candidates yet'
      process.stderr.write(
        `\r${progress.scanned.toLocaleString('en-US')} nonces · ${formatRate(progress.rate)} · ${summary}   `,
      )
    },
  })

  const onSigint = () => {
    process.stderr.write('\nStopping workers, keeping the best results found so far…\n')
    pool.stop()
  }
  process.on('SIGINT', onSigint)

  let result
  try {
    result = await pool.run()
  } finally {
    process.off('SIGINT', onSigint)
    process.stderr.write('\n')
  }

  const filtered = filterCandidates(result.candidates, {
    twoColor: options.twoColor,
    minContrast: options.minContrast,
  })
  const reported: Candidate[] = filtered.length > 0 ? filtered : result.candidates
  if (filtered.length === 0 && result.candidates.length > 0) {
    process.stderr.write(
      'No result passed the --two-color / --min-contrast filters; showing unfiltered results.\n',
    )
  }

  if (reported.length === 0) {
    process.stdout.write('No candidates found. Try a larger --max-iterations.\n')
    return 1
  }

  const top = reported[0]
  await verifyWithProtocolKit(setup, top.saltNonce, top.address)
  process.stdout.write(`self-check passed: predictSafeAddress agrees with ${top.address}\n\n`)

  for (const line of asciiFor(top.address)) process.stdout.write(`  ${line}\n`)
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
  }

  if (options.out) {
    writeFileSync(options.out, buildResultsJson(config, reported))
    process.stdout.write(`\nWrote ${options.out}\n`)
  }
  if (options.gallery) {
    writeFileSync(options.gallery, buildGalleryHtml(config, reported))
    process.stdout.write(`Wrote ${options.gallery}\n`)
  }

  process.stdout.write(
    `\nResume without rescanning:\n  --start ${result.nextStart} --workers ${options.workers}\n`,
  )
  process.stdout.write(
    '\nReminder: a matching identicon is cosmetic. Never trust it as proof of an address.\n',
  )
  return 0
}

export async function main(argv: string[]): Promise<number> {
  const defaults = { workers: Math.max(1, availableParallelism() - 1) }
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
