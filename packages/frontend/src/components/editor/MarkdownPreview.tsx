import { Children, isValidElement, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, isAttachmentUrl } from '../../lib/api'
import { createRemarkHeadingIds } from '../../lib/anchors'
import { resolveAttachmentObjectUrl } from '../../lib/attachmentCache'
import { findTreeNode, previewNavigationHref } from '../../lib/paths'
import { useFilesStore } from '../../lib/store'
import { parseImageWidth } from './imageWidths'
import { MermaidDiagram } from './MermaidDiagram'
import { CopyAnchorButton } from './CopyAnchorButton'
import { preparePreviewMarkdown } from './wikiReferences'

function isExternalUrl(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

function internalPathFor(href: string, pagePath: string, index: boolean): string | null {
  const preview = previewNavigationHref(href, pagePath, index)
  if (preview) return preview
  if (!href) return null
  try {
    const url = new URL(href, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/page/')) {
      return url.pathname + url.search + url.hash
    }
  } catch {
    // not a parseable URL, fall through
  }
  // Malformed protocol-only forms (e.g. "https:///page/Foo") can come from
  // typed paths that are missing a recognised scheme. Do not match real hosts.
  const malformedProtocolPath = href.match(/^[a-z][a-z0-9+.-]*:\/\/(\/page\/.*)$/i)
  if (malformedProtocolPath) return malformedProtocolPath[1]
  return null
}

function filenameFromUrl(url: string) {
  try {
    const parts = new URL(url, window.location.origin).pathname.split('/').filter(Boolean)
    return decodeURIComponent(parts[parts.length - 1] ?? 'attachment')
  } catch {
    return 'attachment'
  }
}

function AttachmentImage({ src = '', alt = '', style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { src: cleanSrc, width } = parseImageWidth(src)
  const isAttachment = Boolean(cleanSrc) && isAttachmentUrl(cleanSrc)
  // Never render the raw attachment URL: an <img> cannot send the bearer token,
  // so it would 401. Resolve through the authenticated shared cache first.
  const [resolvedSrc, setResolvedSrc] = useState(isAttachment ? '' : cleanSrc)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isAttachment) {
      setResolvedSrc(cleanSrc)
      setFailed(false)
      return
    }

    let cancelled = false
    setResolvedSrc('')
    setFailed(false)
    resolveAttachmentObjectUrl(cleanSrc)
      .then((objectUrl) => { if (!cancelled) setResolvedSrc(objectUrl) })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
  }, [cleanSrc, isAttachment])

  const sizeStyle = width ? { width, maxWidth: '100%', ...style } : style

  if (failed) {
    return <span className="inline-block rounded border border-border bg-surface px-2 py-1 text-xs text-text-muted">Image unavailable{alt ? `: ${alt}` : ''}</span>
  }
  if (!resolvedSrc) {
    return <span className="inline-block h-24 w-40 max-w-full animate-pulse rounded bg-border/40 align-middle" style={width ? { width, height: undefined } : undefined} aria-label={alt || 'Loading image'} />
  }
  return <img src={resolvedSrc} alt={alt} style={sizeStyle} {...props} />
}

function nodeText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children)
    return ''
  }).join('')
}

function mermaidSource(children: ReactNode) {
  const code = Children.toArray(children).find((child) => {
    if (!isValidElement<{ className?: string }>(child)) return false
    return /\blanguage-mermaid\b/.test(child.props.className ?? '')
  })
  if (!isValidElement<{ children?: ReactNode }>(code)) return null
  return nodeText(code.props.children).replace(/\n$/, '')
}

function AttachmentLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handleClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const objectUrl = URL.createObjectURL(await api.attachmentBlob(href))
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filenameFromUrl(href)
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
  }

  return <a href={href} onClick={handleClick} {...props}>{children}</a>
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

function MarkdownHeading({
  level,
  pagePath,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'h2'> & {
  level: HeadingLevel
  pagePath: string
  node?: unknown
}) {
  const Tag = `h${level}` as 'h2'
  const anchorId = typeof props.id === 'string' && props.id ? props.id : undefined
  const name = nodeText(children).trim() || 'heading'
  return (
    <Tag {...props} id={anchorId} className={`group scroll-my-0 ${props.className ?? ''}`.trim()}>
      {children}
      {pagePath && anchorId ? <CopyAnchorButton variant="heading" pagePath={pagePath} anchorId={anchorId} name={name} /> : null}
    </Tag>
  )
}

function headingComponent(level: HeadingLevel, pagePath: string) {
  return function Heading(props: ComponentPropsWithoutRef<'h2'> & { node?: unknown }) {
    return <MarkdownHeading level={level} pagePath={pagePath} {...props} />
  }
}

export function MarkdownPreview({
  content,
  compact = false,
  frameless = false,
  pagePath = '',
  pageIndex,
  headingIds,
}: {
  content: string
  compact?: boolean
  frameless?: boolean
  pagePath?: string
  pageIndex?: boolean
  headingIds?: readonly string[]
}) {
  const tree = useFilesStore((state) => state.tree)
  const index = pageIndex ?? Boolean(findTreeNode(tree, pagePath)?.index)
  const source = useMemo(() => preparePreviewMarkdown(content), [content])
  const remarkPlugins = useMemo(
    () => (headingIds ? [remarkGfm, createRemarkHeadingIds(headingIds)] : [remarkGfm]),
    [headingIds],
  )
  const components = useMemo(() => ({
    h1: headingComponent(1, pagePath),
    h2: headingComponent(2, pagePath),
    h3: headingComponent(3, pagePath),
    h4: headingComponent(4, pagePath),
    h5: headingComponent(5, pagePath),
    h6: headingComponent(6, pagePath),
    a: ({ href = '', children, ...props }: ComponentPropsWithoutRef<'a'>) => {
      const internal = internalPathFor(href, pagePath, index)
      if (internal) return <Link to={internal}>{children}</Link>
      if (isAttachmentUrl(href)) return <AttachmentLink href={href} {...props}>{children}</AttachmentLink>
      if (isExternalUrl(href)) return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
      return <a href={href} {...props}>{children}</a>
    },
    img: ({ src = '', alt = '', ...props }: ComponentPropsWithoutRef<'img'>) => <AttachmentImage src={src} alt={alt} {...props} />,
    pre: ({ children }: { children?: ReactNode }) => {
      const mermaid = mermaidSource(children)
      if (mermaid != null) return <MermaidDiagram source={mermaid} />
      return <pre>{children}</pre>
    },
    table: ({ children, ...props }: ComponentPropsWithoutRef<'table'>) => (
      <div className="markdown-table-scroll">
        <table {...props}>{children}</table>
      </div>
    ),
  }), [index, pagePath])

  return (
    <article className={`markdown-preview ${compact ? 'markdown-preview-compact text-sm' : ''} text-text ${frameless ? '' : 'rounded-md border border-border bg-surface p-5'}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {source}
      </ReactMarkdown>
    </article>
  )
}
