#!/usr/bin/env node
// Browser checks for Mermaid preview. Requires the dev servers and Playwright.
// Uses Playwright Chromium, then system Chrome if that browser is not installed.
//
//   WIKINDIE_URL=http://localhost:5173 node scripts/check-mermaid.mjs

import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setDefaultResultOrder } from 'node:dns'

setDefaultResultOrder('ipv4first')

const origin = (process.env.WIKINDIE_URL || 'http://localhost:5173').replace(/\/$/, '')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = '/tmp/wikindie-mermaid'
const mermaidLibrary = /\/(?:node_modules\/\.vite\/deps\/mermaid\.js|assets\/mermaid[^/?]*\.js)(?:\?|$)/
const bannedRequest = /iconify|unpkg|jsdelivr|evil\.example|mermaid\.ink/i

const fixture = await readFile(resolve(root, 'scripts/fixtures/mermaid-acceptance.md'), 'utf8')

const roundtripBody = `Neighbor paragraph before the diagram.

\`\`\`mermaid
flowchart TD
  Start["Кириллица: привет"] --> Next["[[Workspace|Вики]]"]
  Next --> Icon[":idea:"]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant Алиса
  participant Боб
  Алиса->>Боб: Привет, мир
\`\`\`
`

const sectionBody = `Section neighbor.

\`\`\`mermaid
flowchart LR
  A["Раздел"] --> B["[[Workspace/Projects]]"]
  B --> C["![section](https://example.com/section.png)"]
\`\`\`
`

const quoteBody = `Before the fences.

> \`\`\`mermaid
> flowchart TD
>   Q["[[Workspace]]"] --> R[":idea:"]
> \`\`\`

Real link [[Workspace]] outside.
`

const unsafeBody = `Unsafe sample.

\`\`\`mermaid
%%{init: {"securityLevel":"loose","htmlLabels":true,"themeCSS":"body{background:url(https://evil.example/theme.css)}"}}%%
flowchart TD
  A["<img src=x onerror=alert(1)>"] --> B
  click A "javascript:alert(1)" "https://evil.example/clicked"
\`\`\`

\`\`\`mermaid
architecture-beta
  service db(database)[DB]
\`\`\`
`

const plainBody = `Just a paragraph and a [link](https://example.com/docs).

\`\`\`js
console.log(1)
\`\`\`
`

const boardContent = `## Open

- Render comment
  \`\`\`mermaid
  flowchart TD
    D --> E
  \`\`\`
`

