import { type Candidate, formatScore } from '@safe-vanity-blockie/core'
import { cn } from '../lib/utils'
import { Blockie } from './Blockie'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardAction, CardContent, CardFooter, CardHeader } from './ui/card'

export interface ResultCardProps {
  candidate: Candidate
  /** Highlights the card the user has already picked for deployment; see ResultsGrid. */
  selected?: boolean
  onSelect: (candidate: Candidate) => void
}

export function ResultCard({ candidate, selected = false, onSelect }: ResultCardProps) {
  const expression = Object.values(candidate.regions).join('/') || '—'
  return (
    <Card className={cn('gap-3 py-4', selected && 'ring-2 ring-primary')}>
      <CardHeader className="px-4">
        <span className="text-lg font-semibold">
          {formatScore(candidate.score, candidate.maxScore)}
        </span>
        {selected && (
          <CardAction>
            <Badge>Selected</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 px-4">
        <Blockie address={candidate.address} size={128} />
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Badge variant="secondary">{expression}</Badge>
          <Badge variant={candidate.twoColor ? 'secondary' : 'outline'}>
            {candidate.twoColor ? 'two colours' : 'three colours'}
          </Badge>
          <Badge variant="outline">contrast {candidate.contrast}</Badge>
        </div>
        <code className="w-full break-all text-center text-xs text-muted-foreground">
          {candidate.address}
        </code>
        <code className="text-xs text-muted-foreground">saltNonce {candidate.saltNonce}</code>
      </CardContent>
      <CardFooter className="px-4">
        <Button type="button" className="w-full" onClick={() => onSelect(candidate)}>
          Use this
        </Button>
      </CardFooter>
    </Card>
  )
}
