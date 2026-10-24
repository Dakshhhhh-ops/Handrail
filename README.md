# Handrail

**A project board that tells you what changed, so you never have to hunt for it, with or without sight.**

**Try it:** https://dakshhhhh-ops.github.io/Handrail/. It needs no account. A 1-minute scroll story opens first (once per visit), then a sample group project where teammates' changes are already waiting, so you land on the main feature. To skip the story, use [?board](https://dakshhhhh-ops.github.io/Handrail/?board).

- **Try it with your eyes closed:** https://dakshhhhh-ops.github.io/Handrail/?blindfold. The screen goes dark and Handrail talks you through finding what changed and moving a card, by keyboard only. It takes about a minute and is timed.
- **See the main feature:** on your first visit the changes are already listed under *Since you last looked*. Try **Show me on the board** and **Before / now**. To run it again, click the board name and choose *Simulate teammates' changes*.

![The board with an Activity panel listing four changes since you last looked, one marked "for you", and the changed cards tagged on the board](docs/changes.png)

## One problem, one loop

Handrail does one job: **telling you what your teammates changed, when you can't scan the board.** Everything in the main app serves one loop:

1. **Changes arrive:** a teammate's link, or a newer Trello export.
2. **Handrail says what changed,** in plain sentences, with what involves you first.
3. **You act on it without dragging:** keys, a menu, or a typed or spoken sentence. Undo anything.

The supporting pieces exist only because the loop needs them. The CRDT merge lets two copies of a board be compared and combined. Keyboard moves make the board usable at all without a mouse. Trello import means nobody has to switch tools.

**Kept out of the main app on purpose.** Live sessions, CSV import and export, and 3D card tilt are in **Settings → Labs**, off by default. They work, but they aren't the point.

## The problem

In a group project, the hard part is often not doing your own task. It is **finding out what everyone else changed** since you last looked. On Trello, Notion or Jira you find out by scanning: you glance across the columns and notice that "Slides" moved to Done, or that a new card has your name on it. Activity feeds exist, but they are long lists of raw events, and written summaries are a paid AI add-on. Scanning is slow for everyone, and for a screen-reader user it means stepping through every card in every column to spot one difference.

Handrail does the scanning for you. When a teammate sends their link, it writes every change as a plain sentence, puts the ones that involve you first, and tags those cards on the board. It's free, private and screen-reader-first.

Moving cards without a mouse is not new (GitHub Projects and Jira support keyboard moves). Handrail includes it because the same people who can't scan a board often can't drag one either:

- **Blind and low-vision students**, who use screen readers or magnifiers.
- **Students with motor impairments** (tremor, RSI, one-handed use) who can't hold a mouse button steady while dragging.
- **Keyboard-only and voice-control users.**

WCAG 2.2 covers this in [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html): anything done by dragging must also be possible without dragging.

This isn't hypothetical. Trello has open NVDA bugs with "no known workaround", Jira's tracker says its board's drag-and-drop "is inaccessible to screen reader users", and research on blind people in shared tools recommends "accessible awareness" of what others changed. Sources: [docs/EVIDENCE.md](docs/EVIDENCE.md).

**Handrail's user:** Priya, a blind student working with NVDA on a group project. Her teammates Riya and Arjun use the board with a mouse.

### Nobody has to switch from Trello

Priya's group already lives in Trello, and they won't move for one person. They don't have to. Priya exports the Trello board as JSON and imports it. Next time she imports the newer export, Handrail compares it with the last one and tells her what changed **in Trello**, credited from Trello's own activity log: *"Riya Sharma moved 'Write method' from To Do to Doing."* Her teammates keep using Trello; Handrail is how Priya reads it.

Trello ids are kept, so a re-import updates the same board instead of making a copy. Trello's last export is stored as its own copy of the document, and a re-import is merged like a teammate's link. Only what changed in Trello is applied. Cards Priya added or moved in Handrail in between stay as she left them, unless Trello changed the same card, in which case Trello's newer change wins and she is told.

## What it does

