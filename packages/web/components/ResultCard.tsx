import { formatScore, type Candidate } from '@safe-vanity-blockie/core'
import { Blockie } from './Blockie'

export interface ResultCardProps {
  candidate: Candidate
  onSelect: (candidate: Candidate) => void
}

export function ResultCard({ candidate, onSelect }: ResultCardProps) {
  const expression = Object.values(candidate.regions).join('/') || '—'
  return (
    <figure className="card">
      <Blockie address={candidate.address} size={128} />
      <figcaption>
        <strong>{formatScore(candidate.score, candidate.maxScore)}</strong>
        <span>
          {expression} · {candidate.twoColor ? 'two colours' : 'three colours'} · contrast{' '}
          {candidate.contrast}
        </span>
        <code>{candidate.address}</code>
        <code>saltNonce {candidate.saltNonce}</code>
        <button type="button" onClick={() => onSelect(candidate)}>
          Use this
        </button>
      </figcaption>
    </figure>
  )
}
