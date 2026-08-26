import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigForm } from '../components/ConfigForm'
import { DEFAULT_FACE_FILTERS, maxStartNonce } from '../lib/config'

// Hoisted so each test can drive its own connection state — a module-scoped factory can only ever
// return one fixed state, and the prefill below is defined entirely by how that state CHANGES.
const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }))

vi.mock('wagmi', () => ({ useAccount: useAccountMock }))

/** The default for every test that is not about the wallet: nothing connected, nothing prefilled. */
beforeEach(() => {
  useAccountMock.mockReset().mockReturnValue({ address: undefined, isConnected: false })
})

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const OWNER_B = '0x' + '22'.repeat(20)
const OWNER_C = '0x' + '33'.repeat(20)
const WALLET = '0x' + '99'.repeat(20)

/** The nth owner field, by the accessible name a screen reader hears. */
const ownerField = (n: number) =>
  screen.getByLabelText(new RegExp(`^owner ${n}$`, 'i')) as HTMLInputElement
/**
 * The primary control, found by identity rather than by name: its label IS the validation message
 * now, so a name-based query would stop finding it exactly when the form is invalid, which is when
 * most of these tests want it.
 */
const startButton = () => document.querySelector('[data-slot="start-mining"]') as HTMLButtonElement
const startNonceField = () => screen.getByLabelText(/^checkpoint$/i) as HTMLInputElement
const addOwner = () => screen.getByRole('button', { name: /add another owner/i })
/** Radix renders the threshold Select as a combobox, not a native select. */
const thresholdTrigger = () => screen.getByRole('combobox', { name: /threshold/i })

/** Opens the threshold Select and reads the options it actually offers. */
async function thresholdOptions(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(thresholdTrigger())
  const options = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '')
  await user.keyboard('{Escape}')
  return options
}

async function chooseThreshold(
  user: ReturnType<typeof userEvent.setup>,
  value: number,
): Promise<void> {
  await user.click(thresholdTrigger())
  await user.click(await screen.findByRole('option', { name: String(value) }))
}

/** The props that mount the Filter card inside Advanced. Omitted, the disclosure holds the field alone. */
const filterProps = () => ({
  mouths: ['smile', 'open'],
  filters: DEFAULT_FACE_FILTERS,
  onMouthsChange: vi.fn(),
  onFiltersChange: vi.fn(),
})
const filterToggle = () => screen.getByRole('button', { name: /^filter$/i })

describe('the filter card on the start screen', () => {
  // The expressions and the colour filters decide what the miner credits and what the grid shows.
  // Before this they were unreachable until a run existed, so a resume link's recipient pressed
  // Start on a search they could not see.
  //
  // Above the Advanced disclosure, not inside it: this is not an advanced question, and a
  // disclosure would hide the very values a link was sent to communicate. So it is reachable with
  // nothing pressed.
  it('is offered without anything having to be opened first', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    expect(filterToggle()).toBeDefined()
  })

  it('is absent when the host passes no filters', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^filter$/i })).toBeNull()
  })

  // Three arrival states, told apart. A link that named filters has something to show, so the card
  // opens; a link that named only a checkpoint has the field to show and nothing else; an ordinary
  // visit has neither and both stay out of the way.
  it('opens itself when a link carried filters', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 42 }}
        linkNarrowedFilters
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(filterToggle().getAttribute('aria-expanded')).toBe('true')
  })

  // The two disclosures are independent now that they hold different things. A link that names a
  // target but no checkpoint is only reachable by hand-editing — `resumeSearchPath` always writes
  // all five params — but it pins the rule: opening Advanced for it would present an empty field as
  // though it had something to say.
  it('opens itself when a link narrowed the search but carried no checkpoint', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        linkNarrowedFilters
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(filterToggle().getAttribute('aria-expanded')).toBe('true')
    // And the checkpoint line stays a line: nothing was carried for it to show.
    expect(revealAction()).toBeDefined()
  })

  it('stays shut when a link carried only a checkpoint', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 42 }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(filterToggle().getAttribute('aria-expanded')).toBe('false')
    // The checkpoint it did carry is on screen, without anything being pressed.
    expect(checkpointField().value).toBe('42')
  })

  it('stays shut on an ordinary visit', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    expect(filterToggle().getAttribute('aria-expanded')).toBe('false')
  })

  // Its header still reads as a quiet line rather than a card heading, which is what keeps it a peer
  // of the checkpoint line below rather than announcing itself as the more important of the two.
  // The card's padding is a separate matter now that the section has a background to fill.
  it('keeps its header in the quiet voice', () => {
    const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    const row = container.querySelector('[data-slot="card-header"]') as HTMLElement
    const glyphs = [...row.children].filter((child) => child.tagName.toLowerCase() === 'svg')
    // One glyph, and it is the chevron — against the label, as Advanced's is, rather than a filter
    // icon in front and a chevron thrown to the far edge.
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0].getAttribute('data-slot')).toBe('filter-chevron')
    expect(glyphs[0].getAttribute('class')).not.toContain('ml-auto')
  })

  // A tinted block, so the section reads as one thing rather than two rows that happen to be
  // adjacent. Background only: a border inside a bordered card is two outlines a few pixels apart,
  // and the tint alone is enough to say "this is a group".
  it('sits on its own tint, wrapping the title row as well as the panel', async () => {
    const user = userEvent.setup()
    const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    expect(card.className).toMatch(/bg-muted/)
    expect(card.className).toContain('border-0')
    expect(card.className).toContain('shadow-none')

    // Collapsed, the tint is still there: it wraps the header, not just the panel below it. Radix
    // unmounts a closed panel, so if the padding lived on the content this row would sit on nothing.
    expect(filterToggle().getAttribute('aria-expanded')).toBe('false')
    expect(card.contains(filterToggle())).toBe(true)
    expect(card.className).toMatch(/(^|\s)p[xy]?-/)

    // And open, the same block simply grows.
    await user.click(filterToggle())
    expect(container.querySelector('[data-slot="card"]')?.className).toMatch(/bg-muted/)
  })

  // Card carries no horizontal padding itself — its header and content each carry their own `px-6`
  // — so a bare `px-0` on the card would be inert and this section's text would sit indented from
  // everything around it. On a card stripped of its border that reads as a mistake, not as nesting.
  it('sits flush with the fields around it rather than indented', () => {
    const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    // A class contract, not a measurement: jsdom loads no stylesheet, so `getComputedStyle` here
    // knows nothing about what any Tailwind class means and would report an empty padding whether
    // the rule were present or absent. What can be held on to is that the neutralising rules reach
    // the card at all — a bare `px-0` would not, which is the mistake being guarded against.
    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    expect(card.className).toContain('[&_[data-slot=card-header]]:px-0')
    expect(card.className).toContain('[&_[data-slot=card-content]]:px-0')
  })
})

