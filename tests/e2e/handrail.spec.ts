import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const live = (page: Page) => page.getByTestId('live-region');
const reply = (page: Page) => page.getByTestId('reply').last();
const column = (page: Page, name: string) => page.getByTestId(`column-${name}`);
const cardIn = (page: Page, col: string, title: string) => column(page, col).locator('[data-card]', { hasText: title });

async function simulate(page: Page) {
  await page.locator('#board-switcher').click();
  await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
  await expect(page.getByTestId('change-list')).toBeVisible();
}

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
    await expect(page.getByRole('link', { name: 'Skip to the board' })).toBeFocused();
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
    await expect(reply(page)).toContainText('Added “book a study room” to To do, due tomorrow');
    await expect(reply(page)).toContainText('assigned to Riya');
    await expect(cardIn(page, 'To do', 'book a study room')).toContainText('Riya');

    await run(page, 'outline is done');
    await expect(cardIn(page, 'Done', 'Draft the outline')).toBeVisible();

    await run(page, "what's due today");
    await expect(reply(page)).toContainText('Email Dr. Mehta about the extension, due today');

    await run(page, 'undo');
    await expect(reply(page)).toHaveText(/Undid: move “Draft the outline” to Done\.$/);
    await expect(page.getByTestId('history').getByRole('listitem')).toHaveCount(8);
    await expect(cardIn(page, 'Doing', 'Draft the outline')).toBeVisible();
  });

  test('explains mistakes instead of guessing', async ({ page }) => {
    await run(page, 'move outline to archive');
    await expect(reply(page)).toContainText('Columns are: To do, Doing, Done.');
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
    await expect(riya.getByTestId('change-list')).toHaveCount(0);
    await expect(riya.getByTestId('changes')).toContainText('Nothing new');
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
    await expect(page.getByTestId('change-list')).toHaveCount(0);
    await expect(page.getByTestId('changes-collapsed')).toHaveText(/2 changes, 1 for you\s*Show/);
    await expect(page.getByRole('button', { name: 'Show changes' })).toBeFocused();
  });

  test('the built-in demo simulates teammates’ overnight changes', async ({ page }) => {
    await page.locator('#board-switcher').click();
    await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
    await expect(page.getByTestId('changes')).toContainText('4 changes, 1 for you');
  });

  test('a broken link is explained', async ({ page }) => {
    await page.goto('/#board=v1.garbage');
    await expect(live(page)).toContainText('That share link is broken or incomplete');
  });
});

test.describe('activity panel', () => {
  test('“Got it” collapses the changes to one row that stays until new changes arrive', async ({ page }) => {
    await simulate(page);
    const changes = page.getByTestId('changes');
    await changes.getByRole('button', { name: 'Got it' }).click();
    const row = page.getByTestId('changes-collapsed');
    await expect(row).toContainText('4 changes, 1 for you');
    await page.reload();
    await expect(row).toContainText('4 changes, 1 for you');

    await row.getByRole('button', { name: 'Show changes' }).click();
    await expect(page.getByTestId('change-list').getByRole('listitem')).toHaveCount(4);
    await changes.getByRole('button', { name: 'Hide changes' }).click();
    await expect(row).toBeVisible();

    // New changes replace the acknowledged list and open it again.
    await simulate(page);
    await expect(page.getByTestId('change-list').getByRole('listitem')).toHaveCount(4);
    await expect(changes.getByRole('button', { name: 'Got it' })).toBeVisible();
  });

  test('“Just mine” filters the board and the change list', async ({ page }) => {
    await simulate(page);
    const toggle = page.getByRole('button', { name: 'Just mine' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-card]')).toHaveCount(8);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(live(page)).toContainText('Showing only your 3 cards');
    await expect(page.locator('[data-card]')).toHaveText([/Find five sources/, /Email Dr\. Mehta/, /Draft the outline/]);
    await expect(page.getByTestId('change-list').getByRole('listitem')).toHaveCount(1);
    await expect(column(page, 'To do').getByRole('heading')).toContainText('2 of 3');

    // Moving within the filtered view keeps hidden cards safe.
    await cardIn(page, 'To do', 'Email Dr. Mehta').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await toggle.click();
    await expect(page.locator('[data-card]')).toHaveCount(8);
    await expect(column(page, 'To do').locator('[data-card]').first()).toContainText('Email Dr. Mehta');
    await expect(column(page, 'To do').locator('[data-card]')).toHaveCount(3);
  });

  test('examples show only while the command box is focused and empty, or on request', async ({ page }) => {
    const chips = page.getByRole('group', { name: 'Example commands' });
    await expect(chips).toBeHidden();
    await page.locator('#command-input').focus();
    await expect(chips).toBeVisible();
    await page.locator('#command-input').fill('m');
    await expect(chips).toBeHidden();
    await page.locator('#command-input').fill('');
    await chips.getByRole('button', { name: 'my tasks' }).click();
    await expect(page.locator('#command-input')).toHaveValue('my tasks');
    await expect(page.locator('#command-input')).toBeFocused();
    await page.locator('.board-counts').click();
    await page.getByRole('button', { name: 'Show examples' }).click();
    await expect(chips).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide examples' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('the board name opens the board switcher, where the board can be renamed', async ({ page }) => {
    await page.locator('#board-switcher').click();
    const dialog = page.getByRole('dialog', { name: 'Boards & files' });
    await expect(dialog.getByLabel('Name of this board')).toBeFocused();
    await dialog.getByLabel('Name of this board').fill('Climate talk v2');
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk v2/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#board-switcher')).toBeFocused();
  });

  test('every command and reply is kept in the history', async ({ page }) => {
    await run(page, 'my tasks');
    await run(page, 'move pizza to done');
    const items = page.getByTestId('history').getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveText('You said: my tasks');
    await expect(items.nth(1)).toContainText('Handrail: You have 2 open cards');
    await expect(items.nth(3)).toHaveClass(/msg-fail/);
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
      await page.locator('#board-switcher').click();
      await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
      await expect(page.getByTestId('changes')).toBeVisible();
      await audit(page);
    });
  }

  for (const [label, name] of [['Help', 'Help'], ['Settings', 'Settings'], ['Share', 'Share'], ['Boards', '']] as const) {
    test(`${label} dialog`, async ({ page }) => {
      await (name ? page.getByRole('button', { name, exact: true }) : page.locator('#board-switcher')).click();
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
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
    await audit(page);
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
