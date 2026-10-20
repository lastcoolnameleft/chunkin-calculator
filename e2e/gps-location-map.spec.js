const { test, expect } = require('@playwright/test');

test('captured GPS opens a draggable preview, cancel preserves the capture, and adjustments save only with the form', async ({ page, context, request }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39.1, longitude: -76.9, accuracy: 3 });
  const event = await (await request.post('/api/events', {
    data: { name: 'Adjust GPS', measurementMode: 'gps', unit: 'm' }
  })).json();
  await page.goto(`/event/${event.id}`);
  await page.getByRole('button', { name: 'Capture GPS at launch location', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review launch location', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#gpsLocationCoordinates')).toContainText('39.100000, -76.900000');
  const pin = page.locator('#gpsLocationMap .leaflet-marker-draggable');
  const box = await pin.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#gpsLocationCoordinates')).toContainText('Map-adjusted');
  await expect(page.locator('#launchLat')).toHaveValue('39.1');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#launchLat')).toHaveValue('39.1');
  await expect(page.locator('#launchStatus')).toContainText('±3 m');

  await page.getByRole('button', { name: 'Review / adjust launch location on map', exact: true }).click();
  await page.locator('#gpsLocationMap').click({ position: { x: 170, y: 130 } });
  const adjusted = await page.evaluate(() => {
    const point = gpsLocationEditor.marker.getLatLng();
    return { latitude: point.lat, longitude: point.lng };
  });
  expect(adjusted.latitude).not.toBe(39.1);
  expect(adjusted.longitude).not.toBe(-76.9);
  await page.getByRole('button', { name: 'Use location', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#launchLat')).toHaveValue(String(adjusted.latitude));
  await expect(page.locator('#launchLng')).toHaveValue(String(adjusted.longitude));
  await expect(page.locator('#launchStatus')).toContainText('accuracy and capture time are unknown');
  expect(await (await request.get(`/api/events/${event.id}/trebuchets`)).json()).toEqual([]);
  await page.locator('#trebName').fill('Adjusted launcher');
  await page.getByRole('button', { name: 'Add trebuchet', exact: true }).click();
  await expect(page.locator('#trebBody')).toContainText('Adjusted launcher');
  const [treb] = await (await request.get(`/api/events/${event.id}/trebuchets`)).json();
  expect(treb.gps).toMatchObject({ ...adjusted, accuracy: null, capturedAt: null });

  await page.getByRole('tab', { name: 'Log a Shot', exact: true }).click();
  await page.locator('#trebSelect').selectOption({ label: 'Adjusted launcher' });
  await page.getByRole('button', { name: 'Capture GPS at landing location', exact: true }).click();
  await page.locator('#gpsLocationMap').click({ position: { x: 180, y: 140 } });
  await page.getByRole('button', { name: 'Use location', exact: true }).click();
  const landing = await page.locator('#landingLat').inputValue();
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(page.locator('#latestDistance')).not.toHaveText('—');
  const [shot] = await (await request.get(`/api/events/${event.id}/shots`)).json();
  expect(shot.landingGps.latitude).toBe(Number(landing));
  expect(shot.landingGps.accuracy).toBeNull();
  expect(shot.landingGps.capturedAt).toBeNull();
  await page.reload();
  await expect(page.locator('#trebBody')).toContainText('Adjusted launcher');
  await expect(page.locator('#latestDistance')).toHaveText(`${shot.dist.toFixed(1)} m`);
});

test('station map previews accept captures or manual coordinates and fit a phone', async ({ page, context, request }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39.1, longitude: -76.9, accuracy: 4 });
  const event = await (await request.post('/api/events', {
    data: { name: 'Station previews', baseline: 96, measurementMode: 'angles' }
  })).json();
  await page.goto(`/event/${event.id}`);
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await page.getByText('Optional: Satellite Map Overlay (GPS Coordinates)', { exact: true }).click();
  await page.getByRole('button', { name: 'Capture Station A GPS', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'Review station a', exact: true })).toBeVisible();
  const dialogBox = await page.locator('#gpsLocationDialog').boundingBox();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Use location', exact: true }).click();
  await expect(page.locator('#stALat')).toHaveValue('39.1');
  await page.locator('#stBLat').fill('39.1005');
  await page.locator('#stBLng').fill('-76.9');
  await page.getByRole('button', { name: 'Review / adjust Station B on map', exact: true }).click();
  await page.locator('#gpsLocationMap').click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Use location', exact: true }).click();
  const latitude = Number(await page.locator('#stBLat').inputValue());
  expect(latitude).not.toBe(39.1005);
  await page.getByRole('button', { name: 'Save GPS Coordinates', exact: true }).click();
  await expect(page.locator('#setupStatus')).toContainText('Satellite map active');
  const saved = await (await request.get(`/api/events/${event.id}`)).json();
  expect(saved.station_a_lat).toBe(39.1);
  expect(saved.station_b_lat).toBe(latitude);
});

