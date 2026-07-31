/**
 * End-to-end smoke test: launches the packaged-style build in a throwaway
 * userData directory and walks the core flow — open, edit, @ mention, navigate.
 *
 * Run with: npm run smoke
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron } from 'playwright'

const userDataDir = mkdtempSync(join(tmpdir(), 'atlas-smoke-'))
mkdirSync('docs', { recursive: true })
const steps = []
let app = null

function step(name) {
  steps.push(name)
  console.log(`  ✓ ${name}`)
}

async function main() {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })

  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('  [renderer error]', message.text())
  })
  page.on('pageerror', (error) => console.error('  [page error]', error.message))

  await page.waitForSelector('.document__title', { timeout: 15_000 })
  step('window opens and seeds documents')

  const title = await page.inputValue('.document__title')
  if (title !== 'Welcome to Atlas') throw new Error(`unexpected first document: ${title}`)
  step(`first document is "${title}"`)

  // Clicking an existing reference navigates to the target document.
  await page.click('.mention--resolved >> nth=0')
  await page.waitForFunction(
    () => document.querySelector('.document__title')?.value === 'System Architecture',
    null,
    { timeout: 5000 }
  )
  step('clicking a reference navigates to the target document')

  await page.click('.button--icon >> nth=0')
  await page.waitForFunction(
    () => document.querySelector('.document__title')?.value === 'Welcome to Atlas',
    null,
    { timeout: 5000 }
  )
  step('back button returns to the previous document')

  // Type an @ mention at the end of the document and insert the top result.
  await page.locator('.editor__surface > *').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Linked to @road')
  await page.waitForSelector('.mention-popup', { timeout: 5000 })

  const firstOption = await page.textContent('.mention-option__title >> nth=0')
  if (!firstOption?.includes('Q3 Roadmap')) {
    throw new Error(`unexpected top suggestion: ${firstOption}`)
  }
  step(`@ menu searches documents (top hit: "${firstOption.trim()}")`)

  await page.screenshot({ path: 'docs/screenshot-mention-menu.png' })

  // The top hit must be highlighted even though the pointer sits over the popup.
  const highlighted = await page.textContent('.mention-option[data-active="true"] >> nth=0')
  if (!highlighted?.includes('Q3 Roadmap')) {
    throw new Error(`keyboard highlight was hijacked: ${highlighted}`)
  }

  await page.keyboard.press('Enter')

  // Assert on the paragraph we typed into, so a pre-existing seed reference
  // cannot make this pass, and no stray document was created.
  await page.waitForFunction(
    () => {
      const blocks = document.querySelectorAll('.editor__surface > p')
      const last = blocks[blocks.length - 1]
      return last?.querySelector('.mention')?.textContent?.includes('Q3 Roadmap') ?? false
    },
    null,
    { timeout: 5000 }
  )

  const strayDocument = await page
    .locator('.doc-item__title', { hasText: /^road$/ })
    .count()
  if (strayDocument > 0) throw new Error('selecting a result created a new document')
  step('selecting a result inserts a reference to the existing document')

  // The new reference must appear in the target's backlinks after autosave.
  await page.waitForTimeout(900)
  await page.click('.mention >> text=Q3 Roadmap')
  await page.waitForFunction(
    () => document.querySelector('.document__title')?.value === 'Q3 Roadmap',
    null,
    { timeout: 5000 }
  )
  await page.waitForSelector('.backlink__title >> text=Welcome to Atlas', { timeout: 5000 })
  step('inserted reference is navigable and shows up in backlinks')

  // Renaming propagates to every reference, because links store ids.
  await page.fill('.document__title', 'Quarterly Roadmap')
  await page.waitForTimeout(900)
  await page.click('.backlink >> nth=0')
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.mention')].some((node) =>
        node.textContent?.includes('Quarterly Roadmap')
      ),
    null,
    { timeout: 5000 }
  )
  step('renaming a document updates existing references')

  await page.screenshot({ path: 'docs/screenshot-document.png' })

  // Deleting is undoable, so it happens without a confirmation prompt.
  await page.hover('.doc-item >> nth=2')
  const doomed = (await page.textContent('.doc-item >> nth=2 >> .doc-item__title'))?.trim()
  await page.click('.doc-item >> nth=2 >> .doc-item__delete')
  await page.waitForSelector(`.notice--undo-delete >> text=Deleted “${doomed}”`, { timeout: 5000 })
  await page.waitForFunction(
    (title) =>
      ![...document.querySelectorAll('.doc-item__title')].some(
        (node) => node.textContent?.trim() === title
      ),
    doomed,
    { timeout: 5000 }
  )
  step(`deleting "${doomed}" offers an undo`)

  await page.screenshot({ path: 'docs/screenshot-undo.png' })

  await page.click('.notice__action')
  await page.waitForFunction(
    (title) =>
      [...document.querySelectorAll('.doc-item__title')].some(
        (node) => node.textContent?.trim() === title
      ),
    doomed,
    { timeout: 5000 }
  )
  step('undo restores the document')

  // Stub the native save dialog so the export path can be exercised for real.
  const exportPath = join(userDataDir, 'exported.md')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)

  await page.click('.document__status .button')
  await page.waitForSelector('.notice >> text=Exported', { timeout: 5000 })

  const exported = await readFile(exportPath, 'utf8')
  if (!exported.startsWith('# Welcome to Atlas')) {
    throw new Error(`unexpected export heading: ${exported.slice(0, 40)}`)
  }
  if (!/\[.+\]\(\.\/.+\.md\)/.test(exported)) {
    throw new Error('export did not render references as Markdown links')
  }
  step('exporting writes Markdown with references as links')

  console.log(`\n${steps.length} checks passed`)
}

main()
  .catch((error) => {
    console.error('\nSmoke test failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await app?.close().catch(() => undefined)
    rmSync(userDataDir, { recursive: true, force: true })
  })
