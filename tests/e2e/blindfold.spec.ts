import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// "Try it with your eyes closed": the one-minute keyboard-only challenge.

const audit = async (page: Page) => {
  // Check the settled page: a caption caught halfway through its fade-in is genuinely low-contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((an) => an.playState !== 'running' || an.effect?.getTiming().iterations === Infinity),
  null, { timeout: 10_000 });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
};

async function startChallenge(page: Page) {
  await page.goto('/?blindfold');
  const intro = page.getByRole('dialog', { name: 'Try it with your eyes closed' });
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Start, and turn the screen off' }).click();
  await expect(page.getByTestId('blindfold-layer')).toBeVisible();
  // Starting runs the teammate demo, which moves focus to the change list a frame later.
  await expect(page.locator('#changes-h')).toBeFocused();
}

async function tabTo(page: Page, text: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const t = await page.evaluate(() => (document.activeElement as HTMLElement)?.textContent ?? '');
    if (text.test(t)) return;
  }
  throw new Error(`Never reached ${text}`);
}

// Every test here runs the axe audit or the whole challenge, which is heavy work on a busy machine.
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('handrail:story-seen', '1'));
});

test('the intro explains the challenge and passes the audit', async ({ page }) => {
  await page.goto('/?blindfold');
  const intro = page.getByRole('dialog', { name: 'Try it with your eyes closed' });
  await expect(intro).toBeVisible();
  await expect(intro.getByRole('listitem')).toHaveText([/Hear what your teammates changed/, /Go to the card that is now yours/, /Move “Find five sources” to Doing/]);
  await expect(intro.getByRole('button', { name: 'Start, and turn the screen off' })).toBeFocused();
  await audit(page);
});

test('the screen goes dark but the app still works by keyboard, and the challenge can be finished', async ({ page }) => {
  // The whole one-minute challenge, step by step; slow CI machines need more than the default 30 s.
  test.setTimeout(90_000);
  await startChallenge(page);
  // Dark for sighted users, but nothing is removed from the accessibility tree.
  await expect(page.locator('html')).toHaveClass(/bf-on/);
  await expect(page.getByTestId('blindfold-layer')).toHaveAttribute('aria-hidden', 'true');
  const boardOpacity = await page.locator('#board-switcher').evaluate((el) => {
    let op = 1;
    for (let p: HTMLElement | null = el as HTMLElement; p; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
    return op;
  });
  expect(boardOpacity).toBe(0);
  await expect(page.getByRole('button', { name: 'Stop the challenge' })).toBeVisible();
  await audit(page);

  // Step 1: the teammates' changes are announced and captioned.
  await expect(page.locator('.bf-caption')).toContainText(/changes? since you last looked/i);
  await expect(page.locator('.bf-progress li').first()).toHaveClass(/is-done/);

  // Step 2: reach the card that is now yours, by keyboard only.
  await tabTo(page, /Go to card.*Email Dr\. Mehta/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#card-k-email')).toBeFocused();
  await expect(page.locator('.bf-progress li').nth(1)).toHaveClass(/is-done/);

  // Step 3: move a card with a typed sentence.
  await page.keyboard.press('/');
  await page.keyboard.type('move find sources to doing');
  await page.keyboard.press('Enter');

  const result = page.getByRole('dialog', { name: /^Done in \d+ seconds$/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Priya does this every day.');
  await expect(page.locator('html')).not.toHaveClass(/bf-on/);
  await expect(page.getByTestId('blindfold-layer')).toHaveCount(0);
  await audit(page);
  await result.getByRole('button', { name: 'Back to the board' }).click();
  await expect(page.getByTestId('column-Doing').locator('[data-card]', { hasText: 'Find five sources' })).toBeVisible();
});

test('without a screen reader, focus is captioned (and spoken) so people know where they are', async ({ page }) => {
  await startChallenge(page);
  await page.locator('#card-k-sources').focus();
  await expect(page.locator('.bf-focus')).toContainText('Find five sources on heat waves');
  await page.keyboard.press('/');
  await expect(page.locator('.bf-focus')).toContainText(/edit text$/);
});

test('the mouse is blocked while the screen is dark', async ({ page }) => {
  await startChallenge(page);
  const box = await page.locator('#card-k-sources').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('one Escape keeps going (it cancels a picked-up card); two quick Escapes stop', async ({ page }) => {
  await startChallenge(page);
  await page.locator('#card-k-sources').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('blindfold-layer')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('blindfold-layer')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/bf-on/);
});

test('the challenge reads a card the way a screen reader would, without the visual badges', async ({ page }) => {
  await startChallenge(page);
  await page.locator('#card-k-email').focus();
  const focus = page.locator('.bf-focus');
  await expect(focus).toContainText('Email Dr. Mehta about the extension, due today, assigned to you.');
  await expect(focus).not.toContainText('reassignedToday');
  await expect(focus).not.toContainText('Riya · reassigned.Riya');
});

test('dialogs opened during the challenge stay hidden from sight', async ({ page }) => {
  await startChallenge(page);
  await page.locator('#card-k-sources').focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog');
  await expect(menu).toBeAttached();
  expect(await menu.evaluate((d) => getComputedStyle(d).opacity)).toBe('0');
  // Still fully usable by keyboard: move from the menu.
  await page.getByRole('button', { name: /Doing/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^Done in/ })).toHaveCount(0); // not finished: step 2 not done yet
  await expect(page.locator('.bf-progress li').nth(2)).toHaveClass(/is-done/);
});
