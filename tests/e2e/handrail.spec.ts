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
  // The story is shown to first-time visitors; these tests are about the board.
  await page.addInitScript(() => {
    localStorage.setItem('handrail:story-seen', '1');
    sessionStorage.setItem('handrail:story-shown', '1');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Climate talk: group project');
});

test.describe('works on top of Trello', () => {
  const lists = [{ id: 'L1', name: 'To Do', pos: 1 }, { id: 'L2', name: 'Doing', pos: 2 }];
  const riya = { fullName: 'Riya Sharma' };
  const file = (data: object) => ({ name: 'trello-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

  test('re-importing a newer Trello export tells you what changed there, and who did it', async ({ page }) => {
    await page.locator('#board-switcher').click();
    await page.locator('#import-file').setInputFiles(file({
      id: 'B1', name: 'Bio lab', lists, cards: [{ id: 'c1', name: 'Write method', idList: 'L1', pos: 1 }], actions: [],
    }));
    await expect(live(page)).toContainText('Imported “Bio lab” from Trello');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bio lab');

    await page.locator('#board-switcher').click();
    await page.locator('#import-file').setInputFiles(file({
      id: 'B1', name: 'Bio lab', lists,
      cards: [{ id: 'c1', name: 'Write method', idList: 'L2', pos: 1 }, { id: 'c2', name: 'Abstract', idList: 'L1', pos: 1 }],
      actions: [
        { type: 'createCard', date: '2026-10-22T10:00:00.000Z', memberCreator: riya, data: { card: { id: 'c2' } } },
        { type: 'updateCard', date: '2026-10-22T09:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' }, old: { idList: 'L1' } } },
      ],
    }));
    await expect(live(page)).toContainText('Updated “Bio lab” from Trello. 2 changes since your last import.');
    const list = page.getByTestId('change-list');
    await expect(list).toContainText('Riya Sharma moved “Write method” from To Do to Doing.');
    await expect(list).toContainText('Riya Sharma added “Abstract” to To Do.');
    // Still one board, not a copy.
    await page.locator('#board-switcher').click();
    const yours = page.getByRole('dialog', { name: 'Boards & files' }).getByRole('region', { name: 'Your boards' }).getByRole('listitem');
    await expect(yours.filter({ hasText: 'Bio lab' })).toHaveCount(1);
  });
});

