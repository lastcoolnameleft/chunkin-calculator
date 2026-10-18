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
