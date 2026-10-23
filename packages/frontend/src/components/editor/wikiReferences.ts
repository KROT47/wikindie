import { replaceOutsideCode } from '../../lib/markdownSegments'
import { parsePageHref, relativePageHref } from '../../lib/paths'

function escapeMarkdownLinkText(value: string) {
  return value.replace(/[\\[\]]/g, '\\$&')
}

function protectedReferenceFor(value: string, pagePath: string) {
  const [rawPath, ...rawLabel] = value.split('|')
  const path = rawPath.trim()
  if (!path) return `[[${value}]]`
  const label = rawLabel.length ? rawLabel.join('|').trim() || path : path
  return `[${escapeMarkdownLinkText(label)}](${relativePageHref(pagePath, path)})`
}

function protectReferencesInLine(line: string, pagePath: string) {
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
        result += protectedReferenceFor(line.slice(index + 2, end), pagePath)
        index = end + 2
        continue
      }
    }

    result += line[index]
    index++
  }

  return result
}

export function protectWikiReferences(value: string, pagePath: string) {
  return replaceOutsideCode(value, (segment) => segment.split('\n').map((line) => protectReferencesInLine(line, pagePath)).join('\n'))
}

function restoredReferenceFor(label: string, href: string, fallback: string, pagePath: string) {
  const parsed = parsePageHref(href, pagePath)
  if (!parsed) return fallback
  return `[${label}](${relativePageHref(pagePath, parsed.path)}${parsed.suffix})`
}

export function restoreProtectedWikiReferences(value: string, pagePath: string) {
  return replaceOutsideCode(value, (segment) => segment.replace(
    /\[((?:\\.|[^\\\]\n])*)\]\(([^)\n]+)\)/g,
    (match, label: string, href: string) => restoredReferenceFor(label, href, match, pagePath),
  ))
}

// BlockNote's link form prefixes a missing protocol with `https://`.
// `./`, `../`, `/page/...`, and a dot-less path are page links, not hosts.
export function preserveRelativeHref(href: string) {
  if (!/^https:\/\//i.test(href)) return href
  const rest = href.slice('https://'.length)
  if (!rest) return href
  if (rest.startsWith('/') || rest.startsWith('#') || rest.startsWith('./') || rest.startsWith('../')) return rest
  const host = rest.split(/[/?#]/)[0] ?? ''
  if (!host || host.includes('.') || host.includes(':')) return href
  return rest
}
