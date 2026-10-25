import GithubSlugger, { slug as githubSlug } from 'github-slugger'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'
import { preparePreviewMarkdown } from '../components/editor/wikiReferences'
import { pageUrl, relativePageHref, WIKI_REFERENCE_HASH } from './paths'

const RESERVED_HEADING_ID = WIKI_REFERENCE_HASH.slice(1)

const parser = unified().use(remarkParse).use(remarkGfm)

type HeadingNode = Node & {
  type: string
  depth?: number
  value?: string
  children?: HeadingNode[]
  data?: { hProperties?: Record<string, string> }
}

const skippedText = new Set(['html', 'image', 'imageReference', 'definition', 'footnoteDefinition'])

function headingPlainText(node: HeadingNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (skippedText.has(node.type)) return ''
  let text = ''
  for (const child of node.children ?? []) text += headingPlainText(child)
  return text
}

function createHeadingSlugger() {
  const slugger = new GithubSlugger()
  // Keep the editor sentinel out of the document so saved links do not drop it.
  slugger.occurrences[RESERVED_HEADING_ID] = 0
  return slugger
}

function nextHeadingId(slugger: GithubSlugger, text: string) {
  // github-slugger lowercases, strips punctuation, and keeps Unicode letters.
  // An empty result shares the `heading` namespace with a heading of that word.
  return slugger.slug(githubSlug(text) ? text : 'heading')
}

export function headingIdsForMarkdown(markdown: string, slugger = createHeadingSlugger()) {
  const tree = parser.parse(preparePreviewMarkdown(markdown))
  const ids: string[] = []
  visit(tree, 'heading', (node) => {
    const heading = node as HeadingNode
    const depth = heading.depth ?? 0
    if (depth < 1 || depth > 6) return
    ids.push(nextHeadingId(slugger, headingPlainText(heading)))
  })
  return ids
}

export type SectionAnchorInput = {
  path: string
  content: string
}

export type SectionAnchorPlan = {
  anchorId: string
  headingIds: string[]
}

export type PageAnchorPlan = {
  bodyHeadingIds: string[]
  sections: SectionAnchorPlan[]
}

// `section-<file stem>`. The stem comes from the stored section path, so renaming
// the section title does not change the anchor. A new path does.
export function sectionAnchorBase(sectionPath: string) {
  const normalized = sectionPath.replaceAll('\\', '/').replace(/^\/+/, '')
  const relative = normalized.replace(/^_sections\//, '').replace(/\.md$/i, '')
  const stem = relative.trim().replace(/[\s/]+/g, '-')
  return `section-${stem || 'section'}`
}

export function uniqueDomId(base: string, used: Set<string>) {
  let id = base || 'section'
  if (id === RESERVED_HEADING_ID || used.has(id)) {
    let suffix = 1
    while (`${base}-${suffix}` === RESERVED_HEADING_ID || used.has(`${base}-${suffix}`)) suffix += 1
    id = `${base}-${suffix}`
  }
  used.add(id)
  return id
}

export function assignPageAnchors(body: string, sections: SectionAnchorInput[]): PageAnchorPlan {
  const slugger = createHeadingSlugger()
  const bodyHeadingIds = headingIdsForMarkdown(body, slugger)
  const sectionHeadingIds = sections.map((section) => headingIdsForMarkdown(section.content, slugger))
  const used = new Set<string>([...bodyHeadingIds, ...sectionHeadingIds.flat()])
  return {
    bodyHeadingIds,
    sections: sections.map((section, index) => ({
      headingIds: sectionHeadingIds[index] ?? [],
      anchorId: uniqueDomId(sectionAnchorBase(section.path), used),
    })),
  }
}

// Stamps precomputed ids in document order. The same parser and prepared
// source must feed both this plugin and `headingIdsForMarkdown`.
export function createRemarkHeadingIds(headingIds: readonly string[]) {
  return function headingIdsPlugin() {
    return (tree: Node) => {
      let index = 0
      visit(tree, 'heading', (node) => {
        const heading = node as HeadingNode
        const depth = heading.depth ?? 0
        if (depth < 1 || depth > 6) return
        const id = headingIds[index++]
        if (!id) return
        const data = heading.data ?? (heading.data = {})
        data.hProperties = { ...data.hProperties, id }
      })
    }
  }
}

export function stampedHeadingIds(markdown: string, headingIds: readonly string[]) {
  const tree = parser.parse(preparePreviewMarkdown(markdown))
  createRemarkHeadingIds(headingIds)()(tree)
  const ids: string[] = []
  visit(tree, 'heading', (node) => {
    const heading = node as HeadingNode
    const depth = heading.depth ?? 0
    if (depth < 1 || depth > 6) return
    ids.push(heading.data?.hProperties?.id ?? '')
  })
  return ids
}

export function decodeFragment(hash: string) {
  if (!hash || hash === '#') return ''
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function anchorHref(pagePath: string, id: string, origin: string) {
  const url = new URL(pageUrl(pagePath), origin)
  // `URL.href` percent-encodes the path and fragment. The clipboard link keeps
  // spaces and Unicode as characters, for example `#установка`.
  return `${url.origin}${decodeURI(url.pathname)}#${id}`
}

// Same-page heading link in the form the editor stores, for example `./Guide#installation`.
export function relativeHeadingHref(pagePath: string, id: string, index = false) {
  return `${relativePageHref(pagePath, pagePath, index)}#${id}`
}

export function scrollAnchorIntoView(container: HTMLElement, target: HTMLElement) {
  const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top
  const max = Math.max(0, container.scrollHeight - container.clientHeight)
  const next = Math.min(max, Math.max(0, top))
  if (Math.abs(container.scrollTop - next) < 2) return false
  container.scrollTo({ top: next, behavior: 'auto' })
  return true
}
