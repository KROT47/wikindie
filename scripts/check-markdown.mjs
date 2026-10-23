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
const wiki = await server.ssrLoadModule('/src/components/editor/wikiReferences.ts')
const widths = await server.ssrLoadModule('/src/components/editor/imageWidths.ts')

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

  const protectedMarkdown = wiki.protectWikiReferences(source)
  assert.match(protectedMarkdown, /See \[Workspace\]\(\/page\/Workspace#wikindie-ref\)/)
  assert.match(protectedMarkdown, /\[Вики\]\(\/page\/Workspace#wikindie-ref\)/)
  assert.match(protectedMarkdown, /Q\["\[\[Workspace\]\]"\]/)
  assert.match(protectedMarkdown, /L\["\[\[Workspace\|Label\]\]"\]/)

  const indented = 'Intro [[Workspace]]\n\n    [[Workspace]]\n    :idea:\n'
  const protectedIndent = wiki.protectWikiReferences(indented)
  assert.match(protectedIndent, /^Intro \[Workspace\]\(\/page\/Workspace#wikindie-ref\)/m)
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

  const restored = wiki.restoreProtectedWikiReferences(source)
  assert.match(restored, /Look at \[\[Workspace\]\]\./)
  assert.match(restored, /B\["\[Workspace\]\(\/page\/Workspace#wikindie-ref\)"\]/)
  assert.match(restored, /> \[Workspace\]\(\/page\/Workspace#wikindie-ref\)/)
})

test('ordinary links and images outside code still convert', () => {
  const source = 'Visit [[Workspace/Projects]] and ![shot](' + outsideImage + ').'
  const protectedMarkdown = wiki.protectWikiReferences(source)
  assert.match(protectedMarkdown, /\[Workspace\/Projects\]\(\/page\/Workspace\/Projects#wikindie-ref\)/)
  const widened = widths.applyImageWidths(source, new Map([[outsideImage, 80]]))
  assert.match(widened, /!\[shot\]\(https:\/\/example\.com\/outside\.png#w=80\)/)
  assert.equal(icons.renderIconShortcodes('A :idea: B'), `A ${idea} B`)
})