test('Labs extras stay out of the way until switched on in Settings', async ({ page }) => {
  await page.locator('#board-switcher').click();
  const files = page.getByRole('dialog', { name: 'Boards & files' });
  await expect(files.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('CSV import and export').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('#board-switcher').click();
  await expect(files.getByRole('button', { name: 'Download CSV' })).toBeVisible();
});

test('connects to Trello directly, follows a board, and says what changed there when Handrail opens again', async ({ page }) => {
  const key = 'k'.repeat(32);
  const token = 't'.repeat(64);
  const lists = [{ id: 'L1', name: 'To Do', pos: 1 }, { id: 'L2', name: 'Doing', pos: 2 }];
  const riya = { fullName: 'Riya Sharma' };
  let trelloBoard: object = { id: 'B1aaaaaaaa', name: 'Bio lab', lists, cards: [{ id: 'c1', name: 'Write method', idList: 'L1', pos: 1 }], actions: [] };
  // Trello's sign-in page sends you straight back with a token, as it does after you click Allow.
  await page.route('https://trello.com/1/authorize**', (route) => {
    const back = new URL(route.request().url()).searchParams.get('return_url')!;
    return route.fulfill({ status: 302, headers: { location: `${back}#token=${token}` } });
  });
  await page.route('https://api.trello.com/1/members/me/boards**', (route) => route.fulfill({ json: [{ id: 'B1aaaaaaaa', name: 'Bio lab' }] }));
  await page.route(/https:\/\/api\.trello\.com\/1\/members\/me\?/, (route) => route.fulfill({ json: { fullName: 'Priya Sharma', username: 'priyas' } }));
  await page.route('https://api.trello.com/1/boards/B1aaaaaaaa**', (route) => route.fulfill({ json: trelloBoard }));

  await page.locator('#board-switcher').click();
  const files = page.getByRole('dialog', { name: 'Boards & files' });
  // Builds with a Trello key built in (VITE_TRELLO_KEY) don't ask for one.
  const keyField = files.getByLabel('Trello API key');
  if (await keyField.count()) await keyField.fill(key);
  await files.getByRole('button', { name: 'Connect Trello' }).click();
  await expect(live(page)).toContainText('Connected to Trello as Priya Sharma, read-only');
  await expect(files.getByLabel('Follow a board')).toHaveValue('B1aaaaaaaa');
  await files.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(live(page)).toContainText('Imported “Bio lab” from Trello');

  // Later, in Trello, Riya moves the card. Opening Handrail again is enough.
  trelloBoard = {
    ...trelloBoard,
    cards: [{ id: 'c1', name: 'Write method', idList: 'L2', pos: 1 }],
    actions: [{ type: 'updateCard', date: '2026-10-22T09:00:00.000Z', memberCreator: riya, data: { card: { id: 'c1' }, old: { idList: 'L1' } } }],
  };
  await page.reload();
  await expect(live(page)).toContainText('Checked Trello: 1 change on “Bio lab” since you last looked.');
  await expect(page.getByTestId('change-list')).toContainText('Riya Sharma moved “Write method” from To Do to Doing.');
});

test.describe('keyboard only', () => {
  test('found with NVDA: Ctrl+Z works from the empty command box, and the card key hint is read once', async ({ page }) => {
    await run(page, 'outline is done');
    await expect(live(page)).toContainText('Moved “Draft the outline” to Done');
    await expect(page.locator('#command-input')).toBeFocused();
    await expect(page.locator('#command-input')).toHaveValue('');
    await page.keyboard.press('Control+z');
    await expect(live(page)).toContainText('Undid');
    await expect(column(page, 'Doing')).toContainText('Draft the outline');

    const first = page.locator('[data-card]').first();
    await first.focus();
    await expect(first).toHaveAccessibleDescription(/Space to pick up and move/);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-card]').nth(1)).toBeFocused();
    await expect(page.locator('[data-card]').nth(1)).toHaveAccessibleDescription('');
    // Also after a move, where the card is a new element that never lost focus.
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-card]:focus')).toHaveAccessibleDescription('');
    await page.keyboard.press('Escape');
  });

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

  test('a shortcut strip shows sighted keyboard users what keys do', async ({ page }) => {
    const strip = page.getByTestId('shortcut-strip');
    await expect(strip).toBeHidden();
    await page.locator('[data-card]').first().focus();
    await expect(strip).toHaveText(/Enter actions.*Space move.*1–9 send to column.*E edit.*I details.*\? help/);
    await expect(strip).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Space');
    await expect(strip).toHaveText(/Arrows move.*Enter drop.*Esc cancel/);
    await page.keyboard.press('Escape');
    await expect(strip).toHaveText(/Enter actions/);
    await page.locator('#command-input').focus();
    await expect(strip).toBeHidden();
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

  test('Delete asks for a second press, removes the card, and Ctrl+Z brings it back', async ({ page }) => {
    await cardIn(page, 'Done', 'Set up the group chat').focus();
    await page.keyboard.press('Delete');
    await expect(live(page)).toContainText('Press Delete again to delete “Set up the group chat”');
    await expect(cardIn(page, 'Done', 'Set up the group chat')).toBeVisible();
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

  test('previews what a command will do before it runs', async ({ page }) => {
    const input = page.locator('#command-input');
    const preview = page.getByTestId('command-preview');
    await expect(preview).toBeHidden();
    await expect(input).toHaveAttribute('aria-describedby', /command-preview/);
    await input.pressSequentially('move find sources to doing');
    await expect(preview).toHaveText('→ Move “Find five sources on heat waves” to Doing');
    await expect(input).toHaveAccessibleDescription(/Move “Find five sources on heat waves” to Doing/);
    // The preview is not announced while typing.
    await expect(live(page)).not.toContainText('Move “Find five sources');
    await input.fill('blorp');
    await expect(preview).toHaveText(/^\s*I don’t understand that yet$/);
    await expect(preview.locator('.status-icon.is-fail svg')).toBeVisible();
    await expect(preview).toHaveClass(/is-fail/);
    await input.fill('');
    await expect(preview).toBeHidden();
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
    const riyaCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const riya = await riyaCtx.newPage();
    await riya.goto(link);
    await expect(riya.getByRole('heading', { level: 1 })).toHaveText('Climate talk: group project');
    await expect(riya.getByTestId('change-list')).toHaveCount(0);
    await expect(riya.getByTestId('changes')).toContainText('Nothing new');
    await riya.getByRole('button', { name: 'Settings' }).click();
    await riya.getByTestId('settings').getByLabel('Your name').fill('Riya');
    await riya.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(riya.getByTestId('settings')).toBeHidden();
    await run(riya, 'move design slides to done');
    await run(riya, 'assign email to priya');
    await riya.getByRole('button', { name: 'Share' }).click();
    const back = await riya.getByLabel(/Link to/).inputValue();
    await riyaCtx.close();

    // Priya opens Riya's link.
    await page.goto(back);
    const changes = page.getByTestId('changes');
    await expect(page.getByRole('heading', { name: 'Since you last looked' })).toBeFocused();
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

  test('links merge instead of overwriting, and clashes are explained', async ({ page, browser }) => {
    await page.getByRole('button', { name: 'Share' }).click();
    const link = await page.getByLabel(/Link to/).inputValue();
    await page.keyboard.press('Escape');

    // Riya edits her copy...
    const riyaCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const riya = await riyaCtx.newPage();
    await riya.goto(link);
    // A new device opened from a link starts with the shared board only, and asks for a name.
    await expect(riya.locator('[data-card]')).toHaveCount(7);
    await riya.locator('#name-prompt-input').fill('Riya');
    await riya.getByRole('button', { name: 'Save' }).click();
    await expect(riya.getByRole('heading', { name: 'What’s your name?' })).toHaveCount(0);
    await run(riya, 'move design slides to done');
    await run(riya, 'email due tomorrow');
    await riya.getByRole('button', { name: 'Share' }).click();
    const back = await riya.getByLabel(/Link to/).inputValue();
    await riyaCtx.close();

    // ...while Priya, who hasn't seen that yet, edits hers.
    await run(page, 'add check the citations');
    await run(page, 'email due next monday');

    await page.goto(back);
    await expect(cardIn(page, 'To do', 'check the citations')).toBeVisible();
    await expect(cardIn(page, 'Done', 'Design slides')).toBeVisible();
    const items = page.getByTestId('change-list').getByRole('listitem');
    // Priya's edit came later in real time, so hers is kept on every device.
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('You and Riya both changed the due date of “Email Dr. Mehta about the extension” at the same time. Handrail kept yours.');
    await expect(items.filter({ hasText: 'Riya moved “Design slides 4 to 8” from To do to Done.' })).toHaveCount(1);
  });

  test('the built-in demo simulates teammates’ overnight changes', async ({ page }) => {
    await page.locator('#board-switcher').click();
    await page.getByRole('button', { name: 'Simulate teammates’ changes' }).click();
    await expect(page.getByTestId('changes').locator('.news-count')).toHaveText(/^4\s*changes · 1 for you$/);
  });

  test('hostile links are refused and the page keeps working', async ({ page }) => {
    // (Decompression bombs are covered by tests/unit/lz.test.ts.)
    const evil = encodeURIComponent('{"kind":"handrail-doc","v":2,"id":"constructor"}');
    for (const hash of [`#board=v2.${evil}`, '#board=v2.' + 'A'.repeat(400_000)]) {
      await page.goto(`/${hash}`);
      await expect(live(page)).toContainText('That share link is broken or incomplete');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
      expect(await page.evaluate(() => window.location.hash)).toBe('');
    }
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

  test('a written digest sums up the changes by person, and is what gets read aloud', async ({ page }) => {
    await simulate(page);
    const digest = page.getByTestId('digest');
    await expect(digest).toHaveText(
      'Riya gave you “Email Dr. Mehta about the extension”, moved “Design slides 4 to 8” to Done and added “Rehearse together on call” to To do. Arjun moved “Write the presentation script” to Doing.',
    );
    await page.getByRole('button', { name: 'Read aloud' }).click();
    await expect(live(page)).toHaveText(/^4 changes since you last looked\. Riya gave you/);
    await page.getByRole('button', { name: 'Just mine' }).click();
    await expect(digest).toHaveText('Riya gave you “Email Dr. Mehta about the extension”.');
    await run(page, 'what changed');
    await expect(reply(page)).toContainText('1 change since you last looked. Riya gave you');
  });

  test('Before / now flips the board to how it looked before the changes, read-only', async ({ page }) => {
    await simulate(page);
    const toggle = page.getByRole('button', { name: 'Before / now' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(live(page)).toContainText('Showing the board as you last saw it, before 4 changes');
    await expect(cardIn(page, 'To do', 'Design slides')).toBeVisible();
    await expect(page.locator('[data-card]', { hasText: 'Rehearse together' })).toHaveCount(0);
    // Reading works, changing doesn't.
    await cardIn(page, 'To do', 'Design slides').focus();
    await page.keyboard.press('3');
    await expect(live(page)).toContainText('This is how the board looked before');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(cardIn(page, 'To do', 'Design slides')).toBeVisible();
    await page.getByRole('button', { name: 'Show now' }).click();
    await expect(cardIn(page, 'Done', 'Design slides')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('the arrival summary is short, “more” reads the rest, and “repeat” says it again', async ({ page }) => {
    await simulate(page);
    await expect(live(page)).toContainText('4 changes since you last looked, 1 for you. Riya gave you');
    await expect(live(page)).toContainText('Say or type “more” for the rest of the changes.');
    await expect(live(page)).not.toContainText('Arjun moved');
    // The summary ends with one clear next step, also shown in the panel.
    await expect(live(page)).toContainText('Your next step: “Draft the outline”. It’s overdue by 1 day.');
    await expect(page.getByTestId('next-step')).toContainText('Your next step: “Draft the outline”');
    await run(page, 'more');
    await expect(live(page)).toHaveText('Arjun moved “Write the presentation script” to Doing.');
    await run(page, 'repeat');
    await expect(live(page)).toHaveText('Arjun moved “Write the presentation script” to Doing.');
    await run(page, 'what next');
    await expect(live(page)).toHaveText('Your next step: “Draft the outline”. It’s overdue by 1 day.');
    await expect(cardIn(page, 'Doing', 'Draft the outline')).toBeFocused();
    // With unread changes, the first thing to Tab to is a link straight to them.
    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to what changed (4 new)' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Since you last looked' })).toBeFocused();
  });

  test('unread changes are announced when you come back later', async ({ page }) => {
    await simulate(page);
    await page.reload();
    await expect(live(page)).toContainText('4 changes are waiting since you last looked');
    await expect(page).toHaveTitle(/^\(4\) Climate talk/);
    // The summary keeps its details after a reload.
    await expect(page.getByTestId('digest')).toContainText('Riya gave you “Email Dr. Mehta about the extension”');
  });

  test('cards teammates changed are marked on the board until you press Got it', async ({ page }) => {
    await simulate(page);
    const email = cardIn(page, 'To do', 'Email Dr. Mehta');
    await expect(email).toHaveClass(/has-change/);
    await expect(email.locator('.change-flag')).toHaveText('Riya · reassigned');
    await expect(email).toHaveAccessibleName(/Changed since you last looked: Riya · reassigned\.$/);
    await expect(cardIn(page, 'Doing', 'Write the presentation script').locator('.change-flag')).toHaveText('Arjun · moved');
    await expect(cardIn(page, 'To do', 'Rehearse together').locator('.change-flag')).toHaveText('Riya · new');
    await expect(cardIn(page, 'Doing', 'Draft the outline')).not.toHaveClass(/has-change/);
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('.change-flag')).toHaveCount(0);
  });

  test('overdue cards get a coloured edge as well as the warning sign and text', async ({ page }) => {
    const outline = cardIn(page, 'Doing', 'Draft the outline');
    await expect(outline).toHaveClass(/is-overdue/);
    await expect(outline.locator('.due-overdue')).toHaveText(/Overdue 1d/);
    await expect(outline.locator('.due-overdue svg')).toBeVisible();
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
    await expect(items.nth(1)).toHaveClass(/msg-ok/);
    await expect(items.nth(1).locator('.status-icon.is-ok svg')).toBeVisible();
    await expect(items.nth(3)).toHaveClass(/msg-fail/);
    await expect(items.nth(3).locator('.status-icon.is-fail svg')).toBeVisible();
    await expect(items.nth(3)).toContainText(/Handrail: Didn’t work: I couldn.t find a card called “pizza”\./);
  });
});

test.describe('live session (real network)', () => {
  // Uses public Nostr relays to connect two browsers, so it needs the internet. Skipped in CI to keep deploys reliable.
  test.skip(!!process.env.CI, 'needs the public relays');
  test.setTimeout(90_000);

  test('teammates see and hear each other’s changes as they happen', async ({ page, browser }) => {
    // Live sessions are a Labs extra, off by default.
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('button', { name: 'Start a live session' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/Live sessions \(experimental\)/).check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Start a live session' }).click();
    const invite = await page.getByLabel('Invite link').inputValue();
    expect(invite).toMatch(/#board=v2\..+&live=[a-z0-9]{12,}$/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('live-bar')).toContainText('Waiting for teammates');

    const riyaCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const riya = await riyaCtx.newPage();
    await riya.goto(invite);
    await riya.locator('#name-prompt-input').fill('Riya');
    await riya.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByTestId('live-bar')).toContainText('Live with Riya', { timeout: 60_000 });
    await expect(riya.getByTestId('live-bar')).toContainText('Live with Priya', { timeout: 30_000 });

    await run(riya, 'move design slides to done');
    await expect(cardIn(page, 'Done', 'Design slides')).toBeVisible({ timeout: 20_000 });
    await expect(live(page)).toContainText('Riya moved “Design slides 4 to 8” to Done.');
    await expect(cardIn(page, 'Done', 'Design slides').locator('.change-flag')).toHaveText('Riya · moved');

    await run(page, 'email is done');
    await expect(cardIn(riya, 'Done', 'Email Dr. Mehta')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('live-bar').getByRole('button', { name: 'Leave live session' }).click();
    await expect(riya.getByTestId('live-bar')).toContainText('Waiting for teammates', { timeout: 30_000 });
    await riyaCtx.close();
  });
});

test('mouse users can still drag and drop', async ({ page }) => {
  await cardIn(page, 'To do', 'Design slides').dragTo(column(page, 'Done').locator('ol'));
  await expect(cardIn(page, 'Done', 'Design slides')).toBeVisible();
});

test.describe('phones and large text', () => {
  test('closing Activity on a phone puts focus back on the Activity button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    const button = page.getByRole('button', { name: /^Activity/ });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });

  test('a focused card is never hidden behind the phone dock (WCAG 2.4.11)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await simulate(page);
    await page.keyboard.press('Escape');
    await page.locator('[data-card]').first().focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    const focused = page.locator('[data-card]:focus');
    const box = (await focused.boundingBox())!;
    const dockTop = (await page.locator('.dock').boundingBox())!.y;
    expect(box.y + box.height).toBeLessThanOrEqual(dockTop);
  });

  test('focus inside the scrolling board and Activity list is always scrolled into view', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await simulate(page);
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Show changes' }).click();
    const wrap = page.locator('.board-wrap');
    const visible = async (loc: ReturnType<Page['locator']>, scroller: ReturnType<Page['locator']>) => {
      const a = (await loc.boundingBox())!;
      const b = (await scroller.boundingBox())!;
      return a.x >= b.x - 1 && a.x + a.width <= b.x + b.width + 1 && a.y >= b.y - 1 && a.y + a.height <= b.y + b.height + 1;
    };
    // Board scrolled right, then focus moves to a card on the left.
    await page.locator('[data-card]').first().focus();
    await wrap.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.keyboard.press('ArrowDown');
    expect(await visible(page.locator('[data-card]:focus'), wrap)).toBe(true);
    // Tabbing through the Activity list keeps each control on screen.
    const scroller = page.locator('.activity-scroll');
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await page.getByTestId('change-list').getByRole('button').last().focus();
    expect(await visible(page.locator(':focus'), scroller)).toBe(true);
  });

  for (const width of [320, 768, 1280]) {
    test(`200% text at ${width}px: no sideways scrolling, command box usable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByLabel('Text size').selectOption('200');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Large text gets the roomy phone layout, with the command box docked full width.
      await expect(page.locator('.dock')).toBeVisible();
      const input = (await page.locator('#command-input').boundingBox())!;
      expect(input.width).toBeGreaterThan(Math.min(width - 160, 240));
    });
  }
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
    // Check the settled page: wait for one-off animations (fades, pops) to finish. Looping ones are decorative.
    await page.waitForFunction(() =>
      !document.querySelector('.cursor-layer') &&
      document.getAnimations().every((an) => an.playState !== 'running' || an.effect?.getTiming().iterations === Infinity),
    );
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

test.describe('the story (first visit)', () => {
  test('a new visit opens on the story; “Open the board” is the first thing to Tab to', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Never hunt for what changed\./);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open the board' }).first()).toBeFocused();
    await page.keyboard.press('Enter');
    // A first visit lands on the main feature: teammates' changes already waiting and announced.
    await expect(page.getByRole('heading', { name: 'Since you last looked' })).toBeFocused();
    await expect(page.getByTestId('live-region')).toContainText('4 changes since you last looked, 1 for you');
    await expect(page.getByTestId('change-list').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByRole('complementary', { name: 'New here' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'New here' }).getByRole('button', { name: '1-minute story' })).toHaveCount(0);
    // Reloading while you work goes straight to the board, and the changes are still waiting.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
    await expect(page.getByRole('complementary', { name: 'New here' })).toHaveCount(0);
    await expect(page.getByTestId('change-list').getByRole('listitem')).toHaveCount(4);
    // ?story always shows it, and leaving it tidies the address.
    await page.goto('/?story');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Never hunt for what changed\./);
    await page.getByRole('button', { name: 'Open the board' }).first().click();
    await expect(page).not.toHaveURL(/story/);
    await ctx.close();
  });

  test('?board skips the story and still opens with the changes waiting', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('/?board');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
    await expect(page.getByTestId('changes')).toContainText('4');
    await expect(page.getByRole('heading', { name: 'Since you last looked' })).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'New here' }).getByRole('button', { name: 'Try it with your eyes closed' })).toBeVisible();
    await ctx.close();
  });

  test('share links never show the story', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/?board');
    await page.getByRole('button', { name: 'Share' }).click();
    const link = await page.getByLabel(/Link to/).inputValue();
    const fresh = await (await browser.newContext()).newPage();
    await fresh.goto(link);
    await expect(fresh.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
    await ctx.close();
  });

  test('the ruler jumps between sections and Pause stops the looping animation', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('/?story');
    const nav = page.getByRole('navigation', { name: 'Story sections' });
    await nav.getByRole('button', { name: 'Merge' }).click();
    await expect(nav.getByRole('button', { name: 'Merge' })).toHaveAttribute('aria-current', 'step', { timeout: 15000 });
    const pause = page.getByRole('button', { name: 'Pause animation' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    // The floating board stops moving.
    const pose = () => page.locator('.iso-float').evaluate((el) => getComputedStyle(el).transform);
    const a = await pose();
    await page.waitForTimeout(700);
    expect(await pose()).toBe(a);
    await pause.click();
    await page.waitForTimeout(700);
    expect(await pose()).not.toBe(a);
    await ctx.close();
  });

  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`story passes the accessibility audit (motion: ${motion})`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: motion });
      const page = await ctx.newPage();
      await page.goto('/?story');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(motion === 'reduce' ? 200 : 2500);
      if (motion === 'reduce') {
        // No running animations at all, and no smooth-scroll library.
        expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
      }
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      // Every focusable thing is visible when focused.
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        const ok = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return true;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden' && Number(s.opacity) > 0.5;
        });
        expect(ok).toBe(true);
      }
      await ctx.close();
    });
  }
});

test('works offline once opened, and says so', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Let the service worker take control and cache the built files.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
  await context.setOffline(true);
  await expect(page.locator('.status-pill')).toHaveText(/Offline · everything still works/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Climate talk/);
  await run(page, 'outline is done');
  await expect(cardIn(page, 'Done', 'Draft the outline')).toBeVisible();
  await context.setOffline(false);
});
