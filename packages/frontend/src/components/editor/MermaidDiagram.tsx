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
    case 'ArrowUp': return { x: 0, y: step }
    case 'ArrowDown': return { x: 0, y: -step }
    default: return null
  }
}

const wheelLine = 16
const pinchSensitivity = 0.01

function wheelPan(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: event.deltaX * wheelLine, y: event.deltaY * wheelLine }
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * window.innerWidth, y: event.deltaY * window.innerHeight }
  }
  return { x: event.deltaX, y: event.deltaY }
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const dragRef = useRef<DragSession | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const showToggle = Boolean(svg) && !error
  panRef.current = pan
  scaleRef.current = scale

  const closeExpanded = useCallback(() => {
    const drag = dragRef.current
    if (drag) {
      dragRef.current = null
      drag.stop()
      if (drag.moved) suppressDragClick()
    }
    const origin = { x: 0, y: 0 }
    panRef.current = origin
    scaleRef.current = 1
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
        setPan((current) => {
          const next = { x: current.x + delta.x, y: current.y + delta.y }
          panRef.current = next
          return next
        })
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

  useEffect(() => {
    const viewport = viewportRef.current
    if (!expanded || !viewport) return

    const zoomAbout = (point: { clientX: number; clientY: number }, nextScale: number) => {
      const current = scaleRef.current
      const next = clampScale(nextScale)
      if (next === current) return
      const ratio = next / current
      const rect = viewport.getBoundingClientRect()
      const inside = point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom
      const focalX = inside ? point.clientX - rect.left : rect.width / 2
      const focalY = inside ? point.clientY - rect.top : rect.height / 2
      const pan = panRef.current
      const nextPan = {
        x: pan.x * ratio + (focalX - rect.width / 2) * (1 - ratio),
        y: pan.y * ratio + (focalY - rect.height / 2) * (1 - ratio),
      }
      scaleRef.current = next
      panRef.current = nextPan
      setScale(next)
      setPan(nextPan)
    }

    let pinchOrigin = scaleRef.current
    let trackpadPinch = false
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        if (trackpadPinch) return
        const delta = wheelPan(event)
        zoomAbout(event, scaleRef.current * Math.exp(-delta.y * pinchSensitivity))
        return
      }
      const delta = wheelPan(event)
      const nextPan = { x: panRef.current.x - delta.x, y: panRef.current.y - delta.y }
      panRef.current = nextPan
      setPan(nextPan)
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      trackpadPinch = true
      pinchOrigin = scaleRef.current
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number }
      if (typeof gesture.scale !== 'number') return
      zoomAbout(
        { clientX: gesture.clientX ?? 0, clientY: gesture.clientY ?? 0 },
        pinchOrigin * gesture.scale,
      )
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      trackpadPinch = false
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('gesturestart', onGestureStart, { passive: false })
    viewport.addEventListener('gesturechange', onGestureChange, { passive: false })
    viewport.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('gesturestart', onGestureStart)
      viewport.removeEventListener('gesturechange', onGestureChange)
      viewport.removeEventListener('gestureend', onGestureEnd)
    }
  }, [expanded, svg])

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
      const next = { x: drag.originX + dx, y: drag.originY + dy }
      panRef.current = next
      setPan(next)
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
          <div ref={viewportRef} className="mermaid-diagram-viewport" onPointerDown={onPointerDown}>
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
