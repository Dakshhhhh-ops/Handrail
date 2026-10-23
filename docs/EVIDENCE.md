# Evidence: what screen-reader users report about today's tools

These are published sources about the problem Handrail works on. They describe existing tools (Trello, Jira, collaborative editors), not Handrail. Nobody quoted here has tested Handrail. For tests of Handrail itself, see [USER-TESTS.md](USER-TESTS.md).

## 1. Blind users need to know what others changed

Buzzi, Buzzi, Leporini, Mori and Penichet, *Collaborative Editing: Collaboration, Awareness and Accessibility Issues for the Blind*, OTM 2014 Workshops, Springer ([DOI 10.1007/978-3-662-45550-0_58](https://doi.org/10.1007/978-3-662-45550-0_58)).

- When working in shared tools, "Blind people in particular may experience great accessibility and usability issues."
- The authors propose five guidelines for collaborative editing, "including 'accessible awareness' for blind users".

**Handrail's response:** "Since you last looked" is accessible awareness for a project board. Every teammate's change is a plain sentence, and the ones that involve you come first.

## 2. Trello with NVDA: open bugs

Two Trello bugs, filed on 11 April 2024 and both still marked "Gathering Impact":

- [TRELLO-199](https://jira.atlassian.com/browse/TRELLO-199), *NVDA screen reader cursor doesn't work correctly when navigating on the card back*: "Blind users face difficulty while using the NVDA screen reader cursor to navigate between the card's back and make changes like members, labels, dates, etc." The workaround section says: "Currently, there is no known workaround for this behavior."
- [TRELLO-197](https://jira.atlassian.com/browse/TRELLO-197), *NVDA screen reader can't identity and read the text when creating a board*: "the screen reader can't identify any of the text from the popover, causing confusion to blind users who wouldn't know which field is selected."

A blind user on Atlassian's community forum ([thread](https://community.atlassian.com/forums/Trello-questions/Hey-all-I-am-a-blind-Trello-user-I-cannot-mark-my-tasks-as/qaq-p/1295906)): "Hey all! I am a blind Trello user. I cannot mark my tasks as completed."

**Handrail's response:** it works on top of Trello (import, then re-import to hear what changed), so a blind teammate doesn't depend on Trello's own screen-reader support, and the group doesn't have to switch.

## 3. Dragging cards locks screen-reader users out

[JRASERVER-77297](https://jira.atlassian.com/browse/JRASERVER-77297) (Jira, filed 7 February 2024, "Ready for Development"): "The drag-and-drop functionality of the 'Issues' in the Scrum board is inaccessible to screen reader users."

WCAG 2.2 makes this a requirement: [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) says anything done by dragging must also be possible without dragging.

**Handrail's response:** cards move with Space and the arrow keys, number keys, an action menu, or a sentence ("move find sources to done").

## 4. NVDA is the screen reader to test with

[WebAIM Screen Reader User Survey #10](https://webaim.org/projects/screenreadersurvey10/) (December 2023 to January 2024, 1,539 responses; WebAIM notes the sample "was not controlled and may not represent all screen reader users"):

- "NVDA is again the most commonly used screen reader at 65.6% of respondents."
- In Asia, NVDA is the primary screen reader for 70.8% of respondents, against 22.9% for JAWS.
- Among the most problematic items respondents listed: interactive elements that don't behave as expected (#2), and unexpected screen changes (#4).

**Handrail's response:** we recorded and fixed Handrail with NVDA. Changes made while you were away are never silent: they are announced and listed.
