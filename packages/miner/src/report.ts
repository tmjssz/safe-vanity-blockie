import { bloData, bloSvg, type Candidate } from '@safe-vanity-blockie/core'

export interface ResultConfig {
  owners: string[]
  threshold: number
  safeVersion: string
  /** Decimal string; chainId is a bigint and JSON has no bigint. */
  chainId: string
  target: string
  maxScore: number
  start: number
  scanned: number
  nextStart: number
  workers: number
  perWorker: number
  generatedAt: string
  /** Whether the L1 Safe singleton was forced. Changes the singleton, hence the address. */
  isL1SafeSingleton: boolean
  /**
   * Outcome of the top result's cross-check against protocol-kit: 'passed', 'failed' (a genuine
   * mismatch -- treat the results with suspicion), or 'not-performed' (an RPC/network error
   * prevented the check from running at all).
   */
  selfCheck: 'passed' | 'failed' | 'not-performed'
  /** Wall-clock time spent mining, in milliseconds. Excludes RPC setup. */
  elapsedMs: number
}

/**
 * Human-readable duration: "45s", "2m 05s", "1h 02m 05s". Seconds and minutes are
 * zero-padded above their unit so successive progress lines stay aligned.
 */
export function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

const GLYPHS = ['  ', '██', '▒▒'] as const

/** 8 lines of 8 cells. Columns 4-7 mirror columns 3-0, exactly as blo renders them. */
export function renderAscii(data: Uint8Array): string[] {
  const lines: string[] = []
  for (let row = 0; row < 8; row++) {
    let line = ''
    for (let col = 0; col < 8; col++) {
      const source = col < 4 ? col : 7 - col
      line += GLYPHS[data[row * 4 + source]]
    }
    lines.push(line)
  }
  return lines
}

export function filterCandidates(
  candidates: Candidate[],
  filters: { twoColor: boolean; minContrast: number },
): Candidate[] {
  return candidates.filter(
    (candidate) =>
      (!filters.twoColor || candidate.twoColor) && candidate.contrast >= filters.minContrast,
  )
}

function regionSummary(candidate: Candidate): string {
  return Object.values(candidate.regions).join('/') || '-'
}

export function formatLeaderboard(candidates: Candidate[], limit: number): string {
  const header = ' # | score | 2col | contrast | expression | address                                    | saltNonce'
  const rows = candidates.slice(0, limit).map((candidate, index) => {
    return [
      String(index + 1).padStart(2),
      `${candidate.score}/${candidate.maxScore}`.padStart(6),
      (candidate.twoColor ? 'yes' : 'no').padStart(4),
      String(candidate.contrast).padStart(8),
      regionSummary(candidate).padStart(10),
      candidate.address,
      candidate.saltNonce,
    ].join(' | ')
  })
  return [header, '-'.repeat(header.length), ...rows].join('\n') + '\n'
}

