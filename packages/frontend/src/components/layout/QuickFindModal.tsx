import { Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TreeNode } from '../../lib/api'
import { pageUrl } from '../../lib/paths'
import { useFilesStore } from '../../lib/store'
import { PageIcon } from '../ui/PageIcon'

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const list: TreeNode[] = []
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      list.push(item)
      if (item.children?.length) walk(item.children)
    }
  }
  walk(nodes)
  return list
}

export function QuickFindModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tree = useFilesStore((state) => state.tree)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const pointer = useRef({ x: 0, y: 0, seen: false, frozen: false })

  const allNodes = useMemo(() => flattenTree(tree), [tree])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return allNodes.slice(0, 30)
    return allNodes.filter((node) => `${node.title} ${node.path} ${node.icon ?? ''}`.toLowerCase().includes(term)).slice(0, 30)
  }, [allNodes, query])

  const selectedIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1)

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    pointer.current.frozen = false
  }, [open])

  const optionId = (index: number) => `${listId}-option-${index}`

  const openPage = (node: TreeNode) => {
    navigate(pageUrl(node.path))
    onClose()
  }

  const moveSelection = (delta: number) => {
    if (!filtered.length) return
    const current = selectedIndex < 0 ? 0 : selectedIndex
    const next = (current + delta + filtered.length) % filtered.length
    pointer.current.frozen = true
    setActiveIndex(next)
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const node = filtered[selectedIndex]
      if (node) openPage(node)
    }
  }

  const onResultsMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = { x: event.clientX, y: event.clientY }
    const previous = pointer.current
    const samePoint = previous.seen && previous.x === point.x && previous.y === point.y
    // Scrolling the list under a stationary pointer can emit a move event. Ignore that
    // so keyboard navigation is not pulled back to the row under the cursor.
    pointer.current = { ...point, seen: true, frozen: previous.frozen && samePoint }
    if (pointer.current.frozen) return

    const target = event.target
    if (!(target instanceof Element)) return
    const option = target.closest<HTMLElement>('[data-index]')
    if (!option || !listRef.current?.contains(option)) return
    const index = Number(option.dataset.index)
    if (Number.isInteger(index)) setActiveIndex(index)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-start overflow-hidden bg-overlay p-3 md:place-items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Quick find"
        className="mt-10 w-full max-w-xl overflow-hidden rounded-md border border-border bg-input p-3 shadow-lg shadow-heavy md:mt-0"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <Search size={16} className="shrink-0 text-text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
            className="w-full bg-transparent text-sm text-text outline-none"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
              pointer.current.frozen = false
              if (listRef.current) listRef.current.scrollTop = 0
            }}
            placeholder="Quick find pages and boards"
          />
        </div>
        <div id={listId} ref={listRef} role="listbox" className="max-h-[60vh] overflow-auto" onMouseMove={onResultsMouseMove}>
          {filtered.map((node, index) => {
            const selected = index === selectedIndex
            return (
              <button
                key={node.path}
                id={optionId(index)}
                data-index={index}
                role="option"
                type="button"
                tabIndex={-1}
                aria-selected={selected}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${selected ? 'bg-accent/10 text-text' : 'text-text-muted'}`}
                onClick={() => openPage(node)}
              >
                <PageIcon icon={node.icon} fallback={node.type === 'board' ? 'board' : 'page'} />
                <span className="min-w-0 truncate font-medium text-text">{node.title}</span>
                <span className="hidden min-w-0 truncate text-xs text-text-muted sm:inline">{node.path}</span>
              </button>
            )
          })}
          {!filtered.length && <p className="px-2 py-4 text-sm text-text-muted">No results.</p>}
        </div>
      </div>
    </div>
  )
}
