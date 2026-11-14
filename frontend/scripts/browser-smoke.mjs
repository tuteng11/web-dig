#!/usr/bin/env node
/**
 * Browser smoke test for the contract UI.
 *
 * Start the production preview first:
 *   npm run build
 *   npm run preview -- --host 127.0.0.1 --port 4173
 * Then:
 *   npm run smoke:browser
 *
 * Uses the installed Microsoft Edge (or Chrome) through playwright-core; no
 * browser download is performed. Set BROWSER_EXECUTABLE to override the path.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const CANDIDATES = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter((value) => typeof value === 'string' && value.length > 0)

const executablePath = CANDIDATES.find((candidate) => existsSync(candidate))
if (!executablePath) {
  console.error(
    'No Edge/Chrome executable found. Set BROWSER_EXECUTABLE to a Chromium browser path.',
  )
  process.exit(1)
}

const browser = await chromium.launch({ executablePath, headless: true })
const errors = []

async function main() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  console.log('open start screen')
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page
    .getByRole('button', { name: 'Load synthetic Riverbend demo' })
    .waitFor()

  console.log('load synthetic demo')
  await page
    .getByRole('button', { name: 'Load synthetic Riverbend demo' })
    .click()
  await page
    .getByRole('heading', { name: 'Chronological tree' })
    .waitFor({ timeout: 15_000 })
  await page.getByText('Loaded research sources').waitFor()
  const sourceCount = await page.locator('.source-item').count()
  if (sourceCount !== 16) {
    throw new Error(`expected 16 fixture sources, got ${sourceCount}`)
  }

  console.log('select exactly two nodes')
  await page
    .locator(
      'button[aria-label="Select Neighbors organize over proposed Riverbend battery yard for question"]',
    )
    .first()
    .click()
  await page
    .locator(
      'button[aria-label="Select Riverbend battery storage project clears council vote for question"]',
    )
    .first()
    .click()

  console.log('ask a pinned two-node question')
  await page
    .locator('.question-panel textarea')
    .fill('Which source was published first, and does the later report credit it?')
  await page.getByRole('button', { name: 'Ask question' }).click()
  await page.getByText('Answered', { exact: true }).waitFor({ timeout: 15_000 })

  console.log('open the citation drawer')
  await page.locator('button[aria-label^="Open citation 1:"]').first().click()
  await page.getByRole('heading', { name: 'Answer citations' }).waitFor()
  const citations = await page.locator('dialog .citation-list > li').count()
  if (citations !== 3) {
    throw new Error(`expected 3 fixture citations, got ${citations}`)
  }
  await page.getByRole('button', { name: 'Close citation drawer' }).click()

  console.log('add an additional discovery explicitly')
  await page
    .locator('input[aria-label^="Select additional discovery:"]')
    .first()
    .check()
  await page.getByRole('button', { name: 'Add to tree' }).click()
  await page.getByText(/Origin changed/i).first().waitFor({ timeout: 15_000 })
  await page
    .getByText('Planning board agenda lists battery storage hearing')
    .first()
    .waitFor({ timeout: 15_000 })
  const revision = await page.locator('.tb-header-revision').first().innerText()
  if (revision.trim() !== '2') {
    throw new Error(`expected revision 2 after adding, got ${revision}`)
  }

  console.log('resume route state after reload')
  await page.reload({ waitUntil: 'networkidle' })
  await page
    .getByRole('heading', { name: 'Chronological tree' })
    .waitFor({ timeout: 15_000 })
  const reloadedRevision = await page
    .locator('.tb-header-revision')
    .first()
    .innerText()
  if (reloadedRevision.trim() !== '2') {
    throw new Error(
      `expected revision 2 after reload, got ${reloadedRevision}`,
    )
  }
  await page
    .getByText('Planning board agenda lists battery storage hearing')
    .first()
    .waitFor()
  if (!/slot a/i.test(await page.locator('.selection-tray').innerText())) {
    throw new Error('selection tray did not restore')
  }

  const url = page.url()
  if (!url.includes('demo=1')) throw new Error('demo state missing from URL')
  if (url.includes('Which%20source') || url.includes('Which source')) {
    throw new Error('question text leaked into the URL')
  }
  if (url.includes('riverbendneighbors')) {
    throw new Error('source URL leaked into the URL')
  }

  console.log('verify the narrow-screen tabs')
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  mobile.on('pageerror', (error) =>
    errors.push(`mobile pageerror: ${error.message}`),
  )
  await mobile.goto(BASE_URL, { waitUntil: 'networkidle' })
  await mobile
    .getByRole('button', { name: 'Load synthetic Riverbend demo' })
    .click()
  await mobile
    .getByRole('heading', { name: 'Chronological tree' })
    .waitFor({ timeout: 15_000 })
  const tabs = await mobile.getByRole('tab').allInnerTexts()
  if (tabs.join(',') !== 'Tree,Sources,Ask') {
    throw new Error(`unexpected mobile tabs: ${tabs.join(',')}`)
  }
  await mobile.getByRole('tab', { name: 'Sources' }).click()
  await mobile.getByText('Loaded research sources').waitFor()
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  if (overflow > 1) throw new Error(`horizontal overflow: ${overflow}px`)
  await mobile.close()

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
  console.log('SMOKE PASS')
}

try {
  await main()
} catch (error) {
  console.error(`SMOKE FAIL: ${error instanceof Error ? error.message : error}`)
  if (errors.length > 0) console.error(errors.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
