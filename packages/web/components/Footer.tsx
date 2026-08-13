import { formatBuildVersion } from '../lib/build-info'
import packageJson from '../package.json'

const REPO_URL = 'https://github.com/tmjssz/safe-vanity-blockie'

// Shared `target="_blank"` attributes for every off-site link below, so a reviewer can see at a
// glance that each one carries `rel="noopener noreferrer"` rather than checking five call sites.
const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  className: 'underline-offset-4 hover:text-foreground hover:underline',
} as const

/**
 * The app's footer: on every route, in normal document flow at the end of the page, below a
 * results grid that can run to 200 cards. It needs no z-index — nothing here is positioned, so it
 * cannot contest the sticky header, the sticky mining bar (`top-14 z-40`) or the deploy dialog's
 * backdrop (`z-45`).
 */
export function Footer() {
  // `VERCEL_GIT_COMMIT_SHA` only exists on a Vercel build; a local build has no SHA at all, and
  // that has to render as the version alone rather than as `undefined` or a dangling separator —
  // see formatBuildVersion.
  const version = formatBuildVersion(packageJson.version, process.env.VERCEL_GIT_COMMIT_SHA)

  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6 text-sm text-muted-foreground">
        {/* Plain and legible, not fine print: same size as the rest of the footer, and in the
            page's normal foreground colour rather than muted, so it reads as a statement and not
            as an aside. This exists so nobody reads Safe as vouching for an address this tool
            produced — the app is named after Safe and deploys real Safes, but the repo is not
            under a Safe-owned account. */}
        <p className="font-medium text-foreground">Not an official Safe product.</p>
        <p>
          {/* "Nothing leaves your browser" would be false: the app reads public RPCs for Safe's
              contract constants, and a deploy sends a transaction through the connected wallet.
              Both are named here rather than glossed over — mining itself is the only part that
              is genuinely local, and it is the only part this sentence claims is. */}
          Mining runs entirely in your browser, across your own machine&rsquo;s worker threads.
          The only network activity is the public RPC calls used to read Safe&rsquo;s contract
          constants, and — if you choose to deploy — the transaction sent through your connected
          wallet. No analytics, no telemetry.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a href={REPO_URL} {...EXTERNAL_LINK_PROPS}>
            GitHub
          </a>
          <span>
            Identicons by{' '}
            {/* github.com/download/blo — the guess this footer's brief started from — 404s; blo's
                actual repository is bpierre/blo, confirmed to resolve before shipping this. */}
            <a href="https://github.com/bpierre/blo" {...EXTERNAL_LINK_PROPS}>
              blo
            </a>
          </span>
          <a href="https://safe.global" {...EXTERNAL_LINK_PROPS}>
            safe.global
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} {...EXTERNAL_LINK_PROPS}>
            MIT License
          </a>
        </div>
        <p className="text-xs">{version}</p>
      </div>
    </footer>
  )
}
