import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Node } from 'unist'

const parser = unified().use(remarkParse).use(remarkGfm)

type PositionedNode = Node & {
  position?: {
    start?: { offset?: number | null }
    end?: { offset?: number | null }
  }
}

// Code and inline code are identified by the same parser the preview uses,
// so fence length, tildes, lists, and quotes stay intact without a second scanner.
export function replaceOutsideCode(markdown: string, replace: (segment: string) => string) {
  const tree = parser.parse(markdown)
  const ranges: Array<[number, number]> = []

  visit(tree, (node: PositionedNode) => {
    if (node.type !== 'code' && node.type !== 'inlineCode') return
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number' || end < start) return
    ranges.push([start, end])
  })

  ranges.sort((left, right) => left[0] - right[0])

  let result = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    if (end <= cursor) continue
    const from = Math.max(start, cursor)
    result += replace(markdown.slice(cursor, from))
    result += markdown.slice(from, end)
    cursor = end
  }
  result += replace(markdown.slice(cursor))
  return result
}
