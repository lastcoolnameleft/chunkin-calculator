const { test, expect } = require('@playwright/test');

test('angle help explains each reference direction and toggles by mouse or keyboard', async ({ page, request }) => {
  const res = await request.post('/api/events', { data: { name: 'Angle Help Event', baseline: 50 } });
  const event = await res.json();
  await page.goto(`/event/${event.id}`);
  await expect(page.locator('#setupCard')).toBeVisible();

  for (const [field, name, phrases] of [
    ['angA', 'Help with Station A angle', ['Stand at Station A', 'Station B to set 0°', 'A→B sight line', 'A→splash sight line', 'Do not measure from the trebuchet']],
    ['angB', 'Help with Station B angle', ['Stand at Station B', 'Station A to set 0°', 'B→A sight line', 'B→splash sight line', 'less than 180°']],
    ['trebAngle', 'Help with trebuchet survey angle', ['Stand at Station A', 'Station B to set 0°', 'toward the trebuchet', 'negative', 'not its launch angle']]
  ]) {
    const button = page.getByRole('button', { name, exact: true });
    const help = page.locator(`#${field}Help`);
    await expect(help).toBeHidden();
    await expect(page.locator(`#${field}`)).toHaveAttribute('aria-describedby', `${field}Help`);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(help).toBeVisible();
    for (const phrase of phrases) await expect(help).toContainText(phrase);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(help).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(help).toBeVisible();
    await expect(page.locator(`#${field}`)).toHaveValue('');
  }
});