export function buildResultsJson(config: ResultConfig, candidates: Candidate[]): string {
  return (
    JSON.stringify(
      {
        config,
        // Region names come from an untrusted FaceSpec (`--target <file>.json`) and are
        // validated only as strings, so the spread goes FIRST: a region named e.g. "saltNonce"
        // must never be able to shadow the fixed, safety-critical fields below it.
        results: candidates.map((candidate) => ({
          ...candidate.regions,
          saltNonce: candidate.saltNonce,
          address: candidate.address,
          score: candidate.score,
          max: candidate.maxScore,
          twoColor: candidate.twoColor,
          contrast: candidate.contrast,
        })),
      },
      null,
      2,
    ) + '\n'
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildGalleryHtml(config: ResultConfig, candidates: Candidate[]): string {
  const cards = candidates
    .map((candidate) => {
      const twoColor = candidate.twoColor ? 'two colours' : 'three colours'
      return `    <figure class="card">
      ${bloSvg(candidate.address, 128)}
      <figcaption>
        <strong>${candidate.score}/${candidate.maxScore}</strong>
        <span>${escapeHtml(regionSummary(candidate))} · ${twoColor} · contrast ${candidate.contrast}</span>
        <code>${escapeHtml(candidate.address)}</code>
        <code>saltNonce ${escapeHtml(candidate.saltNonce)}</code>
      </figcaption>
    </figure>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>safe-vanity-blockie results</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; }
  .warning { border: 1px solid currentColor; padding: .75rem 1rem; border-radius: .5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
  .card { margin: 0; padding: 1rem; border: 1px solid rgba(128,128,128,.4); border-radius: .5rem; }
  .card svg { border-radius: .25rem; display: block; }
  figcaption { display: grid; gap: .25rem; margin-top: .75rem; }
  code { font-size: 12px; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
  dt { font-weight: 600; }
</style>
</head>
<body>
<h1>safe-vanity-blockie results</h1>
<p class="warning"><strong>A matching identicon is cosmetic.</strong> Never treat it as proof of an
address — blockie look-alikes are a known phishing vector. Always verify the full address.</p>
<dl>
  <dt>owners</dt><dd><code>${escapeHtml(config.owners.join(', '))}</code></dd>
  <dt>threshold</dt><dd>${config.threshold}</dd>
  <dt>Safe version</dt><dd>${escapeHtml(config.safeVersion)}</dd>
  <dt>chain id</dt><dd>${escapeHtml(config.chainId)}</dd>
  <dt>target</dt><dd>${escapeHtml(config.target)}</dd>
  <dt>L1 singleton</dt><dd>${config.isL1SafeSingleton ? 'yes' : 'no'}</dd>
  <dt>self-check</dt><dd>${escapeHtml(config.selfCheck)}</dd>
  <dt>scanned</dt><dd>${config.scanned.toLocaleString('en-US')} nonces from ${config.start}</dd>
  <dt>mining time</dt><dd>${escapeHtml(formatDuration(config.elapsedMs))}</dd>
  <dt>resume at</dt><dd><code>--start ${config.nextStart} --workers ${config.workers}</code></dd>
  <dt>generated</dt><dd>${escapeHtml(config.generatedAt)}</dd>
</dl>
<div class="grid">
${cards}
</div>
</body>
</html>
`
}

/** Re-exported so cli.ts can preview a candidate without importing core directly. */
export function asciiFor(address: string): string[] {
  return renderAscii(bloData(address))
}


/** Wide enough that adjacent blockies do not read as one image. */
const RESULT_GUTTER_WIDTH = 4
const RESULT_GUTTER = ' '.repeat(RESULT_GUTTER_WIDTH)
/** A full-size blockie is 8 cells of two characters. */
const RESULT_CELL_WIDTH = 16

/**
 * How many full-size blockies fit side by side in `availableWidth` columns, capped at
 * `maxColumns` and never below 1 — a single blockie may overflow a very narrow terminal,
 * but showing nothing would be worse.
 */
export function resultColumnsForWidth(availableWidth: number, maxColumns: number): number {
  const perColumn = RESULT_CELL_WIDTH + RESULT_GUTTER_WIDTH
  const fits = Math.floor((availableWidth + RESULT_GUTTER_WIDTH) / perColumn)
  return Math.max(1, Math.min(maxColumns, fits))
}

function renderRow(entries: { label: string; face: string[] }[]): string[] {
  const width = Math.max(RESULT_CELL_WIDTH, ...entries.map((entry) => entry.label.length))
  const lines = [entries.map((entry) => entry.label.padEnd(width)).join(RESULT_GUTTER)]
  for (let row = 0; row < 8; row++) {
    lines.push(entries.map((entry) => entry.face[row].padEnd(width)).join(RESULT_GUTTER))
  }
  return lines.map((line) => line.trimEnd().padEnd(lines[0].length))
}

/**
 * The top results drawn at full size, wrapped into as many rows as the terminal width allows.
 * Every blockie is two characters per cell so each pixel stays square — a terminal cell is
 * about twice as tall as it is wide — and no image is ever split across a line break.
 * Ranks start at 1.
 */
export function buildResultStrip(
  candidates: Candidate[],
  options: { maxResults: number; columnsPerRow: number },
): string[] {
  const shown = candidates.slice(0, Math.max(0, options.maxResults))
  if (shown.length === 0) return []

  const entries = shown.map((entry, index) => ({
    label: `#${index + 1} ${entry.score}/${entry.maxScore}`,
    face: asciiFor(entry.address),
  }))

  const perRow = Math.max(1, options.columnsPerRow)
  const lines: string[] = []
  for (let start = 0; start < entries.length; start += perRow) {
    if (start > 0) lines.push('')
    lines.push(...renderRow(entries.slice(start, start + perRow)))
  }
  return lines
}

