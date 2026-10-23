import { encodePath, type TreeNode } from './api'

export function pageUrl(path: string) {
  return `/page/${encodePath(path)}`
}

export function pagePathFromLocation(pathname: string) {
  if (!pathname.startsWith('/page/')) return ''
  try {
    return pathname.slice('/page/'.length).split('/').filter(Boolean).map(decodeURIComponent).join('/')
  } catch {
    return ''
  }
}

const PAGE_LINK_ORIGIN = 'http://wikindie.local'
const PAGE_LINK_SCHEME = /^[a-z][a-z0-9+.-]*:/i
// Sentinel stored on editor links in older documents. It is not a heading anchor.
export const WIKI_REFERENCE_HASH = '#wikindie-ref'

function pageSegments(pagePath: string) {
  return pagePath.split('/').filter(Boolean)
}

function encodeHrefSegment(segment: string) {
  // encodeURIComponent leaves parentheses, which would end a Markdown link.
  return encodeURIComponent(segment).replace(/[()]/g, (char) => (char === '(' ? '%28' : '%29'))
}

function unwrapMarkdownHref(href: string) {
  const trimmed = href.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 2) return trimmed.slice(1, -1).trim()
  return trimmed
}

function pageLinkBase(fromPagePath: string) {
  return new URL(pageUrl(fromPagePath), PAGE_LINK_ORIGIN)
}

// The address bar is `/page/<path>` with no trailing slash, so the last segment
// is the page name. A relative link is resolved from that URL's parent, which
// is how the browser treats an `<a href>` on the page.
export function relativePageHref(fromPagePath: string, toPagePath: string) {
  const fromDir = pageSegments(fromPagePath).slice(0, -1)
  const toSegments = pageSegments(toPagePath)
  let common = 0
  while (common < fromDir.length && common < toSegments.length && fromDir[common] === toSegments[common]) common += 1
  let ups = fromDir.length - common
  let down = toSegments.slice(common)
  if (down.length === 0) {
    const name = toSegments[toSegments.length - 1]
    if (!name) return './'
    ups += 1
    down = [name]
  }
  const href = [...Array(ups).fill('..'), ...down.map(encodeHrefSegment)].join('/')
  if (!href.startsWith('.') && !href.includes('/')) return `./${href}`
  return href
}

export type ParsedPageHref = {
  path: string
  suffix: string
}

export function parsePageHref(href: string, fromPagePath: string): ParsedPageHref | null {
  const normalized = unwrapMarkdownHref(href)
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('//') || PAGE_LINK_SCHEME.test(normalized)) return null
  try {
    const url = new URL(normalized, pageLinkBase(fromPagePath))
    if (url.origin !== PAGE_LINK_ORIGIN || !url.pathname.startsWith('/page/')) return null
    const path = pagePathFromLocation(url.pathname)
    if (!path) return null
    const hash = url.hash === WIKI_REFERENCE_HASH ? '' : url.hash
    return { path, suffix: url.search + hash }
  } catch {
    return null
  }
}

export function pagePathFromHref(href: string, fromPagePath: string) {
  return parsePageHref(href, fromPagePath)?.path ?? null
}

// Preview navigation for a markdown href. Fragments stay on the suffix and are
// never part of the page path. Hash-only links stay on `pagePath`.
export function previewNavigationHref(href: string, pagePath: string): string | null {
  if (!href) return null
  if (pagePath && href.startsWith('#')) return `${pageUrl(pagePath)}${href}`
  if (pagePath) {
    const parsed = parsePageHref(href, pagePath)
    if (parsed) return `${pageUrl(parsed.path)}${parsed.suffix}`
  }
  if (href.startsWith('/page/')) return href
  return null
}

export function safeInternalReturnPath(value: unknown) {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  if (/[\u0000-\u001F\\]/.test(value) || value.includes('://')) return '/'
  return value
}

export function pageNameFromPath(pagePath: string) {
  const parts = pagePath.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : 'Home'
}

export function breadcrumbsFromPath(pagePath: string) {
  const parts = pagePath.split('/').filter(Boolean)
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join('/'),
  }))
}

export function findTreeNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const match = node.children ? findTreeNode(node.children, path) : undefined
    if (match) return match
  }
  return undefined
}

export function goBack(navigate: { (delta: number): void; (to: string): void }) {
  if (window.history.length > 1) navigate(-1)
  else navigate('/')
}
