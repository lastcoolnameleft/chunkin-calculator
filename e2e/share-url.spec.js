const { test, expect } = require('@playwright/test');

test('copy URL confirms inline, resets after three seconds, and reports clipboard failure without a popup', async ({ page, request }) => {
  const res = await request.post('/api/events', { data: { name: 'Copy URL Event' } });
  const event = await res.json();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async text => {
          if (window.failCopy) throw new Error('Permission denied');
          window.copiedUrl = text;
        }
      }
    });
  });
  page.on('dialog', () => { throw new Error('Copy must not open a dialog'); });
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#eventSummaryName')).toHaveText(event.name);
  await page.clock.install();
  const button = page.locator('#copyShareButton');
  await button.click();
  await expect(button).toHaveText('Copied');
  expect(await page.evaluate(() => window.copiedUrl)).toBe(
    `http://127.0.0.1:3088/event/${event.id}/spectator`);
  await page.clock.fastForward(2000);
  await button.click();
  await page.clock.fastForward(2000);
  await expect(button).toHaveText('Copied');
  await page.clock.fastForward(1000);
  await expect(button).toHaveText('Copy URL');
  await page.evaluate(() => { window.failCopy = true; });
  await button.click();
  await expect(button).toHaveText('Copy URL');
  await expect(page.locator('#globalError')).toContainText('Could not copy the URL: Permission denied');
});