const revealAction = () => screen.getByRole('button', { name: /continue from a checkpoint/i })
const clearCheckpoint = () => screen.getByRole('button', { name: /clear the checkpoint/i })
const checkpointField = () => screen.getByLabelText(/^checkpoint$/i) as HTMLInputElement
const EXPLANATION = /each saltNonce produces one candidate address/i

describe('reporting the draft upward', () => {
  // The page keeps the address bar in step with the form, and it can only do that if the form tells
  // it what it holds. Validation runs here exactly as submit runs it, so the page never has to guess
  // whether what it is about to write would have been accepted.
  it('reports a config only once the owners validate', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} onDraftChange={onDraftChange} />)

    // A blank form has no config to report, but still reports.
    expect(onDraftChange).toHaveBeenCalledWith({ config: undefined, start: 0 })

    onDraftChange.mockClear()
    await user.type(ownerField(1), '0xnot-an-address')
    // Every keystroke reports, and none of them carries a config.
    expect(onDraftChange).toHaveBeenCalled()
    for (const [draft] of onDraftChange.mock.calls) expect(draft.config).toBeUndefined()

    onDraftChange.mockClear()
    await user.clear(ownerField(1))
    await user.type(ownerField(1), OWNER)

    const last = onDraftChange.mock.calls.at(-1)?.[0]
    expect(last.config).toEqual({ owners: [OWNER], threshold: 1, safeVersion: '1.4.1', chainId: 1 })
  })

  it('reports the checkpoint, and the default for one still being typed', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    await user.type(startNonceField(), '500')
    expect(onDraftChange.mock.calls.at(-1)?.[0].start).toBe(500)

    // Unparseable is reported as the default rather than withheld: the URL is a draft, and a value
    // still being typed has no business erasing the rest of it.
    onDraftChange.mockClear()
    await user.clear(startNonceField())
    await user.type(startNonceField(), '4.12e10')
    expect(onDraftChange.mock.calls.at(-1)?.[0].start).toBe(0)
  })

  // The array is rebuilt on every render, so a dependency on it would fire this for renders that
  // changed nothing at all.
  it('does not report again for a render that changed nothing', () => {
    const onDraftChange = vi.fn()
    const props = {
      chainId: 1,
      initial: { owners: [OWNER] },
      onSubmit: vi.fn(),
      onDraftChange,
      ...filterProps(),
    }
    const { rerender } = render(<ConfigForm {...props} />)
    const first = onDraftChange.mock.calls.length

    rerender(<ConfigForm {...props} />)

    expect(onDraftChange.mock.calls.length).toBe(first)
  })
})

