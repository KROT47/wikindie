import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { anchorHref } from '../../lib/anchors'
import { Button } from '../ui/Button'

export function CopyAnchorButton({
  pagePath,
  anchorId,
  name,
  variant,
}: {
  pagePath: string
  anchorId: string
  name: string
  variant: 'heading' | 'section'
}) {
  const [copied, setCopied] = useState(false)
  const label = copied ? `Copied link to ${name}` : `Copy link to ${name}`

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(anchorHref(pagePath, anchorId, window.location.origin))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (variant === 'heading') {
    return (
      <button
        type="button"
        className="ml-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded align-middle text-text-muted opacity-0 transition hover:bg-accent/10 hover:text-text focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={label}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copy()
        }}
      >
        <Link2 size={14} aria-hidden="true" />
        <span className="sr-only" aria-live="polite">{copied ? 'Copied link' : 'Copy link'}</span>
      </button>
    )
  }

  return (
    <Button type="button" variant="ghost" aria-label={label} onClick={() => void copy()}>
      <Link2 size={14} aria-hidden="true" />
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  )
}