| Instead of… | In Handrail you… |
|---|---|
| Scanning the board for changes | Open your teammate's link and see or hear **"Since you last looked: Riya assigned 'Email Dr. Mehta' to you. Arjun moved 'Write the script' to Doing…"**. Changes that involve you come first, and changed cards are tagged on the board ("Riya · moved") |
| Dragging a card | Type or say **"move find sources to doing"** (Handrail shows what it will do before you press Enter), press a **number key** (3 sends it to column 3), or **pick it up with Space** and move it with the arrow keys |
| Reading every card to find deadlines | Ask **"what's due this week"**, **"anything overdue"** or **"my tasks"**, or press **Just mine** to see only your cards and the changes that involve you |
| Fiddly date pickers | Type **"due next friday"**, **"in 3 days"** or **"oct 30"** |
| Sitting through a long readout | Hear the count and the first sentence; say **"more"** for the rest, or **"repeat"** to hear the last message again |
| Hoping you didn't break something | **Undo** any change with Ctrl+Z, the Undo button, or by saying "undo" |
| Spotting what moved by eye | **Before / now** flips the board to how it looked when you last saw it; flip back and every changed card glides to its new place. **Show me on the board** sends each teammate's name-tagged cursor to the cards they changed |

| Command box | Keyboard pick-up | Action menu instead of dragging |
|---|---|---|
| ![Command box replying "Moved to Doing"](docs/command.png) | ![A picked-up card with a dashed outline and key hints](docs/keyboard.png) | ![Card action menu with Move to, Order and Card buttons](docs/menu.png) |

| Paper theme | Phone |
|---|---|
| ![The board in the cream Paper theme with the night-blue Activity panel](docs/contrast.png) | ![Board on a phone, columns stacked, command box docked at the bottom](docs/phone.png) |

## Limitations

- **Not yet tested with blind or motor-impaired users.** We tested it ourselves with NVDA (we are sighted), which found five problems the automated audit missed; all are fixed. The design follows WCAG 2.2 and the WAI-ARIA Authoring Practices. That is still not the same as blind users saying it works. The next step is sessions with screen-reader users.
- **Getting changes in still takes a step.** A teammate has to send a newer link, or Priya re-imports a newer Trello export. Nobody sends a link after every edit, so in practice this is a catch-up after a few days, not a live feed. Live sessions (Labs) remove the step but need everyone online at once.
- **Screen reader modes.** The board is marked as an application, so screen readers should switch to focus mode when you land on a card, and arrows, Space and number keys reach Handrail. This follows the documented behaviour of NVDA and JAWS but hasn't been re-recorded with NVDA since the change. If a screen reader stays in browse mode, it keeps those keys for itself. Enter on a card (the action menu) and the command box work in either mode, and Help explains this.
- **Share links grow with the board.** The sample board's link is about 2,000 characters, around Discord's message limit. Long links work in email and most chat apps, and "Download backup" works for any size.
- **Live sessions need both people online at once**, and use public relays to connect. Some strict school or office networks block peer-to-peer connections; share links still work there. There is no always-on sync server, so a teammate who is offline catches up when they open a newer link.
- **Merging picks a winner per field.** If two people edit the same field at the same moment, one version is kept (the later one) and the other person is told; the text isn't combined.
- **Voice input** depends on the browser's speech recognition (Chrome and Edge, online). Typing commands works everywhere.
- **English only** for commands and dates.
- **Trello updates are manual.** Priya exports and re-imports the board; there is no Trello API connection. Changes Trello's activity log doesn't cover are credited to "Someone in Trello", and changes made in Handrail don't flow back to Trello. Handrail has one assignee per card, so a Trello card with several members shows the first.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 129 unit and property-based tests
npm run test:e2e     # 60 browser tests, including the axe accessibility audit
npm run build        # static site in dist/
```

Every push to `main` runs type-checking and both test suites, then deploys to GitHub Pages ([workflow](.github/workflows/deploy.yml)).

## How it works

The details are in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md):

- [Built for many ways of working](docs/HOW-IT-WORKS.md#built-for-many-ways-of-working): screen readers, keyboard, voice, low vision and dyslexia, motion
- [How sharing works (no server)](docs/HOW-IT-WORKS.md#how-sharing-works-no-server): share links and the CRDT merge
- [Keyboard](docs/HOW-IT-WORKS.md#keyboard): every shortcut
- [How it's built](docs/HOW-IT-WORKS.md#how-its-built): architecture, merging, undo, the digest, testing
- [Privacy](docs/HOW-IT-WORKS.md#privacy)

Evidence that the problem is real (Trello and Jira bug reports, research, survey numbers) is in [docs/EVIDENCE.md](docs/EVIDENCE.md).

## License

MIT
