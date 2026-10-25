import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { filterSuggestionItems } from '@blocknote/core'
import {
  getDefaultReactEmojiPickerItems,
  getDefaultReactSlashMenuItems,
  GridSuggestionMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { Link2, Workflow } from 'lucide-react'
import '@blocknote/shadcn/style.css'
import './blocknote.css'
import { api, isAttachmentUrl } from '../../lib/api'
import { resolveAttachmentObjectUrl } from '../../lib/attachmentCache'
import { previewNavigationHref } from '../../lib/paths'
import { useFilesStore } from '../../lib/store'
import { applyImageWidths, collectImageWidths, restoreImageWidths } from './imageWidths'
import { pagePickerItems } from './pagePicker'
import { preserveRelativeHref, protectWikiReferences, restoreProtectedWikiReferences } from './wikiReferences'

const HIDDEN_SLASH_ITEMS = new Set(['Audio', 'Video'])

const ALLOWED_LINK_PROTOCOL = /^(https?|ftp|ftps|mailto|tel|callto|sms|cid|xmpp):/i
const LINK_SCHEME = /^[a-z][a-z0-9+.-]*:/i

function isRelativeHref(href: string) {
  if (!href || href.startsWith('/') || href.startsWith('#') || href.startsWith('//')) return false
  if (LINK_SCHEME.test(href)) return false
  return true
}

function isValidWikindieLink(href: string | undefined) {
  if (!href) return false
  if (href.startsWith('/')) return true
  if (href.startsWith('#')) return true
  if (ALLOWED_LINK_PROTOCOL.test(href)) return true
  return isRelativeHref(href)
}

function isEditorNavigationHref(href: string) {
  return href.startsWith('/') || isRelativeHref(href)
}

function navigationHref(href: string, pagePath: string) {
  return previewNavigationHref(href, pagePath) ?? (href.startsWith('/') ? href : null)
}

function anchorFromEvent(event: Event) {
  const target = event.target
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const anchor = element?.closest('a[href]')
  return anchor instanceof HTMLAnchorElement ? anchor : null
}

type Props = {
  pageId?: string
  pagePath?: string
  value: string
  onChange: (markdown: string) => void
  editable?: boolean
  className?: string
}

export function BlockEditor({ pageId, pagePath = '', value, onChange, editable = true, className }: Props) {
  const pagePathRef = useRef(pagePath)
  const editableRef = useRef(editable)
  pagePathRef.current = pagePath
  editableRef.current = editable
  const editor = useCreateBlockNote({
    links: {
      isValidLink: isValidWikindieLink,
      onClick: (event) => {
        const href = anchorFromEvent(event)?.getAttribute('href') ?? ''
        if (!isEditorNavigationHref(href)) return false
        const wantsNavigation = event.ctrlKey || event.metaKey || event.shiftKey
        if (!editableRef.current || wantsNavigation) return true
        return false
      },
    },
    uploadFile: pageId ? async (file) => (await api.uploadAttachment(pageId, file)).attachment.url : undefined,
    resolveFileUrl: pageId ? async (url) => (isAttachmentUrl(url) ? resolveAttachmentObjectUrl(url) : url) : undefined,
  }, [pageId])
  const patchedEditor = useRef<typeof editor | null>(null)
  if (patchedEditor.current !== editor) {
    patchedEditor.current = editor
    const editLink = editor.editLink.bind(editor)
    editor.editLink = (url, text, position) => editLink(preserveRelativeHref(url), text, position)
  }
  const navigate = useNavigate()
  const tree = useFilesStore((state) => state.tree)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const lastEmittedMd = useRef<string>(value)
  const seededPath = useRef(pagePath)
  const isReseeding = useRef(false)
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current && value === lastEmittedMd.current && pagePath === seededPath.current) return
    seeded.current = true
    seededPath.current = pagePath
    const parsed = editor.tryParseMarkdownToBlocks(protectWikiReferences(value, pagePath))
    restoreImageWidths(parsed)
    const blocks = parsed.length ? parsed : [{ type: 'paragraph' as const }]
    isReseeding.current = true
    editor.replaceBlocks(editor.document, blocks)
    lastEmittedMd.current = value
    queueMicrotask(() => {
      isReseeding.current = false
    })
  }, [editor, pagePath, value])

  const handleChange = useCallback(() => {
    if (isReseeding.current) return
    const md = applyImageWidths(
      restoreProtectedWikiReferences(editor.blocksToMarkdownLossy(editor.document), pagePath),
      collectImageWidths(editor.document),
    )
    if (md === lastEmittedMd.current) return
    lastEmittedMd.current = md
    onChange(md)
  }, [editor, onChange, pagePath])

  useEffect(() => {
    const root = wrapperRef.current
    if (!root) return

    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0 && event.button !== 1) return
      const eventTarget = event.target as HTMLElement | null
      const anchor = eventTarget?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!isEditorNavigationHref(href)) return
      const wantsNavigation = event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey
      if (editable && !wantsNavigation) {
        event.preventDefault()
        return
      }
      const destination = navigationHref(href, pagePathRef.current)
      if (!destination) return
      event.preventDefault()
      event.stopPropagation()
      navigate(destination)
    }

    root.addEventListener('click', handler, true)
    root.addEventListener('auxclick', handler, true)
    return () => {
      root.removeEventListener('click', handler, true)
      root.removeEventListener('auxclick', handler, true)
    }
  }, [navigate, editable])

  return (
    <div ref={wrapperRef} className={className}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        slashMenu={false}
        filePanel
        data-wikindie-editor=""
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => {
            const pageLink: DefaultReactSuggestionItem = {
              title: 'Page link',
              subtext: 'Insert a link to another page',
              aliases: ['page', 'wiki', 'link', 'ref'],
              group: 'Insert',
              icon: <Link2 size={16} />,
              onItemClick: () => {
                const ext = editor.getExtension('suggestionMenu') as
                  | { openSuggestionMenu?: (trigger: string, opts?: { deleteTriggerCharacter?: boolean }) => void }
                  | undefined
                ext?.openSuggestionMenu?.('[[', { deleteTriggerCharacter: false })
              },
            }
            const mermaidDiagram: DefaultReactSuggestionItem = {
              title: 'Mermaid diagram',
              subtext: 'Insert a Mermaid code block',
              aliases: ['mermaid', 'diagram', 'chart'],
              group: 'Insert',
              icon: <Workflow size={16} />,
              onItemClick: () => {
                editor.insertBlocks(
                  [{
                    type: 'codeBlock',
                    props: { language: 'mermaid' },
                    content: 'flowchart TD\n  A --> B',
                  }],
                  editor.getTextCursorPosition().block,
                  'after',
                )
              },
            }
            return filterSuggestionItems(
              [
                pageLink,
                mermaidDiagram,
                ...getDefaultReactSlashMenuItems(editor).filter((item) => !HIDDEN_SLASH_ITEMS.has(item.title) && (pageId || item.title !== 'File')),
              ],
              query,
            )
          }}
        />
        <SuggestionMenuController
          triggerCharacter="[["
          getItems={async (query) => pagePickerItems(editor, tree, query, pagePath)}
        />
        <GridSuggestionMenuController
          triggerCharacter=":"
          columns={9}
          minQueryLength={2}
          getItems={async (query) => getDefaultReactEmojiPickerItems(editor, query)}
        />
      </BlockNoteView>
    </div>
  )
}
