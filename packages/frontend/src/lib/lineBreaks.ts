import type { Node } from 'unist'
import { visit } from 'unist-util-visit'
import { replaceOutsideCode } from './markdownSegments'

// CommonMark treats `<br>` as raw HTML. BlockNote's markdown parser drops raw
// HTML, so an unescaped tag disappears and the words on either side join.
// Escaping the `<` keeps the tag visible as text while the page is edited.
// Preview turns the same tag into a hard line break.
const inlineParents = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
])

type HtmlNode = Node & { value?: string }
type ParentNode = Node & { children: Node[] }

function isBreakTag(value: string) {
  return /^<br(?=\s|\/?>)(?:\s+[^<>\n]*?)?\s*\/?>$/i.test(value.trim())
}

export function escapeBreakTags(markdown: string) {
  const breakTag = /(?<!\\)<br(?=\s|\/?>)(?:\s+[^<>\n]*?)?\s*\/?>/gi
  return replaceOutsideCode(markdown, (segment) => segment.replace(breakTag, (tag) => `\\${tag}`))
}

export function remarkBreakTags() {
  return (tree: Node) => {
    visit(tree, 'html', (node, index, parent) => {
      const html = node as HtmlNode
      if (!parent || index == null || !isBreakTag(html.value ?? '')) return
      const container = parent as ParentNode
      const breakNode: Node = { type: 'break' }
      container.children[index] = inlineParents.has(container.type)
        ? breakNode
        : { type: 'paragraph', children: [breakNode] } as Node
    })
  }
}