describe('the checkpoint field', () => {
  // An accordion for one optional field was a section header, a chevron and a container around a
  // single input. One quiet line does the same work: every run answers the questions above it, and
  // only a resumed run answers this one.
  it('offers one quiet line by default, with no accordion left', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    expect(revealAction()).toBeDefined()
    expect(screen.queryByRole('button', { name: /^advanced$/i })).toBeNull()
    // The field itself is not merely hidden, it is absent.
    expect(screen.queryByLabelText(/^checkpoint$/i)).toBeNull()
    expect(screen.queryByText(EXPLANATION)).toBeNull()
  })

  it('swaps the line for the field, focused, when pressed', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    await user.click(revealAction())

    expect(checkpointField()).toBe(document.activeElement)
    // Swapped in place, not added beside.
    expect(screen.queryByRole('button', { name: /continue from a checkpoint/i })).toBeNull()
  })

  // The explanation the field used to carry under it, now one press away, as the filter labels do.
  // The explanation used to be a standing caption under the field. Behind the info control it costs
  // one press the first time and nothing after that, which is what the filter labels already do.
  it('carries the whole explanation behind the info control, with nothing standing under the field', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    await user.click(revealAction())

    // Closed, the sentence is in the tree exactly once, and that copy is sr-only: nothing is on
    // screen under the field for a sighted reader to scroll past.
    const before = screen.getAllByText(EXPLANATION)
    expect(before).toHaveLength(1)
    expect(before[0].className).toContain('sr-only')

    await user.click(screen.getByRole('button', { name: /about the starting saltnonce/i }))

    const visible = (await screen.findAllByText(EXPLANATION)).filter(
      (node) => !node.className.includes('sr-only'),
    )
    expect(visible).toHaveLength(1)
  })

  // Radix unmounts a popover's content while closed, so `aria-describedby` cannot point at it. The
  // field keeps a real description either way.
  it('keeps the explanation as the field’s description for assistive tech', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    await user.click(revealAction())

    const described = checkpointField().getAttribute('aria-describedby') as string
    expect((document.getElementById(described) as HTMLElement).textContent).toMatch(EXPLANATION)
  })

  // The reserved line the complaint used to hold was 20px of permanent gap directly above the Start
  // button, appearing exactly when the field was revealed and nothing was wrong.
  it('reserves no space above Start for a complaint it does not have', async () => {
    const user = userEvent.setup()
    const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    await user.click(revealAction())

    const alert = container.querySelector('[role="alert"][id$="start-nonce-error"]') as HTMLElement
    // Mounted, so the live region is in the tree before it speaks...
    expect(alert).not.toBeNull()
    // ...but taking no room while it has nothing to say.
    expect(alert.className).toContain('empty:hidden')
    expect(alert.className).not.toContain('min-h-')
  })

  it('clears to the default and collapses when the x is pressed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 41_200_000_000 }}
        onSubmit={onSubmit}
        {...filterProps()}
      />,
    )

    await user.click(clearCheckpoint())

    expect(revealAction()).toBeDefined()
    expect(screen.queryByLabelText(/^checkpoint$/i)).toBeNull()

    await user.click(startButton())
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), { start: 0 })
  })

  // A value restored from a share link or a previous session is on screen without being asked for:
  // it silently moves where the search begins, so it can never be behind a press.
  it('renders the field directly when a non-default value is already set', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 60_000_016_650_000 }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(screen.queryByRole('button', { name: /continue from a checkpoint/i })).toBeNull()
    expect(checkpointField().value).toBe('60,000,016,650,000')
  })

  it('leaves the line in place for the default value, which 0 is', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 0 }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(revealAction()).toBeDefined()
  })

  // Separators are for reading. The value underneath is a plain integer, which is what the CLI's
  // `--start` and the resume link both take.
  it('strips separators as they are typed and puts them back on blur', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={onSubmit}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    await user.type(checkpointField(), '60,000,016,650,000')

    // Focused: the digits, unseparated, so the caret is not fighting commas that move.
    expect(checkpointField().value).toBe('60000016650000')

    await user.tab()
    expect(checkpointField().value).toBe('60,000,016,650,000')

    await user.click(startButton())
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), { start: 60_000_016_650_000 })
  })

  // Once asked for it stays until the x says otherwise. Collapsing an empty field on blur took it
  // away from under whatever was clicked next — the info icon beside it blurs the input, so pressing
  // the field's own tooltip unmounted both, mid-click.
  it('treats an empty field as the default and keeps it on screen', async () => {
    const user = userEvent.setup()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    // Empty and focused: still on screen, because the reader is in it.
    expect(checkpointField()).toBe(document.activeElement)
    expect(checkpointField().value).toBe('')
    expect(startButton().hasAttribute('disabled')).toBe(false)
  })

  it('refuses anything that is not a non-negative integer', async () => {
    const user = userEvent.setup()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    await user.type(checkpointField(), '4.12e10')
    await user.tab()

    expect(screen.getByText(/digits only/i)).toBeDefined()
    expect((startButton() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the primary control and the checkpoint offer beneath it', () => {
  // Exactly one message, in the order the reader can act on them: an owner is needed before the
  // expressions matter.
  it('names the owner requirement ahead of the expressions one', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} mouths={[]} />)

    expect(startButton().textContent).toMatch(/add an owner to start/i)
    expect(startButton().textContent).not.toMatch(/expression/i)
  })

  it('names the expressions once the owner is satisfied', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
        mouths={[]}
      />,
    )

    expect(startButton().textContent).toMatch(/accept at least one expression/i)
    expect(startButton().disabled).toBe(true)
  })

  // Not in the specification's list of two, and here anyway: the button is disabled over an
  // unusable checkpoint either way, and a disabled control reading "Start mining" explains nothing.
  it('names the checkpoint when that is the only thing wrong', async () => {
    const user = userEvent.setup()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    await user.type(startNonceField(), '0x10')

    expect(startButton().textContent).toMatch(/fix the checkpoint to start/i)
    expect(startButton().disabled).toBe(true)
  })

  // Below the button, so reading order is "the thing this card does", then "the one alternative".
  it('offers the checkpoint as a link under the button, in both states', () => {
    const { unmount } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    const link = revealAction()
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    // Invalid: the button carries a message, and the offer is still there.
    expect(startButton().textContent).toMatch(/add an owner to start/i)
    expect(startButton().compareDocumentPosition(link) & following).toBeTruthy()
    // "or" is plain text; only the action is the control.
    expect(link.textContent).toBe('continue from a checkpoint')
    expect(link.parentElement?.textContent).toMatch(/^or continue from a checkpoint$/)
    unmount()

    // Valid: same offer, same place.
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )
    expect(startButton().textContent).toMatch(/^start mining$/i)
    expect(revealAction()).toBeDefined()
  })

  it('is link-styled and centred, with no icon of its own', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    const link = revealAction()
    expect(link.className).toContain('text-primary')
    expect(link.className).toContain('hover:underline')
    expect(link.querySelector('svg')).toBeNull()
    expect(link.parentElement?.className).toContain('text-center')
  })

  it('swaps itself for the field above the button, and comes back with the x', async () => {
    const user = userEvent.setup()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())

    expect(screen.queryByRole('button', { name: /continue from a checkpoint/i })).toBeNull()
    expect(startNonceField()).toBe(document.activeElement)
    // Above the button, between the Filter row and it.
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(startNonceField().compareDocumentPosition(startButton()) & following).toBeTruthy()

    await user.click(clearCheckpoint())

    expect(revealAction()).toBeDefined()
    expect(screen.queryByLabelText(/^checkpoint$/i)).toBeNull()
  })

  // A value that is already set is never behind a press, and an invalid form does not change that:
  // it silently moves where the search begins, so it has to be visible whatever else is wrong.
  it('arrives revealed for a non-default value even with no owner', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ start: 60_000_016_650_000 }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    expect(startNonceField().value).toBe('60,000,016,650,000')
    expect(screen.queryByRole('button', { name: /continue from a checkpoint/i })).toBeNull()
    expect(startButton().textContent).toMatch(/add an owner to start/i)
  })
})

describe('the face expressions section', () => {
  // Always visible, and above the disclosures. What it asks is the other half of what this card is
  // for: which patterns count as a hit. It used to be reachable only by opening the Filter card,
  // which put the most consequential choice on the screen behind the same door as three constraints
  // that cost nothing to change.
  it('is visible with nothing pressed', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    expect(screen.getByRole('heading', { name: /face expressions/i })).toBeDefined()
    expect(screen.getAllByRole('checkbox').length).toBe(5)
  })

  // Order matters: it reads as the last of the questions about what to mine, before the two
  // disclosures that hold refinements.
  it('sits after the Safe version row and before the Filter disclosure', () => {
    const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    const version = screen.getByText(/safe version/i)
    const expressions = screen.getByRole('heading', { name: /face expressions/i })
    const filter = filterToggle()

    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(version.compareDocumentPosition(expressions) & following).toBeTruthy()
    expect(expressions.compareDocumentPosition(filter) & following).toBeTruthy()
    expect(container).toBeDefined()
  })

  // And out of the Filter card, which now holds only the three colour constraints. Two copies of
  // the tiles on one screen would be two controls for one value.
  it('is not inside the Filter disclosure any more', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

    await user.click(filterToggle())

    // Five tiles on the card, not ten: the disclosure contributed none.
    expect(screen.getAllByRole('checkbox').length).toBe(5)
    expect(screen.getByRole('switch', { name: /^two-color$/i })).toBeDefined()
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })
})

// The card states its boundaries with whitespace and section labels. Two rules had crept in: one
// below the owners list and one above the filter section.
it('draws no dividers between its sections', () => {
  const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} {...filterProps()} />)

  expect(container.querySelectorAll('hr')).toHaveLength(0)
})