test('GPS checks can adjust both points without rewriting the compass result', async ({ page, context, request }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 39, longitude: -76, accuracy: 3 });
  const event = await (await request.post('/api/events', {
    data: { name: 'Check previews', measurementMode: 'bearings' }
  })).json();
  await request.post(`/api/events/${event.id}/setup`, {
    data: { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270, gpsBackup: true }
  });
  const treb = await (await request.post(`/api/events/${event.id}/trebuchets`, {
    data: { name: 'Launcher', dist: 0, bearing: 0, gps: { latitude: 39, longitude: -76 } }
  })).json();
  const shot = await (await request.post(`/api/events/${event.id}/shots`, {
    data: { label: 'Compass', trebId: treb.id, bearingA: 30, bearingB: 330 }
  })).json();
  await page.goto(`/event/${event.id}`);
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  await page.getByRole('button', { name: 'Add GPS check for Compass', exact: true }).click();
  for (const name of ['launch', 'landing']) {
    await page.getByRole('button', { name: `Capture GPS at check ${name} location`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: `Review check ${name} location`, exact: true })).toBeVisible();
    await page.locator('#gpsLocationMap').click({ position: { x: name === 'launch' ? 170 : 190, y: 130 } });
    await page.getByRole('button', { name: 'Use location', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save GPS check', exact: true }).click();
  await expect(page.locator('#gpsCheckPanel')).toBeHidden();
  const [saved] = await (await request.get(`/api/events/${event.id}/shots`)).json();
  expect(saved.dist).toBe(shot.dist);
  expect(saved.gpsChecks).toHaveLength(1);
  expect(saved.gpsChecks[0].launchGps.accuracy).toBeNull();
  expect(saved.gpsChecks[0].landingGps.accuracy).toBeNull();
});

test('empty coordinates and unavailable maps give explicit feedback, and event changes discard previews', async ({ page, context, request }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 4 });
  const event = await (await request.post('/api/events', {
    data: { name: 'Map fallbacks', measurementMode: 'gps' }
  })).json();
  await page.goto(`/event/${event.id}`);
  await page.getByRole('button', { name: 'Review / adjust launch location on map', exact: true }).click();
  await expect(page.locator('#launchStatus')).toContainText('enter valid latitude and longitude');
  await expect(page.locator('#gpsLocationDialog')).toBeHidden();
  await page.getByRole('button', { name: 'Capture GPS at launch location', exact: true }).click();
  await expect(page.locator('#gpsLocationCoordinates')).toContainText('0.000000, 0.000000');
  await page.keyboard.press('Escape');
  await expect(page.locator('#gpsLocationDialog')).toBeHidden();
  await expect(page.locator('#launchStatus')).toContainText('±4 m');
  await page.getByRole('button', { name: 'Review / adjust launch location on map', exact: true }).click();
  await page.evaluate(() => {
    editable = false;
    renderAccess();
  });
  await expect(page.locator('#gpsLocationDialog')).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Capture GPS at launch location', exact: true }).click();
  await expect(page.locator('#gpsLocationDialog')).toBeVisible();
  await page.evaluate(() => showEventPicker());
  await expect(page.locator('#gpsLocationDialog')).toBeHidden();
  await page.goto(`/event/${event.id}`);
  await expect(page.getByRole('button', { name: 'Capture GPS at launch location', exact: true })).toBeVisible();
  await page.evaluate(() => { window.L = undefined; });
  await page.getByRole('button', { name: 'Capture GPS at launch location', exact: true }).click();
  await expect(page.locator('#launchStatus')).toContainText('map library could not be loaded');
  await expect(page.locator('#launchLat')).toHaveValue('0');
  await page.locator('#launchLat').fill('0.001');
  await page.getByRole('button', { name: 'Add trebuchet', exact: true }).click();
  await expect(page.locator('#trebBody')).toContainText('accuracy unknown');
});
