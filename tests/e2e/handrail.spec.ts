import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const live = (page: Page) => page.getByTestId('live-region');
const column = (page: Page, name: string) => page.getByTestId(`column-${name}`);
const cardIn = (page: Page, col: string, title: string) => column(page, col).locator('[data-card]', { hasText: title });

async function run(page: Page, text: string) {
  await page.locator('#command-input').fill(text);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Climate talk: group project');
});

test.describe('keyboard only', () => {
  test('skip link, pick up a card with Space, move it with arrows, drop with Enter', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the command box' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const first = page.locator('[data-card]').first();
    await expect(first).toBeFocused();
    await expect(first).toHaveAccessibleName(/^Find five sources on heat waves ?, due tomorrow, .*assigned to you, has notes\. 1 of 4 in To do$/);

    await page.keyboard.press('Space');
    await expect(live(page)).toContainText('Picked up Find five sources on heat waves');
    await page.keyboard.press('ArrowRight');
    await expect(live(page)).toContainText('Moved to Doing. Doing, position 1 of 2.');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(live(page)).toContainText('Dropped Find five sources on heat waves in Doing, position 2 of 2.');
    await expect(cardIn(page, 'Doing', 'Find five sources')).toBeFocused();
  });

  test('Escape puts a picked-up card back', async ({ page }) => {
    await page.locator('[data-card]').first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(live(page)).toContainText('Cancelled. Find five sources on heat waves is back in To do, position 1.');
    await expect(cardIn(page, 'To do', 'Find five sources')).toBeVisible();
  });

  test('number keys send a card to a column, arrows move focus across columns', async ({ page }) => {
    await page.locator('[data-card]').first().focus();
    await page.keyboard.press('3');
    await expect(cardIn(page, 'Done', 'Find five sources')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cardIn(page, 'Doing', 'Draft the outline')).toBeFocused();
  });

  test('Enter opens the action menu; moving from it returns focus to the card', async ({ page }) => {
    await page.locator('[data-card]').first().focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Find five sources on heat waves' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toBeHidden();
    await expect(cardIn(page, 'Done', 'Find five sources')).toBeFocused();
  });

  test('Delete removes a card and Ctrl+Z brings it back', async ({ page }) => {
    await cardIn(page, 'Done', 'Set up the group chat').focus();
    await page.keyboard.press('Delete');
    await expect(live(page)).toContainText('Deleted “Set up the group chat”');
    await expect(page.locator('[data-card]', { hasText: 'Set up the group chat' })).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(cardIn(page, 'Done', 'Set up the group chat')).toBeVisible();
  });

  test('N opens a new card form in the focused column', async ({ page }) => {
    await cardIn(page, 'Doing', 'Draft the outline').focus();
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'New card' });
    await expect(page.locator('#ed-title')).toBeFocused();
    await page.keyboard.type('Check citations');
    await dialog.getByLabel('or type it').fill('next monday');
    await dialog.getByRole('button', { name: 'Add card' }).click();
    await expect(cardIn(page, 'Doing', 'Check citations')).toBeFocused();
  });
});

test.describe('plain-language commands', () => {
  test('add, move, ask and undo', async ({ page }) => {
    await run(page, 'add book a study room due tomorrow for riya');
    await expect(page.getByTestId('reply')).toContainText('Added “book a study room” to To do, due tomorrow');
    await expect(page.getByTestId('reply')).toContainText('assigned to Riya');
    await expect(cardIn(page, 'To do', 'book a study room')).toContainText('Riya');

    await run(page, 'outline is done');
    await expect(cardIn(page, 'Done', 'Draft the outline')).toBeVisible();

    await run(page, "what's due today");
    await expect(page.getByTestId('reply')).toContainText('Email Dr. Mehta about the extension, due today');

    await run(page, 'undo');
    await expect(page.getByTestId('reply')).toHaveText('Undid: move “Draft the outline” to Done.');
    await expect(cardIn(page, 'Doing', 'Draft the outline')).toBeVisible();
  });

  test('explains mistakes instead of guessing', async ({ page }) => {
    await run(page, 'move outline to archive');
    await expect(page.getByTestId('reply')).toContainText('Columns are: To do, Doing, Done.');
    await expect(page.locator('#command-input')).toHaveValue('move outline to archive');
  });
});

