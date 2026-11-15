#!/usr/bin/env node
/**
 * Browser smoke tests for the contract UI.
 *
 * Bundled mode (default, fully offline):
 *   npm run build
 *   npm run preview -- --host 127.0.0.1 --port 4173
 *   npm run smoke:browser
 *
 * Gateway mode (read-only demo; requires a running gateway behind the /api
 * preview proxy):
 *   npm run smoke:browser:gateway
 *
 * Uses the installed Microsoft Edge (or Chrome) through playwright-core; no
 * browser download is performed. Set BROWSER_EXECUTABLE to override the path.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const GATEWAY = process.argv.includes('--gateway')
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
let apiRequestCount = 0

function watchPage(
  page,
  label = '',
  { ignoreConsoleErrors = false } = {},
) {
  const prefix = label.length > 0 ? `${label} ` : ''
  page.on('pageerror', (error) =>
    errors.push(`${prefix}pageerror: ${error.message}`),
  )
  page.on('console', (message) => {
    if (!ignoreConsoleErrors && message.type() === 'error') {
      errors.push(`${prefix}console: ${message.text()}`)
    }
  })
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) apiRequestCount += 1
  })
}

function waitForGet(page, fragment) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes(fragment),
    { timeout: 15_000 },
  )
}

function assertGatewayResponse(response, label) {
  if (response.status() !== 200) {
    throw new Error(`${label} failed with HTTP ${response.status()}`)
  }
}

async function waitForDemoUrl(page, transport) {
  await page.waitForFunction(
    (expected) => {
      const params = new URLSearchParams(window.location.search)
      return (
        params.get('demo') === '1' &&
        params.get('transport') === expected
      )
    },
    transport,
    { timeout: 15_000 },
  )
}

async function waitForWorkspace(page) {
  await page
    .getByRole('heading', { name: 'Chronological tree' })
    .waitFor({ timeout: 15_000 })
  await page.getByText('Loaded research sources').waitFor()
}

async function assertSixteenSources(page) {
  const sourceCount = await page.locator('.source-item').count()
  if (sourceCount !== 16) {
    throw new Error(`expected 16 fixture sources, got ${sourceCount}`)
  }
}

async function runBundled() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  watchPage(page)

  console.log('open bundled demo directly')
  await page.goto(`${BASE_URL}/?demo=1&transport=bundled`, {
    waitUntil: 'networkidle',
  })
  await waitForWorkspace(page)
  await assertSixteenSources(page)

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

  console.log('resume bundled route state after reload')
  await page.reload({ waitUntil: 'networkidle' })
  await waitForWorkspace(page)
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
  if (!url.includes('transport=bundled')) {
    throw new Error('bundled transport missing from URL')
  }
  if (url.includes('Which%20source') || url.includes('Which source')) {
    throw new Error('question text leaked into the URL')
  }
  if (url.includes('riverbendneighbors')) {
    throw new Error('source URL leaked into the URL')
  }

  console.log('verify the narrow-screen tabs on the bundled demo')
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  watchPage(mobile, 'mobile')
  await mobile.goto(`${BASE_URL}/?demo=1&transport=bundled`, {
    waitUntil: 'networkidle',
  })
  // The mobile Tree tab is active by default, so the Sources panel heading is
  // intentionally hidden until the Sources tab is selected.
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

  if (apiRequestCount !== 0) {
    throw new Error(
      `bundled demo made ${apiRequestCount} /api/v1 request(s); expected zero`,
    )
  }
  await page.close()
}

async function runGateway() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  // Expected job stubs return HTTP 503; the browser logs those responses as
  // resource errors even though the app handles them as typed UI errors.
  watchPage(page, '', { ignoreConsoleErrors: true })

  console.log('open start screen')
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.locator('.research-home').waitFor()
  const demoButton = page.getByRole('button', {
    name: 'Load synthetic Riverbend demo',
  })
  await demoButton.waitFor()

  console.log('load the default gateway demo')
  const graphResponsePromise = waitForGet(
    page,
    '/api/v1/research/fixture-riverbend/graph',
  )
  await demoButton.click()
  assertGatewayResponse(
    await graphResponsePromise,
    'GET gateway demo graph',
  )
  await waitForWorkspace(page)
  await assertSixteenSources(page)
  await waitForDemoUrl(page, 'gateway')
  await page
    .getByText(
      /Expansion, question, and additional-discovery jobs are not implemented/i,
    )
    .first()
    .waitFor()

  console.log('inspect a node through the gateway')
  const detailsResponsePromise = waitForGet(
    page,
    '/api/v1/research/fixture-riverbend/nodes/',
  )
  await page.getByRole('button', { name: /^Inspect / }).first().click()
  assertGatewayResponse(
    await detailsResponsePromise,
    'GET gateway node details',
  )
  await page.locator('article.detail-content').first().waitFor({
    timeout: 15_000,
  })

  console.log('verify gateway mutations return typed errors')
  const expandResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/v1/research/fixture-riverbend/expand'),
    { timeout: 15_000 },
  )
  await page.getByRole('button', { name: 'Expand this node' }).click()
  const expandResponse = await expandResponsePromise
  if (expandResponse.status() !== 503) {
    throw new Error(
      `gateway expand returned HTTP ${expandResponse.status()}; expected 503`,
    )
  }
  await page
    .getByText(/Research jobs and graph mutations are not implemented/i)
    .first()
    .waitFor()

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
  const questionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/v1/research/fixture-riverbend/questions'),
    { timeout: 15_000 },
  )
  await page
    .locator('.question-panel textarea')
    .fill('Did the gateway execute a question job?')
  await page.getByRole('button', { name: 'Ask question' }).click()
  const questionResponse = await questionResponsePromise
  if (questionResponse.status() !== 503) {
    throw new Error(
      `gateway question returned HTTP ${questionResponse.status()}; expected 503`,
    )
  }
  if ((await page.getByText('Answered', { exact: true }).count()) !== 0) {
    throw new Error('gateway question displayed a fabricated answered state')
  }
  const mutationRevision = await page
    .locator('.tb-header-revision')
    .first()
    .innerText()
  if (mutationRevision.trim() !== '1') {
    throw new Error(
      `gateway mutations changed graph revision to ${mutationRevision}; expected 1`,
    )
  }

  const url = page.url()
  if (!url.includes('demo=1')) throw new Error('demo state missing from URL')
  if (!url.includes('transport=gateway')) {
    throw new Error('gateway transport missing from URL')
  }

  console.log('reload the gateway demo route')
  const reloadGraphResponsePromise = waitForGet(
    page,
    '/api/v1/research/fixture-riverbend/graph',
  )
  await page.reload({ waitUntil: 'networkidle' })
  assertGatewayResponse(
    await reloadGraphResponsePromise,
    'GET gateway demo graph after reload',
  )
  await waitForWorkspace(page)
  await assertSixteenSources(page)
  const reloadedUrl = page.url()
  if (!reloadedUrl.includes('demo=1')) {
    throw new Error('demo state missing from URL after reload')
  }
  if (!reloadedUrl.includes('transport=gateway')) {
    throw new Error('gateway transport missing from URL after reload')
  }

  console.log('verify gateway revision-2 links do not expand locally')
  const revisionPage = await browser.newPage({
    viewport: { width: 1500, height: 1100 },
  })
  watchPage(revisionPage, 'revision')
  await revisionPage.goto(
    `${BASE_URL}/?demo=1&transport=gateway&revision=2`,
    { waitUntil: 'networkidle' },
  )
  await waitForWorkspace(revisionPage)
  await revisionPage
    .getByText(/read-only gateway demo serves graph revision 1/i)
    .first()
    .waitFor()
  const gatewayRevision = await revisionPage
    .locator('.tb-header-revision')
    .first()
    .innerText()
  if (gatewayRevision.trim() !== '1') {
    throw new Error(
      `gateway revision-2 link showed revision ${gatewayRevision}; expected 1`,
    )
  }
  await revisionPage.close()

  console.log('verify non-fixture research ids ignore bundled transport')
  const nonFixturePage = await browser.newPage({
    viewport: { width: 1500, height: 1100 },
  })
  watchPage(nonFixturePage, 'non-fixture', { ignoreConsoleErrors: true })
  const nonFixtureResponsePromise = nonFixturePage.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response
        .url()
        .includes('/api/v1/research/definitely-not-fixture/graph'),
    { timeout: 15_000 },
  )
  await nonFixturePage.goto(
    `${BASE_URL}/?research=definitely-not-fixture&transport=bundled`,
    { waitUntil: 'networkidle' },
  )
  const nonFixtureResponse = await nonFixtureResponsePromise
  if (nonFixtureResponse.status() !== 404) {
    throw new Error(
      `non-fixture graph returned HTTP ${nonFixtureResponse.status()}; expected 404`,
    )
  }
  await nonFixturePage.getByTestId('graph-error').waitFor({ timeout: 15_000 })
  const nonFixtureUrl = nonFixturePage.url()
  if (!nonFixtureUrl.includes('research=definitely-not-fixture')) {
    throw new Error('non-fixture research id was not preserved in the URL')
  }
  if (!nonFixtureUrl.includes('transport=bundled')) {
    throw new Error('non-fixture URL unexpectedly lost the bundled parameter')
  }
  await nonFixturePage.close()

  console.log('verify gateway failure never substitutes bundled data')
  const failurePage = await browser.newPage({
    viewport: { width: 1500, height: 1100 },
  })
  watchPage(failurePage, 'failure', { ignoreConsoleErrors: true })
  await failurePage.route(
    '**/api/v1/research/fixture-riverbend/graph',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'MCP_UNAVAILABLE',
            message: 'The research data service is unavailable.',
            retryable: true,
          },
        }),
      }),
  )
  await failurePage.goto(`${BASE_URL}/?demo=1&transport=gateway`, {
    waitUntil: 'networkidle',
  })
  await failurePage.getByTestId('graph-error').waitFor({ timeout: 15_000 })
  await failurePage
    .getByText(/No fallback graph or fabricated source data is displayed/i)
    .waitFor()
  const fallbackSources = await failurePage.locator('.source-item').count()
  if (fallbackSources !== 0) {
    throw new Error(
      `gateway failure rendered ${fallbackSources} bundled source(s); expected zero`,
    )
  }
  await failurePage.close()
  await page.close()
}

async function main() {
  if (GATEWAY) {
    await runGateway()
  } else {
    await runBundled()
  }
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
