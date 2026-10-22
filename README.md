# Handrail

**A project board that tells you what changed, so you never have to hunt for it, with or without sight.**

**Try it:** https://dakshhhhh-ops.github.io/Handrail/ (no account; it opens with a sample group project. Click the board name and choose *Simulate teammates' changes* to see the main feature.)

![The board with an Activity panel listing four changes since you last looked, one marked "for you", and the changed cards tagged on the board](docs/changes.png)

## The problem

In a group project, the hard part is often not doing your own task. It is **finding out what everyone else changed** since you last looked. On Trello, Notion or Jira you find out by scanning: you glance across the columns and notice that "Slides" moved to Done, or that a new card has your name on it. Activity feeds exist, but they are long lists of raw events, and written summaries are a paid AI add-on. Scanning is slow for everyone, and for a screen-reader user it means stepping through every card in every column to spot one difference.

Handrail does the scanning for you. When a teammate sends their link, it writes every change as a plain sentence, puts the ones that involve you first, and tags those cards on the board. It's free, private and screen-reader-first.

Moving cards without a mouse is not new (GitHub Projects and Jira support keyboard moves). Handrail includes it because the same people who can't scan a board often can't drag one either:

- **Blind and low-vision students**, who use screen readers or magnifiers.
- **Students with motor impairments** (tremor, RSI, one-handed use) who can't hold a mouse button steady while dragging.
- **Keyboard-only and voice-control users.**

WCAG 2.2 covers this in [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html): anything done by dragging must also be possible without dragging.

**Handrail's user:** Priya, a blind student working with NVDA on a group project. Her teammates Riya and Arjun use the board with a mouse.

## What it does

| Instead of… | In Handrail you… |
|---|---|
| Scanning the board for changes | Open your teammate's link and see or hear **"Since you last looked: Riya assigned 'Email Dr. Mehta' to you. Arjun moved 'Write the script' to Doing…"**. Changes that involve you come first, and changed cards are tagged on the board ("Riya · moved") |
| Dragging a card | Type or say **"move find sources to doing"** (Handrail shows what it will do before you press Enter), press a **number key** (3 sends it to column 3), or **pick it up with Space** and move it with the arrow keys |
| Reading every card to find deadlines | Ask **"what's due this week"**, **"anything overdue"** or **"my tasks"**, or press **Just mine** to see only your cards and the changes that involve you |
| Fiddly date pickers | Type **"due next friday"**, **"in 3 days"** or **"oct 30"** |
| Hoping you didn't break something | **Undo** any change with Ctrl+Z, the Undo button, or by saying "undo" |

### Built for many ways of working

- **Screen readers:** every card has a full spoken name ("Draft the outline, overdue by 1 day, assigned to you, has notes. 1 of 1 in Doing"). Every action is confirmed through a live region. Dialogs are native `<dialog>` elements, so focus is trapped and returned properly.
- **Keyboard:** one tab stop for the whole board, arrow-key navigation between cards, single-key shortcuts, and skip links. See the keyboard table under Help.
- **Voice:** a Speak button, in browsers with speech recognition (Chrome, Edge). Card-name matching tolerates recognition slips: "lab raport" still finds "Lab report".
- **Low vision and dyslexia:** high-contrast theme, text up to 200%, Atkinson Hyperlegible or OpenDyslexic fonts, relaxed spacing, a stacked layout for screen magnifiers, and replies read aloud for people who don't use a screen reader.
- **Mouse users:** normal drag-and-drop still works, so mixed groups can share one board.
- **Groups already on Trello:** import a Trello JSON export or a CSV. Export as a backup, CSV or plain text.

| Command box | Keyboard pick-up | Action menu instead of dragging |
|---|---|---|
| ![Command box replying "Moved to Doing"](docs/command.png) | ![A picked-up card with a dashed outline and key hints](docs/keyboard.png) | ![Card action menu with Move to, Order and Card buttons](docs/menu.png) |

| High contrast, 125% text | Phone, dark mode |
|---|---|
| ![Board in the high-contrast theme with larger text](docs/contrast.png) | ![Board on a phone in dark mode, columns stacked](docs/phone.png) |

## How sharing works (no server)

Handrail has no backend and no accounts. **Share** packs the whole board into a compressed link (`#board=…`). The part after `#` is never sent to a web server.

1. Priya shares the link in the group chat.
2. Riya opens it, makes changes, and shares her link back.
3. Priya opens Riya's link. Handrail compares it with the version Priya last saw and turns every difference into a sentence, naming who made it. It moves focus to that list and announces how many changes there are.

To see it without two devices, click the board name to open the board menu, then choose **Simulate teammates' changes**.

## Keyboard

| Key (on a card) | Action |
|---|---|
| Arrow keys | Move between cards |
| Enter | Action menu (move to a column, reorder, edit, delete) |
| Space | Pick up. Then arrows move it, Enter drops it, Escape cancels |
| 1–9 | Send to that column |
| Alt + arrows | Move one step without picking up |
| E / I / N / Delete | Edit / read details / new card here / delete |
| `/` · `?` · Ctrl+Z · Ctrl+Y | Command box · help · undo · redo |

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 68 unit tests (parser, previews, dates, change detection, imports)
npm run test:e2e     # 31 browser tests incl. axe accessibility audit
npm run build        # static site in dist/
```

Every push to `main` runs type-checking, both test suites, and then deploys to GitHub Pages ([workflow](.github/workflows/deploy.yml)).

## How it's built

- **React 18 + TypeScript + Vite**, a static site with no backend.
- `src/model/` is plain TypeScript with no UI code, so it is unit-tested:
  - `commands.ts` reads plain-language commands with no AI service. It's offline, instant, private and predictable. It handles card titles that themselves contain "to" or "for" by only treating a trailing clause as a column or person when one with that name exists.
  - `match.ts` matches card and column names with fuzzy scoring and edit distance. Columns also match by synonym ("finished" means Done) or number. When two cards match equally well, it asks which one instead of guessing.
  - `dates.ts` handles everyday dates ("next friday", "the 30th", "in two weeks").
  - `diff.ts` compares two versions of a board and describes each change as a sentence, with changes that involve you first.
  - `validate.ts` treats every shared link, imported file and saved board as untrusted: it limits sizes, fixes ids and drops broken cards.
- **Testing:** Vitest (68 tests) and Playwright (31 tests), including a two-person handoff test that uses two separate browser contexts. **axe-core** checks WCAG 2.2 AA in light, dark and high-contrast themes, every dialog, and phone width, with zero violations.

## Limitations

- **Not yet tested with blind or motor-impaired users.** The design follows WCAG 2.2, the WAI-ARIA Authoring Practices and published guidance on accessible drag-and-drop, and the automated audit passes. That is not the same as real users saying it works. The next step is sessions with screen-reader users.
- **Screen readers in browse mode** pass single-letter keys to the screen reader instead of the page. Enter on a card (action menu) and the command box always work. Help explains this.
- **Sharing is by link, not live sync.** If two people edit at the same time, opening one person's link replaces your copy (you can undo). A small sync server is the obvious next step.
- **Voice input** depends on the browser's speech recognition (Chrome and Edge, online). Typing commands works everywhere.
- **English only** for commands and dates.

## Privacy

Boards are saved in your browser's local storage on your device. Nothing is sent anywhere unless you share a link yourself. There is no analytics.

## License

MIT
