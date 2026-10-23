import type { Mermaid } from 'mermaid'
import { sanitizeMermaidSvg } from './sanitizeMermaidSvg'

const maxTextSize = 50_000

let mermaidPromise: Promise<Mermaid> | null = null
let renderChain: Promise<unknown> = Promise.resolve()
let nextId = 0

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((module) => module.default).catch((error: unknown) => {
    mermaidPromise = null
    throw error
  })
  return mermaidPromise
}

function configFor(dark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize,
    fontFamily: 'inherit',
    theme: dark ? 'dark' as const : 'default' as const,
    darkMode: dark,
    logLevel: 'fatal' as const,
    flowchart: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    // Diagram directives cannot relax these. `secure` replaces Mermaid's list, so the defaults stay here too.
    secure: [
      'secure',
      'securityLevel',
      'startOnLoad',
      'maxTextSize',
      'suppressErrorRendering',
      'htmlLabels',
      'themeCSS',
      'dompurifyConfig',
      'fontFamily',
    ],
  }
}

function enqueue<T>(task: () => Promise<T>) {
  const run = renderChain.then(task, task)
  renderChain = run.then(() => undefined, () => undefined)
  return run
}

export function renderMermaid(source: string, dark: boolean, container: HTMLElement) {
  const id = `mmd-${++nextId}`
  return enqueue(async () => {
    try {
      const mermaid = await loadMermaid()
      mermaid.initialize(configFor(dark))
      const { svg } = await mermaid.render(id, source, container)
      const clean = sanitizeMermaidSvg(svg)
      if (!clean) throw new Error('Diagram did not produce a safe SVG')
      return clean
    } finally {
      container.replaceChildren()
      document.getElementById(id)?.remove()
    }
  })
}

export function isMermaidLoadError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (error.name === 'TypeError') return true
  return /dynamically imported module|failed to fetch|importing a module/i.test(error.message)
}
