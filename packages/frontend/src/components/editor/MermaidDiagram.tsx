import { useEffect, useRef, useState } from 'react'
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
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <figure className="mermaid-diagram">
      <div ref={stageRef} className="mermaid-diagram-stage" />
      {error ? (
        <div className="mermaid-diagram-error" role="note">
          <p>{error}</p>
          <pre><code>{source}</code></pre>
        </div>
      ) : svg ? (
        <div aria-label="Diagram" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="mermaid-diagram-pending">Rendering diagram…</p>
      )}
    </figure>
  )
}
