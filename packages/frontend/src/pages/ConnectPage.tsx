import { useRef } from 'react'
import { McpConnectionPanel } from '../components/integrations/McpConnectionPanel'
import { useScrollRestoration } from '../hooks/useScrollRestoration'

export function ConnectPage() {
  const scrollRef = useRef<HTMLElement>(null)
  useScrollRestoration(scrollRef)

  return (
    <section ref={scrollRef} className="workspace-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <McpConnectionPanel />
      </div>
    </section>
  )
}
