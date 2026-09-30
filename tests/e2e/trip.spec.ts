import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  // Deterministic map rendering: external tile availability is verified separately.
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#17211f' } },
        ],
      }),
    }),
  )
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15_000 })
})
test('theme can switch between dark and light and keeps the preference', async ({ page }) => {
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '切換為淺色主題' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('tokyo-trip-theme')))
    .toBe('light')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(root).toHaveAttribute('data-theme', 'light')
  await page.screenshot({
    path: `test-results/${test.info().project.name}-light-theme.png`,
    fullPage: true,
  })
  await page.getByRole('button', { name: '切換為深色主題' }).click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
})
async function openPanel(page: any) {
  if (await page.locator('.mobile-panel-toggle').isVisible()) {
    if ((await page.locator('.mobile-panel-toggle').getAttribute('aria-expanded')) === 'false')
      await page.locator('.mobile-panel-toggle').click()
  }
}
async function openMapTools(page: any) {
  const button = page.getByRole('button', { name: '地圖工具', exact: true })
  if (await button.isVisible()) {
    if ((await button.getAttribute('aria-expanded')) === 'false') await button.click()
  }
}
test('five days, daily page reload, invalid route and responsive layout', async ({ page }) => {
  await openPanel(page)
  await expect(page.locator('.day-card')).toHaveCount(5)
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 3 / })
    .click()
  await expect(page.locator('.panel-heading h2')).toHaveText('沿著海岸去旅行')
  await page.getByRole('link', { name: '開啟每日行程' }).click()
  await expect(page).toHaveURL(/#\/day\/3/)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openPanel(page)
  await expect(page.locator('.day-title')).toHaveText('沿著海岸去旅行')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.goto('/#/day/99', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/$/)
})
test('timeline, repeated place selection, missing coordinates, map markers and layers', async ({
  page,
}) => {
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 3 / })
    .click()
  await openPanel(page)
  await page.locator('#stop-d3-17 button').click()
  await expect(page.locator('#stop-d3-17 button')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: '上野站', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  await page.locator('#stop-d3-8 button').click()
  await expect(page.locator('.pending-location')).toBeVisible()
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  if (await page.locator('.mobile-panel-toggle').isVisible())
    await page.locator('.mobile-panel-toggle').click()
  await openMapTools(page)
  await page.getByRole('button', { name: '縮放至目前行程' }).click()
  await page.getByRole('button', { name: '查看大船站', exact: true }).click()
  await expect(page.getByRole('heading', { name: '大船站', exact: true })).toBeVisible()
  await expect(page.locator('#stop-d3-2 button')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  if (await page.locator('.mobile-panel-toggle').isVisible())
    await page.locator('.mobile-panel-toggle').click()
  await openMapTools(page)
  await page.getByRole('button', { name: '圖層設定', exact: true }).click()
  await page.getByLabel('候選地點', { exact: true }).uncheck()
  await expect(page.locator('.map-marker:not(.dimmed)')).toHaveCount(0)
  await expect(page.getByText('此篩選下沒有可定位的地點。')).toBeVisible()
  await page.getByLabel('候選地點', { exact: true }).check()
  await expect(page.locator('.map-marker')).not.toHaveCount(0)
})
test('mode switching retains selection and route overlays', async ({ page }) => {
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 2 / })
    .click()
  await openPanel(page)
  await page.locator('#stop-d2-2 button').click()
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  if (await page.locator('.mobile-panel-toggle').isVisible())
    await page.locator('.mobile-panel-toggle').click()
  await openMapTools(page)
  const subwayToggle = page.locator('.transit-toggle')
  await expect(subwayToggle).toHaveAttribute('aria-pressed', 'true')
  await subwayToggle.click()
  await expect(subwayToggle).toHaveAttribute('aria-pressed', 'false')
  await subwayToggle.click()
  await expect(subwayToggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '道路地圖', exact: true }).click()
  await openMapTools(page)
  await expect(page.getByRole('button', { name: '道路地圖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '簡化地圖', exact: true }).click()
  await expect(
    page.getByRole('navigation', { name: '選擇旅程日期' }).getByRole('button', { name: /^Day 2 / }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="map-canvas"]')).toHaveAttribute('data-ready', 'true')
  await page.screenshot({
    path: `test-results/${test.info().project.name}-map.png`,
    fullPage: true,
  })
})
test('transit diagram shows trip rail lines and opens station details', async ({ page }) => {
  await page.getByRole('button', { name: '交通圖', exact: true }).click()
  await expect(page.getByRole('button', { name: '交通圖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.transit-diagram')).toBeVisible()
  await expect(page.locator('.transit-line')).toHaveCount(8)
  await expect(page.locator('.transit-station-group[data-secondary="true"]:visible')).toHaveCount(0)
  const initialWidth = (await page.locator('.transit-diagram-map').boundingBox())!.width
  await page.getByRole('button', { name: '放大交通圖' }).click()
  await expect(page.locator('.transit-zoom-controls')).toContainText('125%')
  await expect(
    page.locator('.transit-station-group[data-secondary="true"]:visible'),
  ).not.toHaveCount(0)
  const zoomedWidth = (await page.locator('.transit-diagram-map').boundingBox())!.width
  expect(zoomedWidth).toBeGreaterThan(initialWidth)
  await page.getByRole('button', { name: '重設交通圖縮放' }).click()
  await expect(page.locator('.transit-zoom-controls')).toContainText('100%')
  await page.screenshot({
    path: `test-results/${test.info().project.name}-transit-layout.png`,
    fullPage: true,
  })
  await page.getByRole('button', { name: '查看上野交通資訊' }).click()
  await expect(page.getByRole('heading', { name: '上野', exact: true })).toBeVisible()
  await expect(page.getByText(/最重要的交通樞紐/)).toBeVisible()
  await page.screenshot({
    path: `test-results/${test.info().project.name}-transit-diagram.png`,
    fullPage: true,
  })
  await page.getByRole('button', { name: '查看地點、備註與導航' }).click()
  await expect(page.getByRole('heading', { name: '上野站', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '關閉地點資訊' }).click()
  await page.getByRole('button', { name: '地圖', exact: true }).click()
  await expect(page.locator('[data-testid="map-canvas"]')).toBeVisible()
  await openMapTools(page)
  await expect(page.getByRole('button', { name: '簡化地圖', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
test('transit diagram emphasizes the selected day routes', async ({ page }) => {
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 3 / })
    .click()
  await page.getByRole('button', { name: '交通圖', exact: true }).click()
  await expect(page.locator('.transit-line:not(.dimmed)')).toHaveCount(4)
  await expect(page.locator('.transit-line.dimmed')).toHaveCount(4)
  await expect(page.locator('.transit-walk-links g:not(.dimmed)')).toHaveCount(1)
})
test('tile failure keeps itinerary usable and can retry', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.abort())
  await openMapTools(page)
  await page.getByRole('button', { name: '道路地圖', exact: true }).click()
  await expect(page.getByRole('button', { name: '重試底圖' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '選擇旅程日期' })
    .getByRole('button', { name: /^Day 1 / })
    .click()
  await openPanel(page)
  await expect(page.locator('.stop-card').first()).toBeVisible()
})

test('full map panel and previous/next day navigation', async ({ page }) => {
  await page.getByRole('link', { name: '探索地圖', exact: true }).click()
  await expect(page).toHaveURL(/#\/map/)
  if (await page.locator('.mobile-panel-toggle').isVisible()) {
    await openPanel(page)
  } else {
    await expect(page.locator('.itinerary-panel')).toBeHidden()
    await page.getByRole('button', { name: '顯示行程' }).click()
  }
  await expect(page.locator('.itinerary-panel')).toBeVisible()
  await page.goto('/#/day/2', { waitUntil: 'domcontentloaded' })
  await openPanel(page)
  await page.getByRole('link', { name: '下一天' }).click()
  await expect(page.locator('.day-title')).toHaveText('沿著海岸去旅行')
  await page.getByRole('link', { name: '上一天' }).click()
  await expect(page.locator('.day-title')).toHaveText('森林走向城市')
})
