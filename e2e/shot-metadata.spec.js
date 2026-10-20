const { test, expect } = require('@playwright/test');

test('optional weights and finger angle are visible to spectators and exported with historical units', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: { name: 'Shot details', baseline: 50, unit: 'ft' } })).json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#shotEntryCard')).toBeVisible();
  await expect(page.getByLabel('Ballistic weight (lb, optional)')).toBeVisible();
  await page.locator('#ballisticWeight').fill('12.5');
  await page.locator('#counterweight').fill('1000');
  await page.locator('#fingerAngle').fill('-15');
  await page.locator('#angA').fill('60');
  await page.locator('#angB').fill('60');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await expect(page.locator('#lastResult')).not.toContainText('Baseline');
  await expect(page.getByRole('columnheader', { name: 'Baseline check', exact: true })).toHaveCount(0);
  await expect(page.locator('#shotBody')).toContainText('12.5 lb');
  await expect(page.locator('#shotBody')).toContainText('1000 lb');
  await expect(page.locator('#shotBody')).toContainText('-15°');
  await expect(page.locator('#ballisticWeight')).toHaveValue('');
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await page.locator('#unit').selectOption('m');
  await page.getByRole('button', { name: 'Save setup', exact: true }).click();
  await page.getByRole('tab', { name: 'Log a Shot', exact: true }).click();
  await expect(page.getByLabel('Ballistic weight (kg, optional)')).toBeVisible();
  await page.goto(`/event/${event.id}/spectator`);
  await expect(page.locator('#shotBody')).toContainText('12.5 lb');
  await expect(page.locator('#shotBody')).toContainText('-15°');
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  await page.getByRole('button', { name: 'Show CSV', exact: false }).click();
  await expect(page.locator('#csvBox')).toHaveValue(/12\.5,1000,lb,-15/);
});

test('empty optional columns stay hidden and appear independently for zero-valued shot details', async ({ page, request }) => {
  const event = await (await request.post('/api/events', {
    data: { name: 'Sparse shot details', baseline: 50, unit: 'ft' }
  })).json();
  const base = `/api/events/${event.id}/shots`;
  await page.goto(`/event/${event.id}`);
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  const headers = page.locator('#shotTable th[data-shot-field]');
  await expect(headers.filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('#shotBody .empty')).toHaveAttribute('colspan', '8');
  const plain = await request.post(base, { data: { label: 'No details', angA: 60, angB: 60 } });
  expect(plain.ok()).toBe(true);
  await page.reload();
  await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
  await expect(page.locator('#shotBody')).toContainText('No details');
  await expect(headers.filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('#shotBody tr').first().locator('td')).toHaveCount(8);

  for (const [field, name, value, display] of [
    ['ballisticWeight', 'Ballistic weight', 0, '0 lb'],
    ['counterweight', 'Counterweight', 0, '0 lb'],
    ['fingerAngle', 'Finger angle', 0, '0°']
  ]) {
    await page.getByRole('tab', { name: 'Log a Shot', exact: true }).click();
    await page.locator('#angA').fill('60');
    await page.locator('#angB').fill('60');
    await page.locator(`#${field}`).fill(String(value));
    await page.getByRole('button', { name: 'Add shot', exact: true }).click();
    await expect(page.locator('#shotBody')).toContainText(display);
    await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
    await expect(headers.filter({ visible: true })).toHaveText([name]);
    await expect(page.locator('#shotBody tr').first().locator('td').nth(7)).toHaveText('—');
    await expect(page.locator('#shotBody tr').last().locator('td').nth(7)).toHaveText(display);
    await page.goto(`/event/${event.id}/spectator`);
    await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
    await expect(headers.filter({ visible: true })).toHaveText([name]);
    await expect(page.locator('#shotBody tr').last().locator('td')).toHaveCount(8);
    await page.goto(`/event/${event.id}`);
    await page.getByRole('tab', { name: 'Shot History', exact: true }).click();
    await page.locator('#shotBody tr').last().getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(headers.filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#shotBody tr')).toHaveCount(1);
  }
  await page.locator('#shotBody tr').first().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#shotBody .empty')).toHaveAttribute('colspan', '8');
});
