const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test('how this works renders the shared Markdown guide with equations and its diagram inside the site', async ({ page, request }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'How this works: a plain-language guide and the math' });
  await expect(link).toHaveAttribute('href', '/how-it-works/');
  await page.goto('/how-it-works/');
  await expect(page.getByRole('heading', { name: 'How This Works', exact: true })).toBeVisible();
  const source = await fs.readFile(path.join(__dirname, '../docs/triangulation-guide.md'), 'utf8');
  const headings = source.split('\n').filter(line => /^## /.test(line)).map(line => line.slice(3));
  for (const heading of headings) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.locator('main')).toContainText('The spotters do not need to do any math');
  await expect(page.locator('main')).toContainText('not the accuracy of the spotters');
  expect(await page.locator('.katex').count()).toBeGreaterThan(10);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Triangulation Setup' })).toBeVisible();
  expect(await page.getByRole('img', { name: 'Triangulation Setup' }).evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  expect((await request.get('/guide-assets/katex.min.css')).status()).toBe(200);
  const style = await (await request.get('/guide-assets/katex.min.css')).text();
  const font = style.match(/url\((fonts\/[^)]+)\)/);
  expect(font).not.toBeNull();
  expect((await request.get(`/guide-assets/${font[1]}`)).status()).toBe(200);
});
