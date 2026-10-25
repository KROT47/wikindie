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

// A folder page is `product/_Index.md`: links resolve inside `product`.
// A file page is `product/ABOUT.md`: links resolve inside `product`, not `ABOUT`.
function containingDirectory(pagePath: string, index: boolean) {
  const segments = pageSegments(pagePath)
  if (!index) segments.pop()
  return segments.join('/')
}

function pageDirectoryBase(fromPagePath: string, index = false) {
  const directory = containingDirectory(fromPagePath, index)
  const url = new URL(directory ? pageUrl(directory) : '/page/', PAGE_LINK_ORIGIN)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function markdownFilePath(href: string) {
  const normalized = unwrapMarkdownHref(href)
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('/') || normalized.startsWith('//') || PAGE_LINK_SCHEME.test(normalized)) return null
  const path = normalized.split(/[?#]/)[0] ?? ''
  return path.endsWith('.md') ? normalized : null
}

function withoutIndexFile(pagePath: string) {
  if (pagePath === '_Index.md') return ''
  return pagePath.endsWith('/_Index.md') ? pagePath.slice(0, -'/_Index.md'.length) : pagePath
}

function markdownFilePageTarget(href: string, fromPagePath: string, index = false): ParsedPageHref | null {
  const normalized = markdownFilePath(href)
  if (!normalized) return null
  try {
    const url = new URL(normalized, pageDirectoryBase(fromPagePath, index))
    if (url.origin !== PAGE_LINK_ORIGIN || !url.pathname.startsWith('/page/')) return null
    const path = withoutIndexFile(pagePathFromLocation(url.pathname))
    if (!path) return null
    const hash = url.hash === WIKI_REFERENCE_HASH ? '' : url.hash
    return { path, suffix: url.search + hash }
  } catch {
    return null
  }
}

function pageHrefWithoutIndexFile(href: string) {
  try {
    const url = new URL(href, PAGE_LINK_ORIGIN)
    const raw = pagePathFromLocation(url.pathname)
    const path = withoutIndexFile(raw)
    if (!path || path === raw) return href
    const hash = url.hash === WIKI_REFERENCE_HASH ? '' : url.hash
    return `${pageUrl(path)}${url.search}${hash}`
  } catch {
    return href
  }
}

// Extension-less links use the same directory as `.md` links. A file page
// contributes its parent; a folder page (`index`) contributes itself.
export function relativePageHref(fromPagePath: string, toPagePath: string, index = false) {
  const fromDir = pageSegments(containingDirectory(fromPagePath, index))
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

export function parsePageHref(href: string, fromPagePath: string, index = false): ParsedPageHref | null {
  const normalized = unwrapMarkdownHref(href)
  if (!normalized || normalized.startsWith('#') || normalized.startsWith('//') || PAGE_LINK_SCHEME.test(normalized)) return null
  try {
    const url = new URL(normalized, pageDirectoryBase(fromPagePath, index))
    if (url.origin !== PAGE_LINK_ORIGIN || !url.pathname.startsWith('/page/')) return null
    const path = pagePathFromLocation(url.pathname)
    if (!path) return null
    const hash = url.hash === WIKI_REFERENCE_HASH ? '' : url.hash
    return { path, suffix: url.search + hash }
  } catch {
    return null
  }
}

export function pagePathFromHref(href: string, fromPagePath: string, index = false) {
  return parsePageHref(href, fromPagePath, index)?.path ?? null
}

// Preview navigation for a markdown href. Fragments stay on the suffix and are
// never part of the page path. Hash-only links stay on `pagePath`.
export function previewNavigationHref(href: string, pagePath: string, index = false): string | null {
  if (!href) return null
  if (pagePath && href.startsWith('#')) return `${pageUrl(pagePath)}${href}`
  const markdownFile = markdownFilePageTarget(href, pagePath, index)
  if (markdownFile) return `${pageUrl(markdownFile.path)}${markdownFile.suffix}`
  if (pagePath) {
    const parsed = parsePageHref(href, pagePath, index)
    if (parsed) {
      const path = withoutIndexFile(parsed.path)
      if (!path) return null
      return `${pageUrl(path)}${parsed.suffix}`
    }
  }
  if (href.startsWith('/page/')) return pageHrefWithoutIndexFile(href)
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
