const { test, expect } = require('@playwright/test');

test('spectators see live trebuchets, shots, setup, and visualizers without editing controls', async ({ page, context, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const created = await request.post('/api/events', {
    data: { name: 'Live Browser Event', baseline: 50, unit: 'ft' }
  });
  const event = await created.json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#setupCard')).toBeVisible();
  await expect(page.locator('#mapWrapper')).toBeVisible();
  await expect(page.locator('#schematicContainer')).toBeHidden();
  await expect(page.locator('#shareUrlInput')).toHaveValue(`http://127.0.0.1:3088/event/${event.id}/spectator`);

  const spectator = await context.newPage();
  spectator.on('pageerror', error => errors.push(error.message));
  await spectator.goto(`/event/${event.id}/spectator`);
  await expect(spectator.locator('#eventSummaryName')).toHaveText(event.name);
  await expect(spectator.locator('#trackerSection > :first-child')).toHaveAttribute('id', 'visualizerCard');
  await expect(spectator.locator('#mapWrapper')).toBeVisible();
  await expect(spectator.locator('#btnMapView')).toHaveClass(/active/);
  await expect(spectator.locator('.editor-only:visible')).toHaveCount(0);
  await expect(spectator.locator('#unlockCard')).toBeHidden();
  await expect(spectator.locator('#switchEventContainer')).toBeHidden();

  await page.locator('#trebName').fill('Live Trebuchet');
  await page.locator('#trebDist').fill('20');
  await page.locator('#trebAngle').fill('-45');
  await page.getByRole('button', { name: 'Add trebuchet', exact: true }).click();
  await expect(spectator.locator('#trebBody')).toContainText('Live Trebuchet', { timeout: 10000 });
  await expect(spectator.locator('#trebBody')).toContainText('20');
  await expect(spectator.locator('#trebBody')).toContainText('-45°');
  await expect(spectator.locator('#diagram')).toContainText('Live Trebuchet');
  await expect(spectator.locator('.del')).toHaveCount(0);

  await page.locator('#trebSelect').selectOption({ label: 'Live Trebuchet' });
  await page.locator('#label').fill('Live Shot');
  await page.locator('#angA').fill('90');
  await page.locator('#angB').fill('95');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(page.locator('#lastResult')).toContainText("don't form a valid triangle");
  await expect(spectator.locator('#shotBody')).toContainText('No shots logged');
  await page.locator('#angA').fill('60');
  await page.locator('#angB').fill('60');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(spectator.locator('#shotBody')).toContainText('Live Shot', { timeout: 10000 });
  await expect(spectator.locator('#shotBody')).toContainText('60°');
  await expect(spectator.locator('#diagram')).toContainText('Live Shot');
  await expect(spectator.locator('.del')).toHaveCount(0);

  await spectator.getByRole('button', { name: 'Satellite Map', exact: true }).click();
  await page.getByRole('button', { name: 'Satellite Map', exact: true }).click();
  await expect(spectator.locator('#mapNotice')).toContainText('Station GPS coordinates not configured');
  await page.locator('#baseline').fill('75');
  await page.locator('#unit').selectOption('m');
  await page.getByText('Optional: Satellite Map Overlay (GPS Coordinates)', { exact: true }).click();
  await page.locator('#stALat').fill('39.123456');
  await page.locator('#stALng').fill('-76.987654');
  await page.locator('#stBLat').fill('39.123567');
  await page.locator('#stBLng').fill('-76.987543');
  await page.getByRole('button', { name: 'Save setup', exact: true }).click();
  await expect(spectator.locator('#eventSummarySetup')).toContainText('75 m', { timeout: 10000 });
  await expect(spectator.locator('#mapNotice')).toContainText('Showing satellite overlay');
  await expect(page.locator('.event-map-marker')).toHaveCount(4);
  await expect(spectator.locator('.event-map-station')).toHaveCount(2);
  await expect(spectator.locator('.event-map-trebuchet')).toHaveCount(1);
  await expect(spectator.locator('.event-map-impact')).toHaveCount(1);
  await expect(spectator.locator('.event-map-impact [data-icon="pumpkin"]')).toHaveCount(1);
  await expect(spectator.locator('.event-map-label').filter({ hasText: 'Live Trebuchet' })).toBeVisible();
  await expect(spectator.locator('.event-map-label').filter({ hasText: 'Live Shot' })).toBeVisible();
  await expect(spectator.locator('.event-map-station').first()).toBeInViewport();
  await expect(spectator.locator('.event-map-trebuchet')).toBeInViewport();
  await expect(spectator.locator('.event-map-impact')).toBeInViewport();
  await expect(spectator.locator('.leaflet-overlay-pane svg')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await spectator.locator('.event-map-trebuchet').click();
  await expect(spectator.locator('.leaflet-popup')).toContainText('Dist from A: 20 m');
  const previousPositions = await page.evaluate(() =>
    mapLayerGroup.getLayers().filter(layer => layer instanceof L.Marker).map(layer => layer.getLatLng()));
  await page.locator('#stALat').fill('39.124456');
  await page.locator('#stBLat').fill('39.124567');
  await page.getByRole('button', { name: 'Save setup', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    mapLayerGroup.getLayers().filter(layer => layer instanceof L.Marker).map(layer => layer.getLatLng())))
    .not.toEqual(previousPositions);
  await expect(page.locator('.event-map-marker')).toHaveCount(4);
  await spectator.getByRole('button', { name: 'Schematic', exact: true }).click();
  await expect(spectator.locator('#diagram')).toBeVisible();
  await spectator.getByRole('button', { name: 'Show CSV', exact: false }).click();
  await expect(spectator.locator('#csvBox')).toHaveValue(/Live Shot/);
  await expect(spectator.locator('#csvBox')).toHaveAttribute('readonly', '');

  await page.locator('#shotBody .del').click();
  await expect(spectator.locator('#shotBody')).toContainText('No shots logged', { timeout: 10000 });
  await expect(spectator.locator('#diagram')).not.toContainText('Live Shot');
  await page.locator('#trebBody .del').click();
  await expect(spectator.locator('#trebBody')).toContainText('No trebuchets added', { timeout: 10000 });
  expect(errors).toEqual([]);
});

test('protected editor unlocks with its shared password, locks again, and can remove protection', async ({ page, request }) => {
  const created = await request.post('/api/events', {
    data: { name: 'Password Browser Event', baseline: 50, password: 'browser-password' }
  });
  const event = await created.json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#unlockCard')).toBeVisible();
  await expect(page.locator('#setupCard')).toBeHidden();
  await page.locator('#eventPassword').fill('wrong');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#globalError')).toContainText('Incorrect event password');
  await page.locator('#eventPassword').fill('browser-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#setupCard')).toBeVisible();
  await expect(page.locator('#unlockCard')).toBeHidden();

  await page.reload();
  await expect(page.locator('#setupCard')).toBeVisible();
  await expect(page.locator('#unlockCard')).toBeHidden();
  const anotherTab = await page.context().newPage();
  await anotherTab.goto(`/event/${event.id}`);
  await expect(anotherTab.locator('#setupCard')).toBeVisible();
  await anotherTab.goto(`/event/${event.id}/spectator`);
  await expect(anotherTab.locator('.editor-only:visible')).toHaveCount(0);
  await anotherTab.close();

  await page.getByText('Editing access', { exact: true }).click();
  await page.getByRole('button', { name: 'Lock editor', exact: true }).click();
  await expect(page.locator('#unlockCard')).toBeVisible();
  await page.reload();
  await expect(page.locator('#unlockCard')).toBeVisible();
  await page.locator('#eventPassword').fill('browser-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#setupCard')).toBeVisible();
  await page.getByText('Editing access', { exact: true }).click();
  await page.locator('#changeEventPassword').fill('replacement-password');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(page.locator('#unlockCard')).toBeVisible();
  await page.locator('#eventPassword').fill('replacement-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('#setupCard')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(page.locator('#accessNotice')).toContainText('No password set');
  await page.reload();
  await expect(page.locator('#setupCard')).toBeVisible();
});

test('creation accepts optional passwords and automatically unlocks the new protected event', async ({ page }) => {
  await page.goto('/');
  await page.locator('#newEventName').fill('Created With Password');
  await page.locator('#newEventPassword').fill('creation-password');
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  await expect(page.locator('#setupCard')).toBeVisible();
  await expect(page.locator('#accessNotice')).toContainText('password-protected');
  await page.reload();
  await expect(page.locator('#setupCard')).toBeVisible();
  await page.getByRole('button', { name: 'Switch Event', exact: true }).click();
  await page.locator('#newEventName').fill('Created Without Password');
  await page.getByRole('button', { name: 'Create Event', exact: true }).click();
  await expect(page.locator('#setupCard')).toBeVisible();
  await expect(page.locator('#accessNotice')).toContainText('No password set');
});

test('spectators are told when live updates fail and recover automatically', async ({ page, request }) => {
  const created = await request.post('/api/events', {
    data: { name: 'Connection Browser Event', baseline: 50 }
  });
  const event = await created.json();
  await page.goto(`/event/${event.id}/spectator`);
  await expect(page.locator('#liveStatus')).toHaveText('Live updates every 3 seconds.');
  await page.route('**/api/events/*/shots', route => route.abort());
  await expect(page.locator('#liveStatus')).toContainText('Updates paused', { timeout: 10000 });
  await page.unroute('**/api/events/*/shots');
  await expect(page.locator('#liveStatus')).toHaveText('Live updates every 3 seconds.', { timeout: 10000 });
});