describe('ConfigForm', () => {
  // Start is disabled for a malformed address, so the complaint cannot wait for a press any more —
  // the row itself has to say so. It still says it in validateMineConfig's own words.
  it('surfaces a validation error instead of submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

    await user.type(ownerField(1), '0xnope')
    await user.tab()

    expect(await screen.findByText(/not a valid address/i)).toBeDefined()
    expect((startButton() as HTMLButtonElement).disabled).toBe(true)
    await user.click(startButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The button gates the two things it can judge per row — nothing typed, and a malformed
  // address. Everything else validateMineConfig judges is still judged BY IT, on submit, and still
  // has to be reported: a pressable button that does nothing and says nothing is the failure mode
  // this whole form is arranged against.
  it('still reports a rejection the button cannot gate, on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

    await user.type(ownerField(1), OWNER)
    await user.click(addOwner())
    await user.type(ownerField(2), OWNER.toLowerCase())

    expect((startButton() as HTMLButtonElement).disabled).toBe(false)
    await user.click(startButton())

    expect(await screen.findByText(/duplicate owner/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid config', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

    await userEvent.type(ownerField(1), OWNER)
    await userEvent.click(startButton())

    expect(onSubmit).toHaveBeenCalledWith(
      {
        owners: [OWNER],
        threshold: 1,
        safeVersion: '1.4.1',
        chainId: 1,
      },
      { start: 0 },
    )
  })

  // The "changing them re-rolls every result" warning is no longer the form's to make: it moved
  // up into the card's subtitle, where it reads as a property of the whole Configure step rather
  // than as a footnote to the owners list. Pinned here so it cannot quietly come back to both
  // places at once — the assertion on the real copy lives in ConfigSection's tests.
  it('leaves the re-roll warning to the card subtitle', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(screen.queryByText(/re-rolls every result/i)).toBeNull()
  })

  // The button starts a search rather than advancing a wizard — there is no second step, and the
  // press is what locks the card and spins up the workers. It says what it starts, because it is
  // now the one high-emphasis control on the card and reads on its own.
  it('labels its submit "Start mining"', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(startButton()).toBeDefined()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull()
  })

  // Replaces "submits the chain chosen from the Radix select". The chain moved to the header, so
  // this form no longer offers one — but it still SUBMITS one, and the config it emits is the only
  // thing that carries the chain into mining, the share link and the deploy. A refactor that
  // dropped the prop on the way through would leave every result mined for whichever chain this
  // file happened to default to.
  it('submits the chain it is given rather than one of its own, and offers no chain field', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={11155111} onSubmit={onSubmit} />)

    expect(screen.queryByRole('combobox', { name: /chain/i })).toBeNull()

    await userEvent.type(ownerField(1), OWNER)
    await userEvent.click(startButton())

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 11155111 }), {
      start: 0,
    })
  })

  // The chain is picked in the header now, so a chain error has no field to sit under — and
  // validateMineConfig can still produce one (zkSync-family chains derive addresses differently,
  // and reject outright). Without somewhere to render it, "Start" would do nothing at all and
  // say nothing about why.
  it('still reports a chain the app cannot mine for, even with no chain field to show it against', async () => {
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={324} onSubmit={onSubmit} />)

    await userEvent.type(ownerField(1), OWNER)
    await userEvent.click(startButton())

    expect(await screen.findByText(/zkSync/i)).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The identicon is the app's whole subject, so the row shows the one the address it holds would
  // produce. It has to be honest about not having one yet: deriving a blockie from a half-typed
  // address would flicker a picture of a Safe that is not being mined.
  describe('the owner row identicon', () => {
    const identicon = () => document.querySelector('[data-slot="owner-identicon"]')
    const placeholder = () => document.querySelector('[data-slot="owner-identicon-placeholder"]')

    it('shows a placeholder while the row is empty', () => {
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(placeholder()).not.toBeNull()
      expect(identicon()).toBeNull()
    })

    it('shows a placeholder while the address is incomplete', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.type(ownerField(1), '0xabc')
      expect(placeholder()).not.toBeNull()
      expect(identicon()).toBeNull()
    })

    it('renders the identicon once the address is valid', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.type(ownerField(1), OWNER)

      const rendered = identicon()
      expect(rendered).not.toBeNull()
      expect(rendered?.querySelector('svg')).not.toBeNull()
      // Decorative: the address is spelled out in the input beside it, and the picture says
      // nothing a screen reader can use.
      expect(rendered?.getAttribute('aria-hidden')).toBe('true')
      expect(placeholder()).toBeNull()
    })
  })

  describe('owner rows', () => {
    // Absent, not disabled. There is always at least one owner (validateMineConfig rejects an
    // empty list), and a lone greyed-out cross is a control offering to do the one thing the form
    // will not allow — on the very first thing a new user sees. The cost is that the row narrows
    // when a second owner is added; `removeOwner` still refuses to drop the last row, so the rule
    // holds where the state changes rather than only in the markup.
    it('starts with exactly one owner field, with nothing offering to remove it', () => {
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1)).toBeDefined()
      expect(screen.queryByLabelText(/^owner 2$/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /remove owner/i })).toBeNull()
    })

    it('brings the remove buttons back as soon as there is more than one row', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.click(addOwner())
      expect(screen.getByRole('button', { name: /^remove owner 1$/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /^remove owner 2$/i })).toBeDefined()

      // …and go again when the list is back down to one.
      await user.click(screen.getByRole('button', { name: /^remove owner 2$/i }))
      expect(screen.queryByRole('button', { name: /remove owner/i })).toBeNull()
    })

    // The whole point of the rework: what is typed into the rows is what is mined. An entry
    // dropped or reordered here is a different Safe address, and every address looks equally
    // arbitrary, so nothing on screen would say so.
    it('submits every owner row, in the order they appear', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      await user.click(addOwner())
      await user.type(ownerField(3), OWNER_C)
      await user.click(startButton())

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: [OWNER, OWNER_B, OWNER_C],
        }),
        { start: 0 },
      )
    })

    // THE LIST-KEYING TRAP. Keyed by array index, React reuses the wrong DOM node when a row is
    // removed and the values appear to jump between rows — so the user mines a Safe they never
    // typed. Removing the middle of three must leave the other two holding exactly their own
    // values, on screen and in what is submitted.
    it('keeps each remaining row on its own value when the middle row is removed', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      await user.click(addOwner())
      await user.type(ownerField(3), OWNER_C)

      await user.click(screen.getByRole('button', { name: /remove owner 2/i }))

      expect(screen.queryByLabelText(/^owner 3$/i)).toBeNull()
      expect(ownerField(1).value).toBe(OWNER)
      expect(ownerField(2).value).toBe(OWNER_C)

      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER, OWNER_C] }), {
        start: 0,
      })
    })

    // A row of identically-named boxes, and a row of bare "Remove" buttons, are unusable to a
    // screen reader: the name has to say WHICH owner.
    it('names every field and every remove button by the owner it belongs to', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.click(addOwner())
      await user.click(addOwner())

      expect(ownerField(1)).toBeDefined()
      expect(ownerField(2)).toBeDefined()
      expect(ownerField(3)).toBeDefined()
      expect(screen.getByRole('button', { name: /^remove owner 2$/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /^remove owner 3$/i })).toBeDefined()
      // Row 1 is removable once it is not the only row: with three owners there is nothing
      // special about the first, and being unable to drop it forces a retype to reorder.
      const first = screen.getByRole('button', { name: /^remove owner 1$/i }) as HTMLButtonElement
      expect(first.disabled).toBe(false)
    })

    // The button that had focus is gone; without this, focus falls to <body> and a keyboard user
    // is dropped to the top of the document mid-form.
    it('moves focus to the row above rather than dropping it to the document', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)

      await user.click(screen.getByRole('button', { name: /remove owner 2/i }))

      expect(document.activeElement).toBe(ownerField(1))
    })

    // The array the link decoded, one field per entry — not a joined string the user has to
    // re-split by hand. Order is part of the address, so this pins it.
    it('prefills one field per owner from a share link, in order', () => {
      render(<ConfigForm chainId={1} initial={{ owners: [OWNER, OWNER_B] }} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
      expect(ownerField(2).value).toBe(OWNER_B)
      expect(screen.queryByLabelText(/^owner 3$/i)).toBeNull()
    })
  })

  // `initial` does not necessarily exist when this form first renders. The page latches a
  // `?config=` on FIRST SIGHT rather than capturing it on the first render — its subtree reaches
  // that render through a Suspense bailout, with a useSearchParams() that may still be empty — so
  // a share link can arrive a render after this mounted. The header's chain follows it either way
  // (it is derived, not seeded); these three fields are the other three inputs the Safe address is
  // derived from, and a form that kept its blanks under a header that had moved would send the
  // recipient to a different Safe with nothing on screen to say so.
  describe('a share link that arrives after the first render', () => {
    it('fills the fields it names', () => {
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe('')

      const initial = { owners: [OWNER, OWNER_B], threshold: 2, safeVersion: '1.3.0' }
      rerender(<ConfigForm chainId={1} initial={initial} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
      expect(ownerField(2).value).toBe(OWNER_B)
      expect(thresholdTrigger().textContent).toBe('2')
      expect(screen.getByRole('combobox', { name: /safe version/i }).textContent).toBe('1.3.0')
    })

    // The wallet prefill is not an answer to the question — it is this form guessing, and the link
    // is the sender's actual config. Reversing that leaves a recipient mining a Safe owned by
    // THEMSELVES under a link that promised someone else's, which is the one case where the blank
    // field would at least have been obvious.
    it('outranks the address the connected wallet prefilled', () => {
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe(WALLET)

      rerender(<ConfigForm chainId={1} initial={{ owners: [OWNER] }} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
    })

    // And the rule the rest of this form is built on still holds: an answer already on screen is
    // never written over.
    it('leaves an address the user has already typed alone', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.type(ownerField(1), OWNER_C)

      rerender(<ConfigForm chainId={1} initial={{ owners: [OWNER] }} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER_C)
    })

    // Once seeded it stays seeded. page.tsx builds a new `initial` object on every render, so
    // anything keyed on its identity would re-apply it forever and undo every edit made after it
    // landed.
    it('does not re-apply itself over an edit made after it landed', async () => {
      const user = userEvent.setup()
      const initial = { owners: [OWNER], threshold: 1, safeVersion: '1.4.1' }
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      rerender(<ConfigForm chainId={1} initial={initial} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe(OWNER)

      await user.clear(ownerField(1))
      await user.type(ownerField(1), OWNER_C)
      // A fresh object with the same contents, exactly as the page hands it over on every render.
      rerender(<ConfigForm chainId={1} initial={{ ...initial }} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER_C)
    })
  })

  describe('threshold', () => {
    // N is the number of owners ACTUALLY ENTERED — a row that has been added but not typed into is
    // not a signer, and validateMineConfig counts the same way (it filters empties before
    // comparing), so this keeps the Select's arithmetic identical to the validator's.
    it('offers exactly 1..N, counting only rows that have an address in them', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.type(ownerField(1), OWNER)
      expect(await thresholdOptions(user)).toEqual(['1'])

      await user.click(addOwner())
      // Added but empty: not a signer, so N does not move.
      expect(await thresholdOptions(user)).toEqual(['1'])

      await user.type(ownerField(2), OWNER_B)
      expect(await thresholdOptions(user)).toEqual(['1', '2'])

      await user.click(addOwner())
      await user.type(ownerField(3), OWNER_C)
      expect(await thresholdOptions(user)).toEqual(['1', '2', '3'])
    })

    it('captions the threshold with the same N', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(screen.getByText(/out of 0 signers/i)).toBeDefined()

      await user.type(ownerField(1), OWNER)
      expect(screen.getByText(/out of 1 signer$/i)).toBeDefined()

      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      expect(screen.getByText(/out of 2 signers/i)).toBeDefined()
    })

    it('submits the threshold chosen from the Select', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      await chooseThreshold(user, 2)
      await user.click(startButton())

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: [OWNER, OWNER_B],
          threshold: 2,
        }),
        { start: 0 },
      )
    })

    // A threshold picked when there were three owners must not survive the removal of one.
    // validateMineConfig rejects `threshold > owners.length`, so the failure mode without this is
    // a "Start" button that appears to do nothing — and the visible value has to be the submitted
    // one at every moment, never a stale number the user cannot see.
    it('clamps a threshold that no longer fits, on screen and in what is submitted', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      await user.click(addOwner())
      await user.type(ownerField(3), OWNER_C)
      await chooseThreshold(user, 3)
      expect(thresholdTrigger().textContent).toContain('3')

      await user.click(screen.getByRole('button', { name: /remove owner 3/i }))

      expect(thresholdTrigger().textContent).toContain('2')
      expect(screen.getByText(/out of 2 signers/i)).toBeDefined()
      expect(await thresholdOptions(user)).toEqual(['1', '2'])

      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: [OWNER, OWNER_B],
          threshold: 2,
        }),
        { start: 0 },
      )
      expect(screen.queryByText(/exceeds/i)).toBeNull()
    })

    // Emptying a row is the other way N shrinks, and it does not go through the remove button.
    it('clamps when an owner is emptied rather than removed', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), OWNER_B)
      await chooseThreshold(user, 2)

      await user.clear(ownerField(2))

      expect(thresholdTrigger().textContent).toContain('1')
      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: [OWNER],
          threshold: 1,
        }),
        { start: 0 },
      )
    })

    // N of zero: there is no valid threshold to offer, so the control is disabled rather than
    // offering a number that cannot be honoured. Start is disabled for the same reason, and the
    // hint under it is what keeps that from being a dead control with no explanation.
    it('disables the threshold until there is an owner, and says why nothing can be started', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      expect((thresholdTrigger() as HTMLButtonElement).disabled).toBe(true)
      expect(startButton().disabled).toBe(true)
      expect(startButton().textContent).toMatch(/add an owner to start/i)

      await user.click(startButton())
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('seeds the threshold from a share link and keeps offering it', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(
        <ConfigForm
          chainId={1}
          initial={{ owners: [OWNER, OWNER_B], threshold: 2 }}
          onSubmit={onSubmit}
        />,
      )

      expect(thresholdTrigger().textContent).toContain('2')
      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          owners: [OWNER, OWNER_B],
          threshold: 2,
        }),
        { start: 0 },
      )
    })
  })

  // Start is gated on exactly the two things this form can judge row by row: whether any owner has
  // been given at all, and whether every owner that HAS been given is a valid address. Both
  // questions are answered by `isOwnerAddress` from lib/config.ts — the same predicate
  // validateMineConfig itself uses — so the button and the validator cannot disagree about what an
  // address is.
  describe('the Start button', () => {
    it('is disabled until an owner is given', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect((startButton() as HTMLButtonElement).disabled).toBe(true)

      await user.type(ownerField(1), OWNER)
      expect((startButton() as HTMLButtonElement).disabled).toBe(false)
    })

    it('is disabled while any owner address is malformed', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), '0xnope')

      expect((startButton() as HTMLButtonElement).disabled).toBe(true)
    })

    // The one most likely to be missed: the row is not corrected, it is deleted. Anything that
    // remembered "this form has had an invalid address in it" rather than reading the rows that
    // are actually there would leave the button dead with nothing on screen to fix.
    it('comes back when a malformed row is removed rather than corrected', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), '0xnope')
      expect((startButton() as HTMLButtonElement).disabled).toBe(true)

      await user.click(screen.getByRole('button', { name: /remove owner 2/i }))

      expect((startButton() as HTMLButtonElement).disabled).toBe(false)
      expect(screen.queryByText(/not a valid address/i)).toBeNull()
      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER] }), {
        start: 0,
      })
    })

    // An unfilled row is not an invalid one. It is the same rule N counts by, so a row that does
    // not count toward N cannot block the button either — and it never reaches the config.
    it('does not hold an added-but-empty row against the user', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())

      expect((startButton() as HTMLButtonElement).disabled).toBe(false)
      expect(screen.queryByText(/not a valid address/i)).toBeNull()

      await user.click(startButton())
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER] }), {
        start: 0,
      })
    })

    // A disabled control with no reason is worse than a button that explains itself when pressed,
    // which is what this replaces — so the reason is on screen, and tied to the button by
    // aria-describedby rather than left as prose that happens to sit nearby.
    // The reason is the button's LABEL now, not a sentence above it tied on by
    // `aria-describedby`. That makes the control's accessible name the reason, which is stronger
    // than a description: a name is read whenever the control is, and there is no second element
    // that can fall out of step with it.
    it('says why it is disabled in its own label', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(startButton().textContent).toMatch(/add an owner to start/i)
      expect(startButton().disabled).toBe(true)

      await user.type(ownerField(1), '0xnope')
      expect(startButton().textContent).toMatch(/fix the owner address above/i)

      await user.clear(ownerField(1))
      await user.type(ownerField(1), OWNER)
      expect(startButton().textContent).toMatch(/^start mining$/i)
      expect(startButton().disabled).toBe(false)
      // And no standing hint line left behind above it.
      expect(screen.queryByText(/to start\.$/)).toBeNull()
    })

    // WHEN the row complains: not on the first keystroke — "0x" is not yet wrong, it is
    // unfinished, and a field that shouts at a half-typed address is the reason people stop
    // reading these messages. It waits until the field is left, and from then on keeps up live so
    // the complaint clears the moment the address is right rather than on another blur.
    it('holds a row complaint until the field is left, then keeps it live', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.type(ownerField(1), '0x11')
      expect(screen.queryByText(/not a valid address/i)).toBeNull()
      // Still gated, though — the button never waits for a blur to tell the truth.
      expect((startButton() as HTMLButtonElement).disabled).toBe(true)

      await user.tab()
      expect(screen.getByText(/not a valid address/i)).toBeDefined()
      expect(ownerField(1).getAttribute('aria-invalid')).toBe('true')
      expect(ownerField(1).getAttribute('aria-describedby')).toBe(
        screen.getByText(/not a valid address/i).id,
      )

      // Live from here: no second blur needed to clear it.
      await user.clear(ownerField(1))
      await user.type(ownerField(1), OWNER)
      expect(screen.queryByText(/not a valid address/i)).toBeNull()
      expect(ownerField(1).getAttribute('aria-invalid')).toBeNull()
    })

    // Measured in a browser first: rendering the complaint into the row pushed that row's trash
    // button 28px down (it is 36px tall) at the instant blur marked the row touched, so mousedown
    // landed on the button and mouseup below it and the click was lost — a user who typed a bad
    // address and reached straight for its bin got nothing. jsdom has no layout, so what is
    // pinned here is the cause: nothing is inserted into or removed from the DOM when a row
    // starts or stops complaining. The slot is always there, holding its line of space.
    it('never inserts or removes an element when a row starts complaining', async () => {
      const user = userEvent.setup()
      const { container } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      // Everything outside an <svg>. The invariant being measured is "nothing on this row moves",
      // and element count is the only proxy for it jsdom can offer (it has no layout, so every
      // getBoundingClientRect is zeros). Identicon internals have to be excluded or the proxy
      // stops tracking the invariant: a row going valid swaps a dashed placeholder for a blockie,
      // which is dozens of <rect>s in place of none — while occupying the identical 32px box, so
      // it moves nothing at all. Counting them would fail a test about layout for a reason that
      // is not about layout. The wrapper span is still counted on both sides, so a swap that DID
      // add or drop a box still trips this.
      const count = () =>
        Array.from(container.querySelectorAll('*')).filter((el) => !el.closest('svg')).length

      // Owner 1 stays malformed and untouched throughout, so the hint beside "Start" is constant
      // and every element this counts belongs to the rows themselves.
      await user.type(ownerField(1), '0xnope')
      await user.click(addOwner())
      await user.type(ownerField(2), '0xbad')
      const quiet = count()

      await user.tab()
      expect(screen.getByText(/"0xbad" is not a valid address/i)).toBeDefined()
      expect(count()).toBe(quiet)

      await user.clear(ownerField(2))
      await user.type(ownerField(2), OWNER)
      expect(screen.queryByText(/"0xbad" is not a valid address/i)).toBeNull()
      expect(count()).toBe(quiet)
    })

    // Each row answers for itself: a complaint attached to the wrong row is the same class of bug
    // as a value attached to the wrong row, and the row identity is what prevents both.
    it('marks only the offending row when the middle one is emptied out', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())
      await user.type(ownerField(2), '0xnope')
      await user.click(addOwner())
      await user.type(ownerField(3), OWNER_C)
      await user.click(ownerField(1))

      expect(screen.getAllByText(/not a valid address/i)).toHaveLength(1)
      expect(ownerField(1).getAttribute('aria-invalid')).toBeNull()
      expect(ownerField(2).getAttribute('aria-invalid')).toBe('true')
      expect(ownerField(3).getAttribute('aria-invalid')).toBeNull()

      await user.click(screen.getByRole('button', { name: /remove owner 2/i }))
      expect(screen.queryByText(/not a valid address/i)).toBeNull()
      expect(ownerField(2).value).toBe(OWNER_C)
      expect(ownerField(2).getAttribute('aria-invalid')).toBeNull()
    })
  })

  // Owners are part of the Safe address, so this writes into an address-determining field without
  // the user typing. What keeps that honest is that it can only ever fill a BLANK — every test
  // below is a variation on "and otherwise it does nothing".
  describe('prefilling owner 1 from the connected wallet', () => {
    it('fills the empty first field when a wallet connects', () => {
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe('')

      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(WALLET)
    })

    // The reconnect wagmi performs on load arrives as an address that is simply already there on
    // the first render, with no click behind it. A returning user should still meet a filled form.
    it('fills it for a wallet that was already connected on mount', () => {
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe(WALLET)
    })

    it('leaves the field empty while no wallet is connected', () => {
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe('')
    })

    it('never overwrites an address the user typed', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.type(ownerField(1), OWNER)

      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
    })

    // A share link's owners are seeded before the wallet is ever consulted. Overwriting one would
    // mine a different Safe than the link named, silently.
    it('never overwrites an address a share link prefilled', () => {
      const { rerender } = render(
        <ConfigForm initial={{ owners: [OWNER] }} chainId={1} onSubmit={vi.fn()} />,
      )
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      rerender(<ConfigForm initial={{ owners: [OWNER] }} chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
    })

    // Only the first row, ever. A second row is somewhere the user chose to put a co-signer.
    it('does not fill a later empty row when owner 1 is occupied', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.type(ownerField(1), OWNER)
      await user.click(addOwner())

      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(OWNER)
      expect(ownerField(2).value).toBe('')
    })

    it('keeps the first address when the wallet switches account', () => {
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe(WALLET)

      useAccountMock.mockReturnValue({ address: OWNER_B, isConnected: true })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(WALLET)
    })

    // The one that decides whether the field can be emptied at all. Refilling on "the field went
    // blank" would make Owner 1 impossible to clear for as long as a wallet is connected.
    it('does not fill it again after the user clears it', async () => {
      const user = userEvent.setup()
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe(WALLET)

      await user.clear(ownerField(1))
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe('')
    })

    // Disconnecting and connecting again is a new connection, not the same one — so the blank it
    // finds is one to fill.
    it('fills it again after a disconnect and reconnect', async () => {
      const user = userEvent.setup()
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      await user.clear(ownerField(1))

      useAccountMock.mockReturnValue({ address: undefined, isConnected: false })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
      expect(ownerField(1).value).toBe('')

      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1).value).toBe(WALLET)
    })

    // The auto-prefill only ever touches a blank owner 1. This action is the manual counterpart:
    // it puts the wallet wherever there is room, including rows the prefill will never reach.
    describe('the "Use connected wallet" action', () => {
      const useWallet = () => screen.getByRole('button', { name: /use connected wallet/i })

      it('is not offered while no wallet is connected', () => {
        render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        expect(screen.queryByRole('button', { name: /use connected wallet/i })).toBeNull()
      })

      // Nothing to add: the prefill has already put this address in owner 1, and a second copy
      // is a duplicate that validateMineConfig rejects. Offering it would be offering an error.
      it('is not offered when the wallet is already an owner', () => {
        useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
        render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        expect(ownerField(1).value).toBe(WALLET)
        expect(screen.queryByRole('button', { name: /use connected wallet/i })).toBeNull()
      })

      it('fills the first empty row', async () => {
        const user = userEvent.setup()
        const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.type(ownerField(1), OWNER)
        await user.click(addOwner())

        useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
        rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.click(useWallet())

        expect(ownerField(1).value).toBe(OWNER)
        expect(ownerField(2).value).toBe(WALLET)
      })

      it('appends a row when every existing one is filled', async () => {
        const user = userEvent.setup()
        const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.type(ownerField(1), OWNER)

        useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
        rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.click(useWallet())

        expect(ownerField(1).value).toBe(OWNER)
        expect(ownerField(2).value).toBe(WALLET)
      })

      it('never overwrites a filled row', async () => {
        const user = userEvent.setup()
        const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.type(ownerField(1), OWNER)
        await user.click(addOwner())
        await user.type(ownerField(2), OWNER_C)

        useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
        rerender(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
        await user.click(useWallet())

        expect(ownerField(1).value).toBe(OWNER)
        expect(ownerField(2).value).toBe(OWNER_C)
        expect(ownerField(3).value).toBe(WALLET)
      })
    })

    it('submits the prefilled address as the owner', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      useAccountMock.mockReturnValue({ address: WALLET, isConnected: true })
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      await user.click(startButton())

      expect(onSubmit).toHaveBeenCalledOnce()
      expect(onSubmit.mock.calls[0][0].owners).toEqual([WALLET])
    })
  })
})

