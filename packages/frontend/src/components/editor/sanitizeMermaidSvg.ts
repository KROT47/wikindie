import DOMPurify from 'dompurify'

const forbiddenTags = ['foreignobject', 'script', 'iframe', 'object', 'embed', 'image', 'audio', 'video', 'canvas', 'link', 'meta']

const remoteUrl = /url\(\s*(['"])?\s*(?!#)/i
const unsafeCss = /javascript:|expression\s*\(|@import/i

function isLocalReference(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('#') && !unsafeCss.test(trimmed)
}

function sanitizeCss(value: string) {
  const stripped = value.replace(/url\(\s*(['"]?)\s*([^)'"]+)\1\s*\)/gi, (match, _quote: string, target: string) => {
    return target.trim().startsWith('#') ? match : ''
  })
  return unsafeCss.test(stripped) ? null : stripped
}

let hooksReady = false

function ensureHooks() {
  if (hooksReady) return
  hooksReady = true

  DOMPurify.addHook('uponSanitizeElement', (node) => {
    const name = node.nodeName.toLowerCase()
    if (forbiddenTags.includes(name)) {
      node.textContent = ''
      return
    }
    if (name === 'style' && node.textContent) {
      node.textContent = sanitizeCss(node.textContent) ?? ''
    }
  })

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase()
    if (name.startsWith('on')) {
      data.keepAttr = false
      return
    }
    if (name === 'href' || name === 'xlink:href' || name === 'src') {
      if (!isLocalReference(data.attrValue)) data.keepAttr = false
      return
    }
    if (remoteUrl.test(data.attrValue) || unsafeCss.test(data.attrValue)) {
      const cleaned = sanitizeCss(data.attrValue)
      if (cleaned == null || cleaned.trim() === '') data.keepAttr = false
      else data.attrValue = cleaned
    }
  })
}

function stillUnsafe(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror, script, foreignObject, iframe, object, embed, image')) return true
  for (const element of doc.querySelectorAll('*')) {
    for (const attr of element.attributes) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) return true
      if ((name === 'href' || name === 'xlink:href' || name.endsWith(':href') || name === 'src') && !isLocalReference(attr.value)) return true
      if (remoteUrl.test(attr.value) || unsafeCss.test(attr.value)) return true
    }
  }
  return false
}

export function sanitizeMermaidSvg(svg: string) {
  ensureHooks()
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'object', 'embed', 'image', 'audio', 'video', 'canvas', 'link', 'meta'],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: false,
  })
  if (!clean.includes('<svg') || stillUnsafe(clean)) return ''
  return clean
}
