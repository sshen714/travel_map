import { test, expect } from '@playwright/test'
test('live basemap loads, modes work and screenshots are reviewable', async ({ page }, info) => {
  test.setTimeout(60000)
  test.skip(!process.env.LIVE_MAP, 'Opt-in check requires internet access to OpenFreeMap')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.getByRole('link', { name: 'OpenFreeMap', exact: true })).toBeAttached({
    timeout: 20000,
  })
  await expect(page.getByText('正在載入地圖…')).toHaveCount(0, { timeout: 20000 })
  await expect(page.locator('.map-message.error')).toHaveCount(0)
  await expect
    .poll(async () =>
      page.locator('.maplibregl-canvas').evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBeGreaterThan(250)
  await page.screenshot({
    path: `test-results/${info.project.name}-live-overview.png`,
    fullPage: true,
  })
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 1 / })
    .click()
  if (await page.locator('.mobile-panel-toggle').isVisible())
    await page.locator('.mobile-panel-toggle').click()
  await page.locator('#stop-d1-7 button').click()
  await expect(page.getByRole('heading', { name: '雷門', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  if (await page.locator('.mobile-panel-toggle').isVisible())
    await page.locator('.mobile-panel-toggle').click()
  await page.screenshot({ path: `test-results/${info.project.name}-live-day.png`, fullPage: true })
  await page.getByRole('button', { name: '道路地圖', exact: true }).click()
  await expect(page.getByText('正在載入地圖…')).toHaveCount(0, { timeout: 20000 })
  await expect(page.locator('.map-message.error')).toHaveCount(0)
  await page.screenshot({
    path: `test-results/${info.project.name}-live-street.png`,
    fullPage: true,
  })
  expect(errors).toEqual([])
})