describe('ConfigForm: start from saltNonce', () => {
  // Pinned so the bound, and the message that names it, are the same on every machine that runs
  // this suite. Two workers of hardware means one worker of pool (one core stays with the UI).
  beforeEach(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true })
  })

  // The first screen a new visitor sees is owners, threshold, version, Start. This field is for
  // the returning user resuming a search, so it is reachable rather than present.
  it('keeps the field behind a collapsed disclosure', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(revealAction()).toBeDefined()
    expect(screen.queryByLabelText(/^start from saltnonce$/i)).toBeNull()
  })

  it('submits 0 for a field nobody opened', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)
    await user.type(ownerField(1), OWNER)
    await user.click(startButton())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER] }), {
      start: 0,
    })
  })

  it('carries a typed start through as a number, beside the config rather than inside it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)
    await user.type(ownerField(1), OWNER)
    await user.click(revealAction())
    await user.type(startNonceField(), '41200000000')
    await user.click(startButton())
    const [config, run] = onSubmit.mock.calls[0]
    expect(run).toEqual({ start: 41_200_000_000 })
    // The address is derived from the config, and `?config=` encodes exactly that object. A start
    // that leaked into it would travel in every share link.
    expect(config).not.toHaveProperty('start')
  })

  // Blur-then-live, the same schedule the owner rows are on: denouncing "4" as invalid while it
  // is still being typed is how people learn to ignore these messages.
  it('complains about a malformed value once the field has been left, and blocks Start', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ConfigForm chainId={1} onSubmit={onSubmit} />)
    await user.type(ownerField(1), OWNER)
    await user.click(revealAction())
    await user.type(startNonceField(), '4.12e10')
    expect(startNonceField().getAttribute('aria-invalid')).toBeNull()
    await user.tab()
    expect(await screen.findByText(/digits only/i)).toBeDefined()
    expect(startNonceField().getAttribute('aria-invalid')).toBe('true')
    expect((startButton() as HTMLButtonElement).disabled).toBe(true)
    await user.click(startButton())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('names the limit, and the worker count it depends on, when the value is too high', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    await user.type(ownerField(1), OWNER)
    await user.click(revealAction())
    // One worker on this machine, so the ceiling is MAX_SAFE_INTEGER - WORKER_BLOCK.
    await user.type(startNonceField(), String(maxStartNonce(1) + 1))
    await user.tab()
    const complaint = await screen.findByText(/enter at most/i)
    expect(complaint.textContent).toContain(maxStartNonce(1).toLocaleString('en-US'))
    expect(complaint.textContent).toContain('1 worker')
  })

  it('clears the complaint, and the block, as soon as the value is corrected', async () => {
    const user = userEvent.setup()
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    await user.type(ownerField(1), OWNER)
    await user.click(revealAction())
    await user.type(startNonceField(), '1.5')
    await user.tab()
    expect((startButton() as HTMLButtonElement).disabled).toBe(true)
    await user.clear(startNonceField())
    await user.type(startNonceField(), '500')
    expect(screen.queryByText(/digits only/i)).toBeNull()
    expect((startButton() as HTMLButtonElement).disabled).toBe(false)
  })

  // "Start over" brings the form back holding what it was mining, and the start is part of that:
  // retyping an eleven-digit resume point is exactly the work this feature exists to avoid.
  it('opens already holding a seeded start, with the field revealed', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 41_200_000_000 }}
        onSubmit={vi.fn()}
      />,
    )
    expect(startNonceField().value).toBe('41,200,000,000')
  })

  // A seeded 0 is the same thing as an untouched field, and opening the disclosure to show a zero
  // would advertise a setting nobody chose.
  it('stays collapsed for a seeded 0', () => {
    render(<ConfigForm chainId={1} initial={{ owners: [OWNER], start: 0 }} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText(/^start from saltnonce$/i)).toBeNull()
  })

  // The complaint explains why Start is refused, so the field it belongs to cannot go away while it
  // stands. Nothing special enforces that any more: an invalid value is a non-empty one, and a
  // non-empty field is its own reason to be on screen.
  it('keeps the field on screen while its value is being complained about', async () => {
    const user = userEvent.setup()
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER] }}
        onSubmit={vi.fn()}
        {...filterProps()}
      />,
    )

    await user.click(revealAction())
    await user.type(startNonceField(), '0x10')
    await user.tab()

    expect(screen.getByText(/digits only/i)).toBeDefined()
    expect(startNonceField()).toBeDefined()
    expect(screen.queryByRole('button', { name: /continue from a checkpoint/i })).toBeNull()
  })
})

