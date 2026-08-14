import { Info } from 'lucide-react'
import { buildVersionHref, formatBuildVersion } from '../lib/build-info'
import { cn } from '../lib/utils'
import packageJson from '../package.json'
import { AboutDialog } from './AboutDialog'
import { PrivacyNote } from './PrivacyNote'
import { Button } from './ui/button'

const REPO_URL = 'https://github.com/tmjssz/safe-vanity-blockie'

// Shared `target="_blank"` attributes for every off-site link below, so a reviewer can see at a
// glance that each one carries `rel="noopener noreferrer"` rather than checking five call sites.
const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  className: 'underline-offset-4 hover:text-foreground hover:underline',
} as const

/**
 * The GitHub mark, inline, because lucide-react v1 removed its brand icons — `Github` is no longer
 * an export, and importing it renders `undefined`. The mark is what makes the link scannable at
 * this size, so it is worth the 40 bytes of path data rather than dropping to a generic glyph.
 */
function GithubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 fill-current"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/**
 * The app's footer: on every route, in normal document flow at the end of the page, below a
 * results grid that can run to 200 cards. It needs no z-index — nothing here is positioned, so it
 * cannot contest the sticky header, the sticky mining bar (`top-14 z-40`) or the deploy dialog's
 * backdrop (`z-45`).
 *
 * A single line: what the app is built on and disclaims, then the things you might want to open.
 * The privacy note is the exception — it is collapsed behind the shield because it is a
 * paragraph, and a paragraph would make this footer something to read rather than glance at.
 */
export function Footer() {
  // `VERCEL_GIT_COMMIT_SHA` only exists on a Vercel build; a local build has no SHA at all, and
  // that has to render as the version alone rather than as `undefined` or a dangling separator —
  // see formatBuildVersion.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  const version = formatBuildVersion(packageJson.version, sha)
  const versionHref = buildVersionHref(REPO_URL, packageJson.version, sha)

  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* One sentence, not two. The credit is what makes the disclaimer necessary — the app is
              named after Safe and deploys real Safes, but the repo is not under a Safe-owned
              account — so binding them means a reader who takes in "Built on Safe" has already
              been handed "not an official Safe product". It is plain text at the footer's largest
              size, never behind a hover or a toggle: a disclaimer you have to open is one nobody
              reads. That rule holds even as the privacy note beside it lives in a popover. */}
          <p className="text-sm">
            Built on{' '}
            <a
              href="https://safe.global"
              {...EXTERNAL_LINK_PROPS}
              className={cn(EXTERNAL_LINK_PROPS.className, 'text-foreground/80')}
            >
              Safe
            </a>{' '}
            · not an official Safe product
          </p>
          <div className="flex items-center gap-4 text-sm">
            {/* The same explanation the Configure card links to, reachable from anywhere. That
                matters most where the card is not: it is unmounted for the whole of a run, so
                without this the only route to "what is this app" disappears the moment someone
                starts using it. Grouped with the shield because both are icon-only affordances
                that open a panel of prose. */}
            <AboutDialog
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="About this app"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info aria-hidden="true" />
                </Button>
              }
            />
            <PrivacyNote />
            <a href={`${REPO_URL}/blob/main/LICENSE`} {...EXTERNAL_LINK_PROPS}>
              MIT
            </a>
            {/* Monospace because it is an identifier, not prose, and because a SHA read as prose
                is unreadable. It links to the build it names — see buildVersionHref. */}
            <a
              href={versionHref}
              {...EXTERNAL_LINK_PROPS}
              className={cn(EXTERNAL_LINK_PROPS.className, 'font-mono text-xs')}
            >
              v{version}
            </a>
            <a
              href={REPO_URL}
              {...EXTERNAL_LINK_PROPS}
              className={cn(EXTERNAL_LINK_PROPS.className, 'flex items-center gap-1.5')}
            >
              <GithubMark />
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
