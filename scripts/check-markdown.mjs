import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, String(value)) },
  removeItem: (key) => { storage.delete(key) },
  clear: () => { storage.clear() },
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
}
globalThis.window = { location: { origin: 'http://localhost' }, localStorage: globalThis.localStorage }

const frontendRoot = fileURLToPath(new URL('../packages/frontend/', import.meta.url))
const server = await createServer({
  root: frontendRoot,
  configFile: new URL('../packages/frontend/vite.config.ts', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
})

const icons = await server.ssrLoadModule('/src/lib/icons.ts')
const paths = await server.ssrLoadModule('/src/lib/paths.ts')
const wiki = await server.ssrLoadModule('/src/components/editor/wikiReferences.ts')
const widths = await server.ssrLoadModule('/src/components/editor/imageWidths.ts')
const anchors = await server.ssrLoadModule('/src/lib/anchors.ts')

after(() => server.close())

const idea = icons.resolveWikiIcon('idea').glyph
const outsideImage = 'https://example.com/outside.png'

function assertUntouched(source, result, marker) {
  const start = result.indexOf(marker)
  assert.notEqual(start, -1, `missing marker in:\n${result}`)
  assert.ok(result.includes(source.slice(source.indexOf(marker), source.indexOf(marker) + marker.length)))
}

test('shortcodes outside code become glyphs and fenced code is unchanged', () => {
  const source = [
    'Outside :idea: stays useful.',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[":idea:"] --> B["[[Workspace]]"]',
    '  B --> C["![shot](' + outsideImage + ')"]',
    '```',
    '',
    '~~~mermaid',
    'flowchart LR',
    '  D[":idea:"] --> E["[[Workspace|Вики]]"]',
    '~~~',
    '',
    '````markdown',
    '```',
    ':idea: and [[Workspace]] and ![shot](' + outsideImage + ')',
    '```',
    'still inside',
    '````',
    '',
    'Inline `:idea:` stays literal.',
  ].join('\n')

  const result = icons.renderIconShortcodes(source)
  assert.match(result, new RegExp(`^Outside ${idea} stays useful.`, 'm'))
  assert.match(result, /A\[":idea:"\]/)
  assert.match(result, /D\[":idea:"\]/)
  assert.match(result, /```\n:idea: and \[\[Workspace\]\]/)
  assert.match(result, /Inline `:idea:` stays literal\./)
  assert.doesNotMatch(result.slice(result.indexOf('```mermaid')), new RegExp(idea))
})

test('wiki links inside backticks, tildes, quotes, and lists stay literal', () => {
  const source = [
    'See [[Workspace]] and [[Workspace|Вики]].',
    '',
    '> ```mermaid',
    '> flowchart TD',
    '>   Q["[[Workspace]]"] --> R[":idea:"]',
    '> ```',
    '',
    '- ```mermaid',
    '  flowchart TD',
    '    L["[[Workspace|Label]]"] --> M["![shot](' + outsideImage + ')"]',
    '  ```',
    '',
    '    [[Workspace]]',
    '    :idea:',
  ].join('\n')

  const protectedMarkdown = wiki.protectWikiReferences(source, 'Notes')
  assert.match(protectedMarkdown, /See \[Workspace\]\(\.\/Workspace\)/)
  assert.match(protectedMarkdown, /\[Вики\]\(\.\/Workspace\)/)
  assert.match(protectedMarkdown, /Q\["\[\[Workspace\]\]"\]/)
  assert.match(protectedMarkdown, /L\["\[\[Workspace\|Label\]\]"\]/)
  assert.doesNotMatch(protectedMarkdown, /#wikindie-ref/)
  assert.equal(wiki.restoreProtectedWikiReferences(protectedMarkdown, 'Notes'), protectedMarkdown)

  const indented = 'Intro [[Workspace]]\n\n    [[Workspace]]\n    :idea:\n'
  const protectedIndent = wiki.protectWikiReferences(indented, 'Notes')
  assert.match(protectedIndent, /^Intro \[Workspace\]\(\.\/Workspace\)/m)
  assert.match(protectedIndent, /^ {4}\[\[Workspace\]\]$/m)
  const iconsInIndent = icons.renderIconShortcodes(indented)
  assert.match(iconsInIndent, /^ {4}:idea:$/m)
  assert.ok(!iconsInIndent.includes(idea))
})

test('image widths and restored wiki links skip every code span', () => {
  const source = [
    '![outside](' + outsideImage + ')',
    '',
    'Look at [Workspace](/page/Workspace#wikindie-ref).',
    '',
    '```mermaid',
    'flowchart TD',
    '  A["![outside](' + outsideImage + ')"] --> B["[Workspace](/page/Workspace#wikindie-ref)"]',
    '```',
    '',
    '> ```',
    '> ![outside](' + outsideImage + ')',
    '> [Workspace](/page/Workspace#wikindie-ref)',
    '> ```',
  ].join('\n')

  const widened = widths.applyImageWidths(source, new Map([[outsideImage, 320]]))
  assert.match(widened, /!\[outside\]\(https:\/\/example\.com\/outside\.png#w=320\)/)
  assert.equal(widened.split('#w=320').length - 1, 1)

  const restored = wiki.restoreProtectedWikiReferences(source, 'Notes')
  assert.match(restored, /Look at \[Workspace\]\(\.\/Workspace\)\./)
  assert.doesNotMatch(restored, /\[\[Workspace\]\]/)
  assert.match(restored, /B\["\[Workspace\]\(\/page\/Workspace#wikindie-ref\)"\]/)
  assert.match(restored, /> \[Workspace\]\(\/page\/Workspace#wikindie-ref\)/)
  assert.equal(wiki.restoreProtectedWikiReferences(restored, 'Notes'), restored)
})

test('ordinary links and images outside code still convert', () => {
  const source = 'Visit [[Workspace/Projects]] and ![shot](' + outsideImage + ').'
  const protectedMarkdown = wiki.protectWikiReferences(source, 'Notes')
  assert.match(protectedMarkdown, /\[Workspace\/Projects\]\(Workspace\/Projects\)/)
  const widened = widths.applyImageWidths(source, new Map([[outsideImage, 80]]))
  assert.match(widened, /!\[shot\]\(https:\/\/example\.com\/outside\.png#w=80\)/)
  assert.equal(icons.renderIconShortcodes('A :idea: B'), `A ${idea} B`)
})

test('relative page links round-trip the way the browser resolves /page/<path>', () => {
  const cases = [
    ['domain/ACTIVITY_LIFECYCLE', 'domain/GAME_PROGRESSION', './GAME_PROGRESSION'],
    ['domain/ACTIVITY_LIFECYCLE', 'domain/ACTIVITY_LIFECYCLE/STEP', 'ACTIVITY_LIFECYCLE/STEP'],
    ['domain/ACTIVITY_LIFECYCLE/STEP', 'domain/ACTIVITY_LIFECYCLE', '../ACTIVITY_LIFECYCLE'],
    ['domain/ACTIVITY_LIFECYCLE', 'Planning/Decision Log', '../Planning/Decision%20Log'],
    ['Planning/Decision Log', 'domain/ACTIVITY_LIFECYCLE', '../domain/ACTIVITY_LIFECYCLE'],
    ['Planning/Notes', 'Planning/Decision Log', './Decision%20Log'],
    ['domain/ACTIVITY_LIFECYCLE', 'domain/Foo (bar)', './Foo%20%28bar%29'],
    ['Workspace', 'Workspace/Projects', 'Workspace/Projects'],
    ['Workspace', 'Other', './Other'],
    ['a/b/c', 'a', '../../a'],
    ['domain/ACTIVITY_LIFECYCLE', 'domain/ACTIVITY_LIFECYCLE', './ACTIVITY_LIFECYCLE'],
  ]
  for (const [from, to, href] of cases) {
    assert.equal(paths.relativePageHref(from, to), href, `${from} -> ${to}`)
    assert.equal(paths.pagePathFromHref(href, from), to, `${href} from ${from}`)
    assert.equal(paths.relativePageHref(from, paths.pagePathFromHref(href, from)), href)
  }

  assert.equal(paths.pageUrl('Planning/Decision Log'), '/page/Planning/Decision%20Log')
  assert.equal(paths.pagePathFromLocation('/page/domain/ACTIVITY_LIFECYCLE'), 'domain/ACTIVITY_LIFECYCLE')
  assert.equal(paths.pagePathFromHref('https://example.com/docs', 'Notes'), null)
  assert.equal(paths.pagePathFromHref('mailto:dev@example.com', 'Notes'), null)
  assert.equal(paths.pagePathFromHref('/api/attachments/pg_1/file.png', 'Notes'), null)
  assert.equal(paths.pagePathFromHref('#section', 'Notes'), null)

  const fromSectionOwner = 'domain/ACTIVITY_LIFECYCLE'
  assert.equal(paths.relativePageHref(fromSectionOwner, 'domain/GAME_PROGRESSION'), './GAME_PROGRESSION')
  assert.equal(
    wiki.protectWikiReferences('[[Planning/Decision Log|Журнал решений]]', fromSectionOwner),
    '[Журнал решений](../Planning/Decision%20Log)',
  )
  const saved = wiki.restoreProtectedWikiReferences(
    [
      '[GAME_PROGRESSION](./GAME_PROGRESSION)',
      '[test](../domain/ACTIVITY_LIFECYCLE)',
      '[Журнал решений](../Planning/Decision%20Log)',
      '[site](https://example.com/docs)',
      '[mail](mailto:dev@example.com)',
      '[file](/api/attachments/pg_1/file.png)',
    ].join('\n'),
    'Planning/Notes',
  )
  assert.match(saved, /^\[GAME_PROGRESSION\]\(\.\/GAME_PROGRESSION\)$/m)
  assert.match(saved, /^\[test\]\(\.\.\/domain\/ACTIVITY_LIFECYCLE\)$/m)
  assert.match(saved, /^\[Журнал решений\]\(\.\/Decision%20Log\)$/m)
  assert.match(saved, /^\[site\]\(https:\/\/example\.com\/docs\)$/m)
  assert.match(saved, /^\[mail\]\(mailto:dev@example\.com\)$/m)
  assert.match(saved, /^\[file\]\(\/api\/attachments\/pg_1\/file\.png\)$/m)
  assert.equal(wiki.restoreProtectedWikiReferences(saved, 'Planning/Notes'), saved)
  const converted = wiki.restoreProtectedWikiReferences(
    wiki.protectWikiReferences('See [[Workspace|Вики]] and `[[Workspace|Вики]]`.', 'Planning/Notes'),
    'Planning/Notes',
  )
  assert.equal(converted, 'See [Вики](../Workspace) and `[[Workspace|Вики]]`.')
  assert.equal(wiki.restoreProtectedWikiReferences(converted, 'Planning/Notes'), converted)
  assert.equal(wiki.preserveRelativeHref('https://./GAME_PROGRESSION'), './GAME_PROGRESSION')
  assert.equal(wiki.preserveRelativeHref('https://../domain/ACTIVITY_LIFECYCLE'), '../domain/ACTIVITY_LIFECYCLE')
  assert.equal(wiki.preserveRelativeHref('https:///page/Workspace'), '/page/Workspace')
  assert.equal(wiki.preserveRelativeHref('https://ACTIVITY_LIFECYCLE/STEP'), 'ACTIVITY_LIFECYCLE/STEP')
  assert.equal(wiki.preserveRelativeHref('https://example.com/docs'), 'https://example.com/docs')
  assert.equal(wiki.preserveRelativeHref('mailto:dev@example.com'), 'mailto:dev@example.com')
})

test('file and folder pages resolve relative links from the containing directory', () => {
  const link = (href, from, index = false) => paths.previewNavigationHref(href, from, index)

  assert.equal(link('./PRODUCT', 'product/ABOUT'), '/page/product/PRODUCT')
  assert.equal(link('./PRODUCT.md', 'product/ABOUT'), '/page/product/PRODUCT.md')
  assert.equal(link('../OTHER', 'product/ABOUT'), '/page/OTHER')
  assert.equal(link('./ideas/_Index.md', 'product/ABOUT'), '/page/product/ideas')
  assert.equal(link('./PRODUCT', 'ABOUT'), '/page/PRODUCT')
  assert.equal(link('./ideas/_Index.md', 'ABOUT'), '/page/ideas')
  assert.equal(link('./notes.md', 'Planning/Decision Log'), '/page/Planning/notes.md')
  assert.equal(link('../X.md', 'a/b/c'), '/page/a/X.md')
  assert.equal(link('../../X.md', 'a/b/c'), '/page/X.md')
  assert.equal(link('../../../X.md', 'a/b/c'), null)
  assert.equal(link('./d/e/X.md', 'a/b/c'), '/page/a/b/d/e/X.md')

  assert.equal(link('./PRODUCT', 'product', true), '/page/product/PRODUCT')
  assert.equal(link('./ABOUT.md', 'product', true), '/page/product/ABOUT.md')
  assert.equal(link('../OTHER', 'product', true), '/page/OTHER')
  assert.equal(link('./ideas/_Index.md', 'product', true), '/page/product/ideas')
  assert.equal(link('./X.md', 'category', true), '/page/category/X.md')
  assert.equal(link('./X.md#part', 'category', true), '/page/category/X.md#part')
  assert.equal(link('./ideas/_Index.md#note', 'category', true), '/page/category/ideas#note')
  assert.equal(link('./nested/ideas/_Index.md', 'a/b', true), '/page/a/b/nested/ideas')
  assert.equal(link('../X.md', 'a/b/c', true), '/page/a/b/X.md')
  assert.equal(link('../../X.md', 'a/b/c', true), '/page/a/X.md')
  assert.equal(link('../../../X.md', 'a/b/c', true), '/page/X.md')
  assert.equal(link('../../../../X.md', 'a/b/c', true), null)
  assert.equal(link('./_Index.md', 'category', true), '/page/category')
  assert.equal(link('../_Index.md', 'Workspace/Projects/Atlas', true), '/page/Workspace/Projects')
  assert.equal(link('./PRODUCT', 'ABOUT', true), '/page/ABOUT/PRODUCT')

  assert.equal(link('./ideas/_Index.md', ''), '/page/ideas')
  assert.equal(link('./ideas/_Index.md#note', ''), '/page/ideas#note')
  assert.equal(link('/page/ideas/_Index.md', 'product/ABOUT'), '/page/ideas')
  assert.equal(link('./GAME_PROGRESSION', 'domain/ACTIVITY_LIFECYCLE'), '/page/domain/GAME_PROGRESSION')
  assert.equal(link('ACTIVITY_LIFECYCLE/STEP', 'domain/ACTIVITY_LIFECYCLE'), '/page/domain/ACTIVITY_LIFECYCLE/STEP')
  assert.equal(link('https://example.com/X.md', 'product/ABOUT'), null)
  assert.equal(link('mailto:dev@example.com', 'category'), null)

  assert.equal(paths.relativePageHref('product/ABOUT', 'product/PRODUCT'), './PRODUCT')
  assert.equal(paths.relativePageHref('product', 'product/PRODUCT', true), './PRODUCT')
  assert.equal(paths.pagePathFromHref('./PRODUCT', 'product/ABOUT'), 'product/PRODUCT')
  assert.equal(paths.pagePathFromHref('./PRODUCT', 'product', true), 'product/PRODUCT')
  assert.equal(paths.relativePageHref('product', paths.pagePathFromHref('./PRODUCT', 'product', true), true), './PRODUCT')
  assert.equal(paths.relativePageHref('ABOUT', 'PRODUCT'), './PRODUCT')
  assert.equal(wiki.protectWikiReferences('[[product/PRODUCT|Продукт]]', 'product/ABOUT'), '[Продукт](./PRODUCT)')
  assert.equal(wiki.protectWikiReferences('[[product/PRODUCT|Продукт]]', 'product', true), '[Продукт](./PRODUCT)')
  assert.equal(
    wiki.restoreProtectedWikiReferences('[X](./X.md)\n[Ideas](./ideas/_Index.md)', 'product/ABOUT'),
    '[X](./X.md)\n[Ideas](./ideas/_Index.md)',
  )
  assert.equal(anchors.relativeHeadingHref('product', 'overview', true), '../product#overview')
  assert.equal(anchors.relativeHeadingHref('product/ABOUT', 'overview'), './ABOUT#overview')
})

test('page hrefs keep fragments out of the document path', () => {
  const parsed = paths.parsePageHref('/page/Guide#installation', 'Notes')
  assert.equal(parsed.path, 'Guide')
  assert.equal(parsed.suffix, '#installation')
  assert.equal(paths.pagePathFromHref('/page/Guide#installation', 'Notes'), 'Guide')
  assert.equal(paths.pagePathFromHref('#installation', 'Notes'), null)
  assert.deepEqual(paths.parsePageHref('/page/Guide?tab=1#installation', 'Notes'), {
    path: 'Guide',
    suffix: '?tab=1#installation',
  })
  assert.equal(paths.parsePageHref('/page/Workspace#wikindie-ref', 'Notes').suffix, '')
  assert.equal(paths.parsePageHref('#installation', 'Notes'), null)

  assert.equal(
    wiki.restoreProtectedWikiReferences('[Установка](/page/Guide#installation)', 'Notes'),
    '[Установка](./Guide#installation)',
  )
  assert.equal(
    wiki.restoreProtectedWikiReferences('[Установка](./Guide#installation)', 'Notes'),
    '[Установка](./Guide#installation)',
  )
  assert.equal(
    wiki.protectWikiReferences('[[Guide#installation|Установка]]', 'Notes'),
    '[Установка](./Guide%23installation)',
  )

  assert.equal(paths.previewNavigationHref('#installation', 'Guide'), '/page/Guide#installation')
  assert.equal(paths.previewNavigationHref('./Other#setup', 'Guide'), '/page/Other#setup')
  assert.equal(paths.previewNavigationHref('/page/Guide#installation', 'Notes'), '/page/Guide#installation')
  const cyrillicLink = paths.previewNavigationHref('../Planning/Decision%20Log#установка', 'Workspace/Projects')
  assert.equal(cyrillicLink.split('#')[0], '/page/Planning/Decision%20Log')
  assert.equal(anchors.decodeFragment(new URL(cyrillicLink, 'http://localhost').hash), 'установка')
  assert.equal(paths.previewNavigationHref('#installation', ''), null)
  assert.equal(paths.safeInternalReturnPath('/page/Guide#installation'), '/page/Guide#installation')
  assert.equal(paths.safeInternalReturnPath('https://evil.example/page/Guide'), '/')
  assert.equal(paths.safeInternalReturnPath('//evil.example'), '/')
  assert.equal(paths.safeInternalReturnPath('/\\evil'), '/')

  assert.equal(anchors.relativeHeadingHref('Guide', 'installation'), './Guide#installation')
  assert.equal(anchors.relativeHeadingHref('Planning/Decision Log', 'установка'), './Decision%20Log#установка')
  const href = anchors.anchorHref('Planning/Decision Log', 'установка', 'http://localhost:5173')
  const url = new URL(href)
  assert.equal(url.pathname, '/page/Planning/Decision%20Log')
  assert.equal(anchors.decodeFragment(url.hash), 'установка')
  assert.equal(anchors.decodeFragment('#installation'), 'installation')
  assert.equal(anchors.decodeFragment(''), '')
  assert.equal(anchors.decodeFragment('#%'), '%')
})

test('heading slugs stay unique across the page and sections', () => {
  const source = [
    '# Installation',
    '',
    '## Hello, world!',
    '',
    '# Use `npm` **now**',
    '',
    '# See [the guide](/page/Guide#installation)',
    '',
    '# См. [[Guide|Установка]]',
    '',
    '# Hello :idea:',
    '',
    '```mermaid',
    'flowchart TD',
    '  A["# Not a heading"] --> B',
    '```',
    '',
    'Inline `# not a heading`.',
    '',
    '# Установка',
    '',
    '# Установка',
    '',
    '#',
    '',
    '# !!!',
    '',
    '# Wikindie ref',
  ].join('\n')

  const plan = anchors.assignPageAnchors(source, [
    { path: '_sections/start-here.md', content: '# Section start here\n\n# Intro\n' },
    { path: '_sections/start-here.md', content: '# Notes\n' },
    { path: '_sections/операции.md', content: '# Операции\n' },
  ])

  assert.deepEqual(plan.bodyHeadingIds, [
    'installation',
    'hello-world',
    'use-npm-now',
    'see-the-guide',
    'см-установка',
    'hello-',
    'установка',
    'установка-1',
    'heading',
    'heading-1',
    'wikindie-ref-1',
  ])
  assert.deepEqual(anchors.stampedHeadingIds(source, plan.bodyHeadingIds), plan.bodyHeadingIds)
  assert.deepEqual(plan.sections.map((section) => section.headingIds), [
    ['section-start-here', 'intro'],
    ['notes'],
    ['операции'],
  ])
  assert.deepEqual(plan.sections.map((section) => section.anchorId), [
    'section-start-here-1',
    'section-start-here-2',
    'section-операции',
  ])
  assert.equal(anchors.sectionAnchorBase('_sections/start-here.md'), 'section-start-here')
  assert.equal(anchors.sectionAnchorBase('_sections/My Notes.md'), 'section-My-Notes')
  assert.equal(new Set(plan.bodyHeadingIds).has('wikindie-ref'), false)
})
