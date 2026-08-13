import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigForm } from '../components/ConfigForm'

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
const startButton = () => screen.getByRole('button', { name: /^start$/i })
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

    expect(onSubmit).toHaveBeenCalledWith({
      owners: [OWNER],
      threshold: 1,
      safeVersion: '1.4.1',
      chainId: 1,
    })
  })

  it('warns that owners are part of the address', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(screen.getByText(/changing them re-rolls/i)).toBeDefined()
  })

  // The button starts a search rather than advancing a wizard — there is no second step, and the
  // press is what locks the card and spins up the workers.
  it('labels its submit "Start"', () => {
    render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)
    expect(startButton()).toBeDefined()
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

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chainId: 11155111 }))
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

  describe('owner rows', () => {
    it('starts with exactly one owner field, which cannot be removed', () => {
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      expect(ownerField(1)).toBeDefined()
      expect(screen.queryByLabelText(/^owner 2$/i)).toBeNull()
      // There is always at least one owner, so the first row has nothing to remove it with.
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

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        owners: [OWNER, OWNER_B, OWNER_C],
      }))
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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER, OWNER_C] }))
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
      expect(screen.queryByRole('button', { name: /^remove owner 1$/i })).toBeNull()
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
      render(
        <ConfigForm chainId={1} initial={{ owners: [OWNER, OWNER_B] }} onSubmit={vi.fn()} />,
      )

      expect(ownerField(1).value).toBe(OWNER)
      expect(ownerField(2).value).toBe(OWNER_B)
      expect(screen.queryByLabelText(/^owner 3$/i)).toBeNull()
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

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        owners: [OWNER, OWNER_B],
        threshold: 2,
      }))
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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        owners: [OWNER, OWNER_B],
        threshold: 2,
      }))
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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        owners: [OWNER],
        threshold: 1,
      }))
    })

    // N of zero: there is no valid threshold to offer, so the control is disabled rather than
    // offering a number that cannot be honoured. Start is disabled for the same reason, and the
    // hint under it is what keeps that from being a dead control with no explanation.
    it('disables the threshold until there is an owner, and says why nothing can be started', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      render(<ConfigForm chainId={1} onSubmit={onSubmit} />)

      expect((thresholdTrigger() as HTMLButtonElement).disabled).toBe(true)
      expect((startButton() as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByText(/add an owner address/i)).toBeDefined()

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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        owners: [OWNER, OWNER_B],
        threshold: 2,
      }))
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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER] }))
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
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ owners: [OWNER] }))
    })

    // A disabled control with no reason is worse than a button that explains itself when pressed,
    // which is what this replaces — so the reason is on screen, and tied to the button by
    // aria-describedby rather than left as prose that happens to sit nearby.
    it('says why it is disabled, and says it to a screen reader too', async () => {
      const user = userEvent.setup()
      render(<ConfigForm chainId={1} onSubmit={vi.fn()} />)

      const describedBy = () => startButton().getAttribute('aria-describedby')
      expect(screen.getByText(/add an owner address/i).id).toBe(describedBy())

      await user.type(ownerField(1), '0xnope')
      expect(screen.getByText(/fix the owner address/i).id).toBe(describedBy())

      await user.clear(ownerField(1))
      await user.type(ownerField(1), OWNER)
      expect(describedBy()).toBeNull()
      expect(screen.queryByText(/add an owner address/i)).toBeNull()
      expect(screen.queryByText(/fix the owner address/i)).toBeNull()
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
      const count = () => container.querySelectorAll('*').length

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
