import { Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { anchorHref, relativeHeadingHref } from '../../lib/anchors'
import { Button } from '../ui/Button'

export function CopyAnchorButton({
  pagePath,
  pageIndex = false,
  anchorId,
  name,
  variant,
}: {
  pagePath: string
  pageIndex?: boolean
  anchorId: string
  name: string
  variant: 'heading' | 'section'
}) {
  const anchorRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)
  const label = copied ? `Copied link to ${name}` : `Copy link to ${name}`

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const href = variant === 'heading'
      ? relativeHeadingHref(pagePath, anchorId, pageIndex)
      : anchorHref(pagePath, anchorId, window.location.origin)
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (variant === 'heading') {
    return (
      <>
        <button
          ref={(node) => { anchorRef.current = node }}
          type="button"
          className={`ml-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded align-middle text-text-muted transition hover:bg-accent/10 hover:text-text focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
          aria-label={label}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void copy()
          }}
        >
          <Link2 size={14} aria-hidden="true" />
        </button>
        {copied ? <CopiedHint anchor={anchorRef.current} /> : null}
      </>
    )
  }

  return (
    <span ref={(node) => { anchorRef.current = node }} className="inline-flex">
      <Button type="button" variant="ghost" aria-label={label} onClick={() => void copy()}>
        <Link2 size={14} aria-hidden="true" />
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      {copied ? <CopiedHint anchor={anchorRef.current} /> : null}
    </span>
  )
}

function CopiedHint({ anchor }: { anchor: HTMLElement | null }) {
  const [box, setBox] = useState(() => anchor?.getBoundingClientRect() ?? null)

  useEffect(() => {
    if (!anchor) return
    const update = () => setBox(anchor.getBoundingClientRect())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor])

  if (!box) return null
  const width = 76
  const height = 28
  let top = box.bottom + 6
  if (top + height > window.innerHeight - 8) top = Math.max(8, box.top - height - 6)
  let left = box.left + box.width / 2 - width / 2
  left = Math.min(Math.max(8, left), window.innerWidth - width - 8)

  return createPortal(
    <span
      role="status"
      style={{ position: 'fixed', top, left, width }}
      className="z-50 rounded-md border border-border bg-card px-2 py-1 text-center text-xs font-medium text-text shadow-lg shadow-shadow"
    >
      Copied
    </span>,
    document.body,
  )
}
