const { test, expect } = require('@playwright/test');

test('scoreboard is the new default and page controls follow the tracker', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('td_design', 'field'));
  const event = await (await request.post('/api/events', { data: { name: 'Scoreboard Default', baseline: 50 } })).json();
  for (const suffix of ['', '/spectator']) {
    await page.goto(`/event/${event.id}${suffix}`);
    await expect(page.locator('#eventSummaryName')).toHaveText(event.name);
    await expect(page.locator('#designSelect')).toHaveValue('scoreboard');
    const tracker = await page.locator('#trackerSection').boundingBox();
    const footer = await page.locator('.page-controls').boundingBox();
    expect(footer.y).toBeGreaterThanOrEqual(tracker.y + tracker.height);
    if (suffix === '') {
      await expect(page.locator('#switchEventContainer')).toBeVisible();
      await page.getByRole('tab', { name: 'Visualization', exact: true }).click();
      const panels = await page.locator('#resultsCard .result-panel').evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().top));
      expect(panels[0]).toBe(panels[1]);
      expect(panels[1]).toBe(panels[2]);
    } else await expect(page.locator('#switchEventContainer')).toBeHidden();
  }
});

test('design previews retain inputs, remember the choice, and show selected shot geometry', async ({ page, request }) => {
  const res = await request.post('/api/events', { data: {
    name: 'Design Preview', baseline: 50, unit: 'ft',
    station_a_lat: 39.1, station_a_lng: -76.9, station_b_lat: 39.1001, station_b_lng: -76.9
  } });
  const event = await res.json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#shotEntryCard')).toBeVisible();
  await page.locator('#label').fill('Draft label');
  await page.locator('#angA').fill('60');
  await page.locator('#angB').fill('60');
  for (const design of ['field', 'scoreboard', 'bright', 'notebook', 'classic']) {
    await page.locator('#designSelect').selectOption(design);
    await expect(page.locator('html')).toHaveAttribute('data-design', design);
    await expect(page.locator('#label')).toHaveValue('Draft label');
    await expect(page.locator('#angA')).toHaveValue('60');
    await expect(page.locator('#shotEntryCard')).toBeVisible();
    await expect(page.locator('#mapWrapper')).toBeHidden();
  }
  await page.locator('#designSelect').selectOption('notebook');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(page.locator('#latestDistance')).toHaveText('50.0 ft');
  await expect(page.locator('#longestDistance')).toHaveText('50.0 ft');
  await page.locator('#label').fill('Shorter');
  await page.locator('#angA').fill('45');
  await page.locator('#angB').fill('45');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(page.locator('#latestDistance')).toHaveText('35.4 ft');
  await expect(page.locator('#longestDistance')).toHaveText('50.0 ft');
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight Draft label', exact: true }).click();
  await expect(page.locator('#highlightDescription')).toContainText('A 60° · B 60°');
  await page.locator('#showTriangle').check();
  await expect(page.locator('.measurement-triangle')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#designSelect')).toHaveValue('notebook');
});

test('all mobile prototypes prioritize shot entry and preserve spectator read-only controls', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const res = await request.post('/api/events', { data: { name: 'Mobile Designs', baseline: 50 } });
  const event = await res.json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#shotEntryCard')).toBeVisible();
  for (const design of ['field', 'scoreboard', 'bright', 'notebook']) {
    await page.locator('#designSelect').selectOption(design);
    await expect(page.locator('#shotEntryCard')).toBeVisible();
    await expect(page.locator('#setupCard')).toBeHidden();
    await expect(page.locator('#visualizerCard')).toBeHidden();
    const input = await page.locator('#angA').boundingBox();
    expect(input.height).toBeGreaterThanOrEqual(48);
    await expect(page.locator('#angA')).toHaveAttribute('inputmode', 'decimal');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.goto(`/event/${event.id}/spectator`);
  await expect(page.locator('#eventSummaryName')).toHaveText(event.name);
  for (const design of ['field', 'scoreboard', 'bright', 'notebook']) {
    await page.locator('#designSelect').selectOption(design);
    await expect(page.locator('#visualizerCard')).toBeVisible();
    await expect(page.locator('#resultsCard')).toBeVisible();
    await expect(page.locator('.editor-only:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});

test('populated designs fit desktop and small-phone screens', async ({ page, request }, testInfo) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Autumn Throwing Event', baseline: 100, unit: 'ft',
    station_a_lat: 39.1, station_a_lng: -76.9, station_b_lat: 39.1003, station_b_lng: -76.9
  } })).json();
  const base = `/api/events/${event.id}`;
  for (const [index, name] of ['Oak & Iron', 'Counterweight Crew', 'Pumpkin Express'].entries()) {
    const treb = await (await request.post(base + '/trebuchets', {
      data: { name, dist: 30 + index * 10, angle: -60 }
    })).json();
    await request.post(base + '/shots', {
      data: { label: `Round ${index + 1}`, trebId: treb.id, angA: 70 + index * 3, angB: 75 }
    });
  }
  for (const [device, size] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 320, height: 740 }]]) {
    await page.setViewportSize(size);
    for (const view of ['editor', 'spectator']) {
      await page.goto(`/event/${event.id}${view === 'spectator' ? '/spectator' : ''}`);
      await expect(page.locator('#latestDescription')).toContainText('Round 3');
      for (const design of ['field', 'scoreboard', 'bright', 'notebook']) {
        await page.locator('#designSelect').selectOption(design);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
        await page.screenshot({ path: testInfo.outputPath(`${design}-${device}-${view}.png`), fullPage: true });
      }
    }
  }
});

test('modern design comparison is visible before the event picker and remembers Clean & Bright', async ({ page }) => {
  await page.goto('/');
  const picker = page.getByRole('group', { name: 'Design preview' });
  await expect(picker).toBeInViewport();
  await expect(picker.locator('optgroup[label="Modern designs"] option')).toHaveText([
    'Modern Field Kit', 'Live Scoreboard', 'Clean & Bright'
  ]);
  await page.getByLabel('Compare designs').selectOption('bright');
  await expect(page.locator('#designDescription')).toContainText('single-column');
  await expect(page.locator('body')).toHaveCSS('font-family', /system-ui/);
  await page.reload();
  await expect(page.getByLabel('Compare designs')).toHaveValue('bright');
  await page.getByLabel('Compare designs').selectOption('classic');
  await expect(page.locator('body')).toHaveCSS('font-family', /Georgia/);
});