test.describe('handoff between teammates', () => {
  test('a teammate’s link lists what they changed, and your own edits don’t hide it', async ({ page, browser }) => {
    // Priya shares the board.
    await page.getByRole('button', { name: 'Share' }).click();
    const link = await page.getByLabel(/Link to/).inputValue();
    await page.keyboard.press('Escape');

    // Riya opens it on her own device, sets her name, makes changes and shares back.
    const riyaCtx = await browser.newContext();
    const riya = await riyaCtx.newPage();
    await riya.goto(link);
    await expect(riya.getByRole('heading', { level: 1 })).toHaveText('Climate talk: group project');
    await expect(riya.getByTestId('changes')).toHaveCount(0);
    await riya.getByRole('button', { name: 'Settings' }).click();
    await riya.getByLabel('Your name').fill('Riya');
    await riya.getByRole('button', { name: 'Done', exact: true }).click();
    await run(riya, 'move design slides to done');
    await run(riya, 'assign email to priya');
    await riya.getByRole('button', { name: 'Share' }).click();
    const back = await riya.getByLabel(/Link to/).inputValue();
    await riyaCtx.close();

    // Priya opens Riya's link.
    await page.goto(back);
    const changes = page.getByTestId('changes');
    await expect(changes).toBeFocused();
    await expect(changes.getByRole('listitem')).toHaveText([
      /For you: Riya assigned “Email Dr. Mehta about the extension” to you\./,
      /Riya moved “Design slides 4 to 8” from To do to Done\./,
    ]);
    await expect(live(page)).toContainText('2 changes since you last looked, 1 for you');

    await run(page, 'move email to doing');
    await expect(changes.getByRole('listitem')).toHaveCount(2);
    await changes.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByTestId('changes')).toHaveCount(0);
  });

  test('the built-in demo simulates teammates’ overnight changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Boards & files' }).click();
    await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
    await expect(page.getByTestId('changes').getByRole('heading')).toContainText('4 changes');
  });

  test('a broken link is explained', async ({ page }) => {
    await page.goto('/#board=v1.garbage');
    await expect(live(page)).toContainText('That share link is broken or incomplete');
  });
});

test('mouse users can still drag and drop', async ({ page }) => {
  await cardIn(page, 'To do', 'Design slides').dragTo(column(page, 'Done').locator('ol'));
  await expect(cardIn(page, 'Done', 'Design slides')).toBeVisible();
});

test('settings persist after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('High contrast').check();
  await page.getByLabel('Text size').selectOption('150');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await expect(page.locator('html')).toHaveCSS('font-size', '24px');
});

test.describe('automated accessibility audit (axe, WCAG 2.2 AA)', () => {
  const audit = async (page: Page) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };

  for (const theme of ['light', 'dark', 'contrast'] as const) {
    test(`board in ${theme} theme`, async ({ page }) => {
      await page.evaluate((t) => {
        const raw = JSON.parse(localStorage.getItem('handrail:v1')!);
        raw.settings.theme = t;
        localStorage.setItem('handrail:v1', JSON.stringify(raw));
      }, theme);
      await page.reload();
      await page.getByRole('button', { name: 'Boards & files' }).click();
      await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
      await expect(page.getByTestId('changes')).toBeVisible();
      await audit(page);
    });
  }

  for (const name of ['Help', 'Settings', 'Share', 'Boards & files']) {
    test(`${name} dialog`, async ({ page }) => {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page);
    });
  }

  test('card menu and editor', async ({ page }) => {
    await page.locator('[data-card]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page);
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit card' })).toBeVisible();
    await audit(page);
  });

  test('phone width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await audit(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