function encodePage(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function mermaidFences(content) {
  return [...content.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((match) => match[1])
}

let token = ''

async function api(method, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: response.status, data }
}

async function ensurePage(name, board = false) {
  const path = `Workspace/${name}`
  const existing = await api('GET', `/api/page/${encodePage(path)}`)
  if (existing.status === 404) {
    const created = await api('POST', '/api/pages', { parentPath: 'Workspace', name, type: board ? 'board' : 'page' })
    if (created.status >= 400) throw new Error(`create ${name} failed ${created.status} ${JSON.stringify(created.data)}`)
  } else if (existing.status >= 400) {
    throw new Error(`read ${name} failed ${existing.status} ${JSON.stringify(existing.data)}`)
  }
  return path
}

async function writePage(path, content, frontmatterPatch = {}, { dropTaskComments = false } = {}) {
  const current = await api('GET', `/api/page/${encodePage(path)}`)
  if (current.status >= 400) throw new Error(`read before write ${path} ${current.status}`)
  const frontmatter = { ...current.data.frontmatter, ...frontmatterPatch }
  if (dropTaskComments) delete frontmatter.taskComments
  const saved = await api('PUT', `/api/page/${encodePage(path)}`, { content, frontmatter })
  if (saved.status >= 400) throw new Error(`write ${path} ${saved.status} ${JSON.stringify(saved.data)}`)
  return saved.data
}

async function readPage(path) {
  const response = await api('GET', `/api/page/${encodePage(path)}`)
  if (response.status >= 400) throw new Error(`GET ${path} ${response.status} ${JSON.stringify(response.data)}`)
  return response.data
}

async function until(label, fn, timeout = 12000) {
  const start = Date.now()
  let last = 'not ready'
  while (Date.now() - start < timeout) {
    try {
      const value = await fn()
      if (value) return value
      last = 'condition was false'
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label}: ${last}`)
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true })
  } catch {
    console.log('Bundled Chromium is unavailable; using system Chrome.')
    return await chromium.launch({ channel: 'chrome', headless: true })
  }
}

async function signIn(page) {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('Username').fill('dev')
  await page.getByPlaceholder('Password').fill('dev')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('/login'))
}

function openPage(page, path) {
  return page.goto(`${origin}/page/${encodePage(path)}`, { waitUntil: 'domcontentloaded' })
}

async function appendToText(page, locator, suffix) {
  await locator.click({ clickCount: 3 })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(suffix)
}

async function placeCaretAfter(page, root, needle) {
  const placed = await root.evaluate((editor, marker) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const text = node.textContent ?? ''
      const index = text.indexOf(marker)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index + marker.length)
        range.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return true
      }
      node = walker.nextNode()
    }
    return false
  }, needle)
  assert(placed, `could not place the caret after ${needle}`)
}

async function preparePages() {
  const login = await api('POST', '/api/auth/login', { username: 'dev', password: 'dev' })
  if (!login.data?.token) throw new Error(`login failed ${login.status} ${JSON.stringify(login.data)}`)
  token = login.data.token

  await api('DELETE', `/api/page/${encodePage('Workspace/Mermaid Edges')}`)

  const acceptance = await ensurePage('Mermaid Acceptance')
  const roundtrip = await ensurePage('Mermaid Roundtrip')
  const quote = await ensurePage('Mermaid Quote')
  const slash = await ensurePage('Mermaid Slash')
  const unsafe = await ensurePage('Mermaid Unsafe')
  const plain = await ensurePage('Mermaid Plain')
  const board = await ensurePage('Mermaid Comment Board', true)

  await writePage(acceptance, fixture, { title: 'Mermaid Acceptance' })
  await writePage(roundtrip, roundtripBody, { title: 'Mermaid Roundtrip' })
  await writePage(quote, quoteBody, { title: 'Mermaid Quote' })
  await writePage(slash, 'Start here.\n', { title: 'Mermaid Slash' })
  await writePage(unsafe, unsafeBody, { title: 'Mermaid Unsafe' })
  await writePage(plain, plainBody, { title: 'Mermaid Plain' })
  await writePage(board, boardContent, { title: 'Mermaid Comment Board', kanban: true }, { dropTaskComments: true })

  const section = await api('PUT', `/api/sections/${encodePage(roundtrip)}`, {
    sectionPath: '_sections/diagram-section.md',
    title: 'Diagram section',
    content: sectionBody,
  })
  if (section.status >= 400) throw new Error(`section write failed ${section.status} ${JSON.stringify(section.data)}`)

  const boardPage = await readPage(board)
  const column = boardPage.board?.columns?.[0]
  const card = column?.cards?.[0]
  assert(card?.description?.includes('D --> E'), `card description was not kept:\n${card?.description}`)
  const comment = await api('POST', `/api/kanban-comments/${encodePage(board)}`, {
    columnId: column.id,
    index: 0,
    body: '```mermaid\nflowchart LR\n  A --> B\n```',
  })
  if (comment.status >= 400) throw new Error(`comment write failed ${comment.status} ${JSON.stringify(comment.data)}`)

  return { acceptance, roundtrip, quote, slash, unsafe, plain, board }
}

async function run() {
  const pages = await preparePages()
  await mkdir(outDir, { recursive: true })
  const browser = await launchBrowser()
  let activePage = null

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addInitScript(() => {
      window.__alerted = false
      window.alert = () => { window.__alerted = true }
    })
    const page = await context.newPage()
    activePage = page
    page.setDefaultTimeout(15000)
    const requests = []
    const dialogs = []
    const pageErrors = []
    page.on('request', (request) => requests.push(request.url()))
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss() })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await signIn(page)
    await openPage(page, pages.acceptance)
    const preview = page.locator('article.markdown-preview').first()
    await preview.locator('.mermaid-diagram svg').first().waitFor()
    const diagrams = preview.locator('.mermaid-diagram')
    assert(await diagrams.count() === 4, `expected 4 mermaid blocks, got ${await diagrams.count()}`)
    assert(await preview.locator('.mermaid-diagram svg').count() === 3, `expected 3 rendered diagrams, got ${await preview.locator('.mermaid-diagram svg').count()}`)

    const flowchart = (await diagrams.nth(0).innerText()).replace(/\s+/g, '')
    assert(flowchart.includes('Кириллица:привет'), `flowchart lost Cyrillic:\n${flowchart}`)
    assert(flowchart.includes('[[Workspace|Вики]]'), `flowchart lost wiki-like text:\n${flowchart}`)
    assert(flowchart.includes(':idea:'), `flowchart rewrote a shortcode:\n${flowchart}`)
    assert(flowchart.includes('![shot](https://example.com/diagram.png)'), `flowchart lost image-like text:\n${flowchart}`)
    assert(await diagrams.nth(0).locator('foreignObject, script').count() === 0, 'flowchart svg contains a forbidden node')

    const sequence = (await diagrams.nth(1).innerText()).replace(/\s+/g, '')
    assert(sequence.includes('Привет,мир') && sequence.includes('Ответ100%'), `sequence text missing:\n${sequence}`)
    const sequenceHtml = await diagrams.nth(1).locator('svg').innerHTML()
    assert(sequenceHtml.includes('url(#'), 'sequence arrows lost local url(#…) references')
    assert(!/foreignObject|<script|javascript:/i.test(sequenceHtml), 'sequence svg is not safe')

    const broken = await diagrams.nth(3).innerText()
    assert(broken.includes('This diagram could not be rendered.'), broken)
    assert(broken.includes('A -->'), 'broken diagram hid its source')
    assert(await preview.locator('pre code', { hasText: 'print("not a diagram")' }).count() === 1, 'ordinary code block was replaced')
    assert(await preview.getByRole('link', { name: 'Workspace' }).count() >= 1, 'wiki link outside code was lost')
    assert((await preview.innerText()).includes('💡'), 'shortcode outside code was not rendered')
    assert(await preview.locator('img[src*="example.com/outside.png"]').count() >= 1, 'image outside code was lost')
    assert(!requests.some((url) => bannedRequest.test(url)), `unwanted request:\n${requests.filter((url) => bannedRequest.test(url)).join('\n')}`)
    console.log('PASS preview, Cyrillic, safety of a normal diagram, ordinary markdown')

    await diagrams.nth(0).screenshot({ path: resolve(outDir, 'flowchart-dark.png') })
    await diagrams.nth(1).screenshot({ path: resolve(outDir, 'sequence-dark.png') })
    const darkSequence = sequenceHtml
    await page.getByRole('button', { name: 'D', exact: true }).click()
    await page.getByRole('button', { name: 'Light mode' }).click()
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
    await page.waitForFunction((previous) => {
      const svg = document.querySelectorAll('article.markdown-preview .mermaid-diagram svg')[1]
      return Boolean(svg) && svg.innerHTML !== previous
    }, darkSequence)
    await diagrams.nth(0).screenshot({ path: resolve(outDir, 'flowchart-light.png') })
    await diagrams.nth(1).screenshot({ path: resolve(outDir, 'sequence-light.png') })
    console.log('PASS theme toggle redraws diagrams')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await preview.locator('.mermaid-diagram svg').nth(2).waitFor()
    const layout = await page.evaluate(() => {
      const scroller = document.querySelector('main .workspace-scroll')
      const wide = document.querySelectorAll('main .mermaid-diagram')[2]
      return {
        scrollerDelta: scroller.scrollWidth - scroller.clientWidth,
        wideDelta: wide.scrollWidth - wide.clientWidth,
        docDelta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    assert(layout.wideDelta > 8, `wide diagram did not scroll inside its frame: ${JSON.stringify(layout)}`)
    assert(layout.scrollerDelta < 24, `page column grew with the diagram: ${JSON.stringify(layout)}`)
    assert(layout.docDelta < 24, `document grew with the diagram: ${JSON.stringify(layout)}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    console.log('PASS wide diagram scrolls inside a phone-width column')

    await openPage(page, pages.roundtrip)
    const section = page.locator('article', { has: page.getByRole('heading', { name: 'Diagram section' }) })
    await section.scrollIntoViewIfNeeded()
    await section.locator('.mermaid-diagram svg').waitFor()
    const sectionText = (await section.locator('.mermaid-diagram').innerText()).replace(/\s+/g, '')
    assert(sectionText.includes('Раздел') && sectionText.includes('[[Workspace/Projects]]'), sectionText)
    await section.getByRole('button', { name: 'Edit' }).click()
    const sectionEditor = page.locator('[data-wikindie-editor]')
    await appendToText(page, sectionEditor.getByText('Section neighbor.'), ' saved')
    await sectionEditor.getByText('Section neighbor. saved').waitFor()
    await page.getByRole('button', { name: 'Save' }).click()
    await section.locator('.mermaid-diagram svg').waitFor()
    const savedSection = await until('section save', async () => {
      const data = await readPage(pages.roundtrip)
      const found = data.sections.find((item) => item.title === 'Diagram section')
      if (!found?.content.includes('Section neighbor. saved')) return null
      const fences = mermaidFences(found.content)
      assert(fences.some((fence) => fence.includes('[[Workspace/Projects]]') && fence.includes('![section](https://example.com/section.png)')), found.content)
      assert(!found.content.includes('#w='), `image width leaked into the section:\n${found.content}`)
      return found
    })
    assert(savedSection, 'section save')
    console.log('PASS section Save keeps the mermaid fence')

    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    const editor = page.locator('[data-wikindie-editor]').first()
    await appendToText(page, editor.getByText('Neighbor paragraph before the diagram.'), ' checked')
    await editor.getByText('Neighbor paragraph before the diagram. checked').waitFor()
    await until('page autosave', async () => {
      const data = await readPage(pages.roundtrip)
      if (!data.content.includes('Neighbor paragraph before the diagram. checked')) return null
      const fences = mermaidFences(data.content)
      assert(fences.length >= 2, data.content)
      assert(fences.some((fence) => fence.includes('Кириллица: привет') && fence.includes('[[Workspace|Вики]]') && fence.includes(':idea:')), data.content)
      assert(fences.some((fence) => fence.includes('sequenceDiagram') && fence.includes('Привет, мир')), data.content)
      return true
    })
    console.log('PASS page autosave keeps top-level mermaid fences')

    await editor.getByText(':idea:').first().click()
    await placeCaretAfter(page, editor, ':idea:')
    await page.keyboard.type('2')
    const edited = await until('code edit autosave', async () => {
      const data = await readPage(pages.roundtrip)
      const fences = mermaidFences(data.content)
      const flowchart = fences.find((fence) => fence.includes('flowchart TD'))
      if (!flowchart?.includes('2')) return null
      assert(flowchart.includes('Кириллица: привет') && flowchart.includes('[[Workspace|Вики]]') && flowchart.includes(':idea:2'), data.content)
      return data.content
    })
    assert(edited.includes('```mermaid'), edited)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('article.markdown-preview').first().locator('.mermaid-diagram svg').nth(1).waitFor()
    console.log('PASS editing the diagram source keeps the mermaid fence and reloads')

    await openPage(page, pages.quote)
    await page.locator('.mermaid-diagram svg').first().waitFor()
    const quoted = await page.locator('.mermaid-diagram').first().innerText()
    assert(quoted.includes('[[Workspace]]'), `quoted fence did not render:\n${quoted}`)
    assert(quoted.includes(':idea:'), `quoted fence rewrote a shortcode:\n${quoted}`)
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await appendToText(page, page.locator('[data-wikindie-editor]').getByText('Before the fences.'), ' x')
    await page.locator('[data-wikindie-editor]').getByText('Before the fences. x').waitFor()
    const quoteSaved = await until('quote autosave', async () => {
      const data = await readPage(pages.quote)
      if (!data.content.includes('Before the fences. x')) return null
      return data.content
    })
    assert(!quoteSaved.includes('Q[[Workspace|'), `wiki rewrite corrupted the quoted fence:\n${quoteSaved}`)
    assert(/Q\["\[\[Workspace\]\]"\]/.test(quoteSaved), `quoted fence turned wiki text into a link:\n${quoteSaved}`)
    assert(quoteSaved.includes('[Workspace](../Workspace)'), `outside wiki link was not saved as a relative link:\n${quoteSaved}`)
    assert(!quoteSaved.includes('#wikindie-ref'), `saved quote page kept a wiki hash:\n${quoteSaved}`)
    console.log('PASS quoted fence stays literal, and the outside wiki link is relative')
    console.log(`QUOTE SAVED:\n${quoteSaved}`)

    await openPage(page, pages.slash)
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    const slashEditor = page.locator('[data-wikindie-editor]')
    await slashEditor.getByText('Start here.').click()
    await page.keyboard.press('Enter')
    await page.keyboard.type('/mermaid', { delay: 40 })
    await page.getByText('Mermaid diagram', { exact: true }).click()
    await slashEditor.getByText('A --> B').waitFor()
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.locator('.mermaid-diagram svg').first().waitFor()
    const slashSaved = await until('slash insert save', async () => {
      const data = await readPage(pages.slash)
      const fences = mermaidFences(data.content)
      if (!fences.some((fence) => fence.includes('flowchart TD') && fence.includes('A --> B'))) return null
      return data.content
    })
    assert(slashSaved.includes('```mermaid'), slashSaved)
    console.log('PASS slash menu inserts a mermaid code block')

    const unsafeStart = requests.length
    await openPage(page, pages.unsafe)
    await page.getByText('Unsafe sample.').waitFor()
    await page.locator('.mermaid-diagram').first().waitFor()
    await page.waitForTimeout(1000)
    const duringUnsafe = requests.slice(unsafeStart)
    assert(!duringUnsafe.some((url) => bannedRequest.test(url)), `unsafe render requested:\n${duringUnsafe.filter((url) => bannedRequest.test(url)).join('\n')}`)
    assert(await page.locator('.mermaid-diagram foreignObject, .mermaid-diagram script').count() === 0, 'unsafe svg node remained')
    const unsafeHtml = await page.locator('.mermaid-diagram').first().innerHTML()
    assert(!/javascript:|onerror|foreignobject|<script/i.test(unsafeHtml), unsafeHtml.slice(0, 500))
    assert(dialogs.length === 0, `dialog opened: ${dialogs.join(', ')}`)
    assert(await page.evaluate(() => window.__alerted === false), 'alert ran')
    console.log('PASS unsafe diagram does not execute or fetch remote resources')

    await openPage(page, pages.board)
    await page.locator('article', { hasText: 'Render comment' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('.mermaid-diagram svg').waitFor()
    assert(await dialog.locator('.mermaid-diagram svg').count() === 1, 'comment preview did not render exactly one diagram')
    assert(await dialog.locator('[data-wikindie-editor] .mermaid-diagram').count() === 0, 'card description rendered a diagram')
    await dialog.locator('[data-wikindie-editor]').getByText('D --> E').waitFor()
    console.log('PASS kanban comment preview renders; card description stays a code block')

    assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
    await context.close()

    const plainContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const plainPage = await plainContext.newPage()
    activePage = plainPage
    plainPage.setDefaultTimeout(15000)
    const plainRequests = []
    const leaveErrors = []
    plainPage.on('request', (request) => plainRequests.push(request.url()))
    plainPage.on('pageerror', (error) => leaveErrors.push(error.message))
    await signIn(plainPage)
    await openPage(plainPage, pages.plain)
    await plainPage.getByText('Just a paragraph').waitFor()
    await plainPage.locator('pre code', { hasText: 'console.log(1)' }).waitFor()
    await plainPage.waitForTimeout(800)
    assert(!plainRequests.some((url) => mermaidLibrary.test(url)), `plain page loaded Mermaid:\n${plainRequests.filter((url) => mermaidLibrary.test(url)).join('\n')}`)
    console.log('PASS a page without mermaid does not load the library')

    let releaseLibrary = () => {}
    const libraryGate = new Promise((resolve) => { releaseLibrary = resolve })
    await plainPage.route(mermaidLibrary, async (route) => {
      await libraryGate
      await route.continue()
    })
    await openPage(plainPage, pages.acceptance)
    await plainPage.getByRole('link', { name: 'Workspace', exact: true }).first().click()
    await plainPage.waitForURL((url) => url.pathname === '/page/Workspace')
    releaseLibrary()
    await plainPage.waitForTimeout(800)
    assert(leaveErrors.length === 0, `leaving during render raised:\n${leaveErrors.join('\n')}`)
    console.log('PASS leaving the page during render does not throw')
    await plainContext.close()

    const abortContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const abortPage = await abortContext.newPage()
    activePage = abortPage
    abortPage.setDefaultTimeout(15000)
    await abortPage.route(mermaidLibrary, (route) => route.abort())
    await signIn(abortPage)
    await openPage(abortPage, pages.acceptance)
    await abortPage.getByText('The diagram library failed to load.').first().waitFor()
    await abortPage.getByText('Neighbor paragraph before the diagrams.').waitFor()
    assert(await abortPage.locator('.mermaid-diagram svg').count() === 0, 'aborted library still produced an svg')
    const failure = await abortPage.locator('.mermaid-diagram').first().innerText()
    assert(failure.includes('flowchart TD'), 'load failure hid the source')
    console.log('PASS a failed library load shows the message and the source')
    await abortContext.close()
  } catch (error) {
    if (activePage) await activePage.screenshot({ path: resolve(outDir, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }

  console.log(`Screenshots: ${outDir}`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
