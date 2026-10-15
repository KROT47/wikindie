import { Bug, SquareCheck } from 'lucide-react'
import type { CardType } from '../../lib/api'
import { cardTypeLabel } from '../../lib/cardType'

export function CardTypeIcon({ type, className = '', title }: { type?: CardType; className?: string; title?: string }) {
  const isBug = (type ?? 'task') === 'bug'
  const Icon = isBug ? Bug : SquareCheck
  return (
    <Icon
      aria-label={title ?? cardTypeLabel(type)}
      className={`shrink-0 ${isBug ? 'text-danger' : 'text-text-muted'} ${className}`}
      role="img"
    />
  )
}
