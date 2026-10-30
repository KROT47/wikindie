import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

type ScrollPoint = { top: number; left: number }

const storageKey = 'wikindie:scroll-positions'
const maxEntries = 60
const positions = new Map<string, ScrollPoint>()

function slot(historyKey: string, pathname: string, id: string) {
  return `${historyKey}\0${pathname}\0${id}`
}

function readStored() {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, ScrollPoint>
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value.top !== 'number' || typeof value.left !== 'number') continue
      positions.set(key, { top: value.top, left: value.left })
    }
  } catch {
    // sessionStorage is unavailable in private mode.
  }
}

function writeStored() {
  try {
    const entries = [...positions.entries()].slice(-maxEntries)
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Ignore quota errors and private mode.
  }
}

let persistTimer = 0

function scheduleStore() {
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(writeStored, 120)
}

function remember(historyKey: string, pathname: string, id: string, node: HTMLElement) {
  const key = slot(historyKey, pathname, id)
  const next = { top: node.scrollTop, left: node.scrollLeft }
  const current = positions.get(key)
  positions.delete(key)
  positions.set(key, next)
  while (positions.size > maxEntries) {
    const oldest = positions.keys().next().value
    if (!oldest) break
    positions.delete(oldest)
  }
  if (!current || current.top !== next.top || current.left !== next.left) scheduleStore()
}

const restoring = new Set<string>()

export function isRestoringScroll(historyKey: string, pathname: string, id = 'main') {
  return restoring.has(slot(historyKey, pathname, id))
}

readStored()

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
window.addEventListener('pagehide', writeStored)

function fits(node: HTMLElement, point: ScrollPoint) {
  const maxTop = Math.max(0, node.scrollHeight - node.clientHeight)
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth)
  return point.top <= maxTop + 1 && point.left <= maxLeft + 1
}

function assign(node: HTMLElement, point: ScrollPoint) {
  const maxTop = Math.max(0, node.scrollHeight - node.clientHeight)
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth)
  const top = Math.min(maxTop, Math.max(0, point.top))
  const left = Math.min(maxLeft, Math.max(0, point.left))
  if (Math.abs(node.scrollTop - top) < 1 && Math.abs(node.scrollLeft - left) < 1) return false
  node.scrollTop = top
  node.scrollLeft = left
  return true
}

// The page column scrolls inside the panel, not the window. Remember that
// offset per history entry so Back and Forward return to the same place.
export function useScrollRestoration(ref: { readonly current: HTMLElement | null }, id = 'main', watch?: unknown) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const pathRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    const pathChanged = pathRef.current !== null && pathRef.current !== location.pathname
    pathRef.current = location.pathname
    if (!node) return

    const historyKey = location.key
    const positionKey = slot(historyKey, location.pathname, id)
    const saved = navigationType === 'POP' ? positions.get(positionKey) : undefined
    let applying = false
    let holding = Boolean(saved)
    let touched = false
    if (saved) restoring.add(positionKey)

    const save = () => {
      if (applying || holding) return
      remember(historyKey, location.pathname, id, node)
    }

    const apply = (point: ScrollPoint) => {
      applying = true
      assign(node, point)
      applying = false
    }

    let frame = 0
    let nestedFrame = 0
    let resizeObserver: ResizeObserver | undefined
    let mutationObserver: MutationObserver | undefined
    let stopTimer = 0

    const stopHolding = () => {
      holding = false
      window.clearTimeout(stopTimer)
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(nestedFrame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      resizeObserver = undefined
      mutationObserver = undefined
    }

    if (saved) {
      apply(saved)
      const reapply = () => {
        if (!holding) return
        apply(saved)
      }
      frame = window.requestAnimationFrame(() => {
        reapply()
        nestedFrame = window.requestAnimationFrame(reapply)
      })
      resizeObserver = new ResizeObserver(() => {
        reapply()
      })
      const observeChildren = () => {
        if (!resizeObserver) return
        for (const child of node.children) resizeObserver.observe(child)
      }
      observeChildren()
      mutationObserver = new MutationObserver(() => {
        observeChildren()
        reapply()
      })
      mutationObserver.observe(node, { childList: true, subtree: true })
      stopTimer = window.setTimeout(stopHolding, 8000)
      node.addEventListener('wheel', stopHolding, { capture: true, passive: true })
      node.addEventListener('touchstart', stopHolding, { capture: true, passive: true })
      node.addEventListener('pointerdown', stopHolding, { capture: true })
      node.addEventListener('keydown', stopHolding, { capture: true })
    } else if (pathChanged && !location.hash) {
      apply({ top: 0, left: 0 })
    }

    const onScroll = () => {
      if (applying) return
      if (holding && saved) {
        apply(saved)
        return
      }
      touched = true
      save()
    }
    node.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      restoring.delete(positionKey)
      if ((touched || node.scrollTop > 1 || node.scrollLeft > 1) && (!holding || (saved && fits(node, saved)))) {
        remember(historyKey, location.pathname, id, node)
      }
      writeStored()
      stopHolding()
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('wheel', stopHolding, { capture: true })
      node.removeEventListener('touchstart', stopHolding, { capture: true })
      node.removeEventListener('pointerdown', stopHolding, { capture: true })
      node.removeEventListener('keydown', stopHolding, { capture: true })
    }
    // `watch` rebinds when a conditional scroller mounts under the same history entry.
  }, [id, location.hash, location.key, location.pathname, navigationType, ref, watch])
}
