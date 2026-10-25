import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, Minus, Plus } from 'lucide-react'
import { isMermaidLoadError, renderMermaid } from './mermaidRuntime'

const minScale = 0.25
const maxScale = 8
const zoomFactor = 1.25
const dragThreshold = 4
const panStep = 48
const panStepFast = 192

function clampScale(value: number) {
  return Math.min(maxScale, Math.max(minScale, value))
}

function zoomFactorFor(event: KeyboardEvent) {
  if (event.key === '=') return zoomFactor
  if (event.key === '-' || event.code === 'NumpadSubtract') return 1 / zoomFactor
  return null
}

function panDeltaFor(event: KeyboardEvent) {
  const step = event.shiftKey ? panStepFast : panStep
  switch (event.key) {
    case 'ArrowLeft': return { x: -step, y: 0 }
    case 'ArrowRight': return { x: step, y: 0 }
    case 'ArrowUp': return { x: 0, y: -step }
    case 'ArrowDown': return { x: 0, y: step }
    default: return null
  }
}

function suppressDragClick() {
  const suppress = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    window.removeEventListener('click', suppress, true)
  }
  window.addEventListener('click', suppress, true)
  window.setTimeout(() => window.removeEventListener('click', suppress, true), 0)
}

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

type DragSession = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
  stop: () => void
}

export function MermaidDiagram({ source }: { source: string }) {
  const dark = useHtmlDark()
  const stageRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<DragSession | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const showToggle = Boolean(svg) && !error
  panRef.current = pan

  const closeExpanded = useCallback(() => {
    const drag = dragRef.current
    if (drag) {
      dragRef.current = null
      drag.stop()
      if (drag.moved) suppressDragClick()
    }
    const origin = { x: 0, y: 0 }
    panRef.current = origin
    setDragging(false)
    setScale(1)
    setPan(origin)
    setExpanded(false)
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => clampScale(current * factor))
  }, [])

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
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeExpanded()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      const delta = panDeltaFor(event)
      if (delta) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setPan((current) => ({ x: current.x + delta.x, y: current.y + delta.y }))
        return
      }
      const factor = zoomFactorFor(event)
      if (factor == null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      zoomBy(factor)
    }
    window.addEventListener('keydown', onKeyDown, true)
    const frame = window.requestAnimationFrame(() => toggleRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.cancelAnimationFrame(frame)
      returnFocus.current?.focus()
    }
  }, [closeExpanded, expanded, zoomBy])

  useEffect(() => () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    drag.stop()
  }, [])

  const toggle = () => {
    if (expanded) {
      closeExpanded()
      return
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setExpanded(true)
  }

  const endDrag = (moved: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    drag.stop()
    if (moved) suppressDragClick()
    setDragging(false)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const drag: DragSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
      moved: false,
      stop: () => {},
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return
      const dx = ev.clientX - drag.startX
      const dy = ev.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < dragThreshold) return
      drag.moved = true
      if (ev.cancelable) ev.preventDefault()
      setPan({ x: drag.originX + dx, y: drag.originY + dy })
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return
      endDrag(drag.moved)
    }

    drag.stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (target.hasPointerCapture(drag.pointerId)) target.releasePointerCapture(drag.pointerId)
    }

    dragRef.current = drag
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    setDragging(true)
  }

  const canZoomIn = scale < maxScale
  const canZoomOut = scale > minScale
  const transform = expanded && (scale !== 1 || pan.x !== 0 || pan.y !== 0)
    ? `translate(${pan.x}px, ${pan.y}px) scale(${scale})`
    : undefined

  const canvas = svg ? (
    <div
      className="mermaid-diagram-canvas"
      style={transform ? { transform } : undefined}
      aria-label="Diagram"
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <p className="mermaid-diagram-pending">Rendering diagram…</p>
  )

  const frame = (
    <div className={`mermaid-diagram-frame${expanded ? ' mermaid-diagram-expanded' : ''}${dragging ? ' is-panning' : ''}`}>
      {showToggle ? (
        <div className="mermaid-diagram-toolbar">
          {expanded ? (
            <>
              <button
                className="mermaid-diagram-tool"
                type="button"
                aria-keyshortcuts="-"
                aria-label="Zoom out"
                title="Zoom out (-)"
                disabled={!canZoomOut}
                onClick={() => zoomBy(1 / zoomFactor)}
              >
                <Minus size={15} aria-hidden />
              </button>
              <button
                className="mermaid-diagram-tool"
                type="button"
                aria-keyshortcuts="="
                aria-label="Zoom in"
                title="Zoom in (=)"
                disabled={!canZoomIn}
                onClick={() => zoomBy(zoomFactor)}
              >
                <Plus size={15} aria-hidden />
              </button>
            </>
          ) : null}
          <button
            ref={toggleRef}
            className="mermaid-diagram-tool"
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
        ) : expanded && svg ? (
          <div className="mermaid-diagram-viewport" onPointerDown={onPointerDown}>
            {canvas}
          </div>
        ) : (
          canvas
        )}
      </figure>
    </div>
  )

  return expanded ? createPortal(frame, document.body) : frame
}
