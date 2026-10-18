const { test, expect } = require('@playwright/test');

test('tabs isolate tasks, preserve drafts and support keyboard navigation across designs', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const event = await (await request.post('/api/events', { data: {
    name: 'Tabbed event', measurementMode: 'bearings'
  } })).json();
  await page.goto(`/event/${event.id}`);
  await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#baseline').fill('80');
  await page.locator('#referenceA').fill('90');
  await page.getByRole('link', { name: 'Log a shot', exact: true }).click();
  await expect(page.locator('#panel-shot')).toBeVisible();
  await expect(page.locator('#label')).toBeFocused();
  await page.locator('#label').fill('Unsaved throw');
  await page.locator('#bearingA').fill('30');
  for (const design of ['field', 'scoreboard', 'bright', 'notebook', 'classic']) {
    await page.locator('#designSelect').selectOption(design);
    for (const name of ['Setup', 'Log a Shot', 'Shot History', 'Visualization']) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      await expect(page.locator('.event-panel:visible')).toHaveCount(1);
      await expect(page.locator('.event-tabs [tabindex="0"]')).toHaveCount(1);
    }
  }
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await expect(page.locator('#baseline')).toHaveValue('80');
  await expect(page.locator('#referenceA')).toHaveValue('90');
  await page.getByRole('tab', { name: 'Setup', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Log a Shot', exact: true })).toBeFocused();
  await expect(page.locator('#label')).toHaveValue('Unsaved throw');
  await expect(page.locator('#bearingA')).toHaveValue('30');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Visualization', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Visualization', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('hidden tasks keep receiving live data and history opens the selected shot on a correctly sized map', async ({ page, request }, testInfo) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Live tabs', measurementMode: 'gps', unit: 'm'
  } })).json();
  const base = `/api/events/${event.id}`;
  const treb = await (await request.post(base + '/trebuchets', { data: {
    name: 'GPS launcher', gps: { latitude: 39, longitude: -76 }
  } })).json();
  await page.goto(`/event/${event.id}`);
  await expect(page.getByRole('tab', { name: 'Log a Shot', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#label').fill('Keep this draft');
  await request.post(base + '/shots', { data: {
    label: 'Remote shot', trebId: treb.id, landingGps: { latitude: 39.0005, longitude: -76 }
  } });
  await expect(page.locator('#shotBody')).toContainText('Remote shot', { timeout: 10000 });
  await expect(page.getByRole('tab', { name: 'Log a Shot', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#label')).toHaveValue('Keep this draft');
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight Remote shot', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Visualization', exact: true })).toBeFocused();
  await expect(page.locator('#highlightDescription')).toContainText('GPS launcher');
  await page.locator('#mapContainer').scrollIntoViewIfNeeded();
  await expect(page.locator('.event-map-impact')).toBeInViewport();
  await expect.poll(() => page.evaluate(() => leafletMap.getSize().x === $('mapContainer').clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tabbed-visualization.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Visualization', exact: true }).click();
  await page.locator('#mapContainer').scrollIntoViewIfNeeded();
  await expect(page.locator('.event-map-impact')).toBeInViewport();
  await expect.poll(() => page.evaluate(() => leafletMap.getSize().x === $('mapContainer').clientWidth)).toBe(true);
});

test('spectators and locked editors can navigate read-only tasks without entering a shot', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Read-only tabs', baseline: 50, password: 'tab-password'
  } })).json();
  for (const suffix of ['', '/spectator']) {
    await page.goto(`/event/${event.id}${suffix}`);
    await expect(page.getByRole('tab', { name: 'Visualization', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Log a Shot', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Setup', exact: true }).click();
    await expect(page.locator('#trebCard')).toBeVisible();
    await expect(page.locator('.editor-only:visible')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Setup', exact: true }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Shot History', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Show CSV', exact: false }).click();
    await expect(page.locator('#csvBox')).toBeVisible();
  }
  await page.goto(`/event/${event.id}`);
  await page.locator('#eventPassword').fill('tab-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('tab', { name: 'Log a Shot', exact: true }).click();
  const changed = await request.put(`/api/events/${event.id}/password`, { data: { password: 'changed' },
    headers: { Authorization: `Bearer ${await page.evaluate(id => localStorage.getItem(`td_edit_token:${id}`), event.id)}` } });
  expect(changed.ok()).toBe(true);
  await expect(page.getByRole('tab', { name: 'Log a Shot', exact: true })).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole('tab', { name: 'Visualization', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#unlockCard')).toBeVisible();
});

test('every task fits small phones in all designs for both event modes', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const mode of ['gps', 'bearings']) {
    const event = await (await request.post('/api/events', { data: { name: `Small ${mode}`, measurementMode: mode } })).json();
    await page.goto(`/event/${event.id}`);
    await expect(page.locator('#eventSummaryName')).toHaveText(event.name);
    for (const design of ['field', 'scoreboard', 'bright', 'notebook', 'classic']) {
      await page.locator('#designSelect').selectOption(design);
      for (const name of ['Setup', 'Log a Shot', 'Shot History', 'Visualization']) {
        await page.getByRole('tab', { name, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
        const tab = await page.getByRole('tab', { name, exact: true }).boundingBox();
        expect(tab.width).toBeGreaterThan(0);
        expect(tab.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