// A resume link's checkpoint comes from whatever machine reached it, and `maxStartNonce` falls as
// cores rise: a value a 4-core sender could legitimately start from can be over a 16-core
// recipient's ceiling. The button already refuses it — the gate reads `startNonce.error` directly,
// not the touched-gated complaint — so the only thing missing was the sentence saying why, at the
// field the disabled button's caption points to.
describe('a seeded start nonce this machine cannot take', () => {
  // Number.MAX_SAFE_INTEGER is over the ceiling on any machine: maxStartNonce is
  // `MAX_SAFE_INTEGER - workers * WORKER_BLOCK`, and plannedWorkerCount() floors the pool at 1, so
  // the ceiling is always strictly below it. No worker-count stubbing needed.
  it('shows the complaint immediately, with the field revealed and Start refused', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: Number.MAX_SAFE_INTEGER }}
        onSubmit={vi.fn()}
      />,
    )

    // Queried by its words, not by `role="alert"`. This form renders six alert elements and at
    // least two of them are ALWAYS in the tree — the start-nonce complaint and each owner row's
    // are reserved-space live regions, empty when silent, so that a message appearing cannot move
    // the control below it. `getByRole('alert')` therefore throws on multiple matches and
    // `queryByRole('alert')` is never null; neither says anything about this complaint.
    expect(screen.getByText(/enter at most/i)).toBeDefined()
    // Grouped, because the field is not focused. The value underneath is the bare integer.
    expect(startNonceField().value).toBe(Number.MAX_SAFE_INTEGER.toLocaleString('en-US'))
    expect((startButton() as HTMLButtonElement).disabled).toBe(true)
  })

  // The path this already served: "Start over" hands back a value this machine accepted a moment
  // ago, and a complaint over it would be an error about nothing.
  it('says nothing about a seeded value that is in range', () => {
    render(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: 41_200_000_000 }}
        onSubmit={vi.fn()}
      />,
    )

    expect(startNonceField().value).toBe('41,200,000,000')
    expect(screen.queryByText(/enter at most/i)).toBeNull()
    expect((startButton() as HTMLButtonElement).disabled).toBe(false)
  })

  // Same rule, arriving one render late — which is how a link reaches this form (page.tsx latches
  // `?config=` on first sight, and its subtree's first render comes through a Suspense bailout).
  it('shows the complaint for a value seeded after mount', () => {
    const { rerender } = render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    rerender(
      <ConfigForm
        chainId={1}
        initial={{ owners: [OWNER], start: Number.MAX_SAFE_INTEGER }}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText(/enter at most/i)).toBeDefined()
  })
})
