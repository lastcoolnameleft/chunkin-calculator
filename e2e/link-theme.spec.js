const { test, expect } = require('@playwright/test');

function luminance(rgb) {
  const channels = rgb.match(/\d+/g).slice(0, 3).map(value => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

for (const colorScheme of ['dark', 'light']) {
  test(`guide link is readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    const link = page.getByRole('link', { name: 'How this works: a plain-language guide and the math' });
    const colors = await link.evaluate(element => ({
      link: getComputedStyle(element).color,
      background: getComputedStyle(document.body).backgroundColor
    }));
    const foreground = luminance(colors.link);
    const background = luminance(colors.background);
    expect((Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    await link.focus();
    await expect(link).toHaveCSS('outline-style', 'solid');
  });
}
