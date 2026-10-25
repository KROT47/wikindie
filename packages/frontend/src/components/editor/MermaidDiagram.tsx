import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { isMermaidLoadError, renderMermaid } from './mermaidRuntime'

function useHtmlDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

export function MermaidDiagram({ source }: { source: string }) {
  const dark = useHtmlDark()
  const stageRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const showToggle = Boolean(svg) && !error

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let cancelled = false
    setSvg(null)
    setError(null)

    renderMermaid(source, dark, stage).then(
      (next) => {
        if (!cancelled) setSvg(next)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(isMermaidLoadError(reason) ? 'The diagram library failed to load.' : 'This diagram could not be rendered.')
      },
    )

    return () => {
      cancelled = true
    }
  }, [dark, source])

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    const frame = window.requestAnimationFrame(() => toggleRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.cancelAnimationFrame(frame)
      returnFocus.current?.focus()
    }
  }, [expanded])

  const toggle = () => {
    if (!expanded) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setExpanded((open) => !open)
  }

  const frame = (
    <div className={`mermaid-diagram-frame${expanded ? ' mermaid-diagram-expanded' : ''}`}>
      {showToggle ? (
        <div className="mermaid-diagram-toolbar">
          <button
            ref={toggleRef}
            className="mermaid-diagram-toggle"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand to full screen'}
            title={expanded ? 'Collapse' : 'Expand to full screen'}
            onClick={toggle}
          >
            {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
          </button>
        </div>
      ) : null}
      <figure className="mermaid-diagram">
        <div ref={stageRef} className="mermaid-diagram-stage" />
        {error ? (
          <div className="mermaid-diagram-error" role="note">
            <p>{error}</p>
            <pre><code>{source}</code></pre>
          </div>
        ) : svg ? (
          <div className="mermaid-diagram-canvas" aria-label="Diagram" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="mermaid-diagram-pending">Rendering diagram…</p>
        )}
      </figure>
    </div>
  )

  return expanded ? createPortal(frame, document.body) : frame
}
