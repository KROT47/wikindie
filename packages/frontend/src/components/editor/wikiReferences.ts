import { replaceOutsideCode } from '../../lib/markdownSegments'
import { renderIconShortcodes } from '../../lib/icons'
import { pageUrl, parsePageHref, relativePageHref } from '../../lib/paths'

function escapeMarkdownLinkText(value: string) {
  return value.replace(/[\\[\]]/g, '\\$&')
}

function protectedReferenceFor(value: string, pagePath: string, index: boolean) {
  const [rawPath, ...rawLabel] = value.split('|')
  const path = rawPath.trim()
  if (!path) return `[[${value}]]`
  const label = rawLabel.length ? rawLabel.join('|').trim() || path : path
  return `[${escapeMarkdownLinkText(label)}](${relativePageHref(pagePath, path, index)})`
}

function protectReferencesInLine(line: string, pagePath: string, folder: boolean) {
  let result = ''
  let index = 0

  while (index < line.length) {
    if (line[index] === '`') {
      const tickStart = index
      while (index < line.length && line[index] === '`') index++
      const ticks = line.slice(tickStart, index)
      const codeEnd = line.indexOf(ticks, index)
      if (codeEnd < 0) return result + line.slice(tickStart)
      result += line.slice(tickStart, codeEnd + ticks.length)
      index = codeEnd + ticks.length
      continue
    }

    if (line.startsWith('[[', index)) {
      const end = line.indexOf(']]', index + 2)
      if (end >= 0) {
        result += protectedReferenceFor(line.slice(index + 2, end), pagePath, folder)
        index = end + 2
        continue
      }
    }

    result += line[index]
    index++
  }

  return result
}

export function protectWikiReferences(value: string, pagePath: string, index = false) {
  return replaceOutsideCode(value, (segment) => segment.split('\n').map((line) => protectReferencesInLine(line, pagePath, index)).join('\n'))
}

function isFilesystemMarkdownHref(href: string) {
  const trimmed = href.trim()
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed
  if (!unwrapped || unwrapped.startsWith('#') || unwrapped.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(unwrapped)) return false
  const path = unwrapped.split(/[?#]/)[0] ?? ''
  return path.endsWith('.md')
}

function restoredReferenceFor(label: string, href: string, fallback: string, pagePath: string, index: boolean) {
  // File links such as `./X.md` and `./ideas/_Index.md` stay in the Markdown.
  // The UI drops `_Index.md` only when it builds the `/page/...` route.
  if (isFilesystemMarkdownHref(href)) return fallback
  const parsed = parsePageHref(href, pagePath, index)
  if (!parsed) return fallback
  return `[${label}](${relativePageHref(pagePath, parsed.path, index)}${parsed.suffix})`
}

export function restoreProtectedWikiReferences(value: string, pagePath: string, index = false) {
  return replaceOutsideCode(value, (segment) => segment.replace(
    /\[((?:\\.|[^\\\]\n])*)\]\(([^)\n]+)\)/g,
    (match, label: string, href: string) => restoredReferenceFor(label, href, match, pagePath, index),
  ))
}

// BlockNote's link form prefixes a missing protocol with `https://`.
// `./`, `../`, `/page/...`, and a dot-less path are page links, not hosts.
function previewReferenceFor(value: string) {
  const [rawPath, ...rawLabel] = value.split('|')
  const path = rawPath.trim()
  if (!path) return `[[${value}]]`
  const label = rawLabel.length ? rawLabel.join('|').trim() || path : path
  return `[${escapeMarkdownLinkText(label)}](${pageUrl(path)})`
}

function expandReferencesInLine(line: string) {
  let result = ''
  let index = 0

  while (index < line.length) {
    if (line[index] === '`') {
      const tickStart = index
      while (index < line.length && line[index] === '`') index++
      const ticks = line.slice(tickStart, index)
      const codeEnd = line.indexOf(ticks, index)
      if (codeEnd < 0) return result + line.slice(tickStart)
      result += line.slice(tickStart, codeEnd + ticks.length)
      index = codeEnd + ticks.length
      continue
    }

    if (line.startsWith('[[', index)) {
      const end = line.indexOf(']]', index + 2)
      if (end >= 0) {
        result += previewReferenceFor(line.slice(index + 2, end))
        index = end + 2
        continue
      }
    }

    result += line[index]
    index++
  }

  return result
}

export function expandPreviewWikiReferences(value: string) {
  return replaceOutsideCode(value, (segment) => segment.split('\n').map(expandReferencesInLine).join('\n'))
}

export function preparePreviewMarkdown(content: string) {
  return expandPreviewWikiReferences(renderIconShortcodes(content))
}

export function preserveRelativeHref(href: string) {
  if (!/^https:\/\//i.test(href)) return href
  const rest = href.slice('https://'.length)
  if (!rest) return href
  if (rest.startsWith('/') || rest.startsWith('#') || rest.startsWith('./') || rest.startsWith('../')) return rest
  const host = rest.split(/[/?#]/)[0] ?? ''
  if (!host || host.includes('.') || host.includes(':')) return href
  return rest
}
