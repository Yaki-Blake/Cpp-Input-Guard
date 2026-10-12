# Angle Bracket Shield

**English** ｜ [简体中文](README.zh-CN.md)

An Obsidian plugin that stops `<` from being auto-paired or parsed as an HTML tag, and repairs notes that were already broken by it.

## The problem

Markdown permits inline HTML, and a tag name does not have to be a real element. So in a note like this:

```markdown
- first item
- where greater<int> is a functor
* third item
```

`<int>` is read as an **unclosed HTML tag**. The renderer opens an element that is never closed, so every following sibling gets swallowed into it. In practice: list bullets disappear and turn into literal `*`, paragraphs are glued together, indentation jumps around, and both Live Preview and Reading view break. The source text is intact — only the rendering is corrupted.

The Obsidian forum and help documentation list three ways out: close the tag manually, wrap it in backticks, or **escape it with a backslash (`\<`)**. This plugin automates the third option: it intercepts new input as you type, and can repair existing notes in bulk.

This matters most if you take notes containing C++ templates or comparisons — `vector<int>`, `greater<int>`, `set<T, Compare>`, `priority_queue<long long>` — which look exactly like HTML tags to a Markdown renderer.

## Features

| Feature | Description |
| --- | --- |
| Intercept on input | Stops Obsidian's auto-pairing when you type `<`, and writes the character itself |
| Escape by default | Writes `\<`, which renders as a literal `<` and bypasses HTML parsing entirely |
| Code aware | Never touches fenced code blocks (``` / ~~~) or inline code, so `#include <iostream>` stays intact |
| Smart detection | Leaves `a < b`, `x <= y` and `<3` alone; only escapes what would really become a tag |
| Repair current note | Fixes the whole document in one action (undoable with `Ctrl/Cmd + Z`) |
| Repair current file | Uses the file API, so it also works in Reading view |
| Repair entire vault | Scans and repairs every Markdown file, with a confirmation dialog |
| Repair selection | Fixes only the selected text |
| Repair on open | Optional; scans and repairs a note when you open it (off by default) |

## Installation

### From the community directory

1. Open **Settings → Community plugins → Browse**.
2. Search for **Angle Bracket Shield**.
3. Select **Install**, then **Enable**.

### Manually

1. Download `main.js`, `manifest.json` and `versions.json` from the [latest release](../../releases/latest).
2. Create the folder `<your vault>/.obsidian/plugins/angle-bracket-shield/` and put the three files in it:

   ```
   <your vault>/.obsidian/plugins/angle-bracket-shield/
   ├── main.js
   ├── manifest.json
   └── versions.json
   ```

3. Open **Settings → Community plugins**, select **Refresh**, then enable **Angle Bracket Shield**. If the plugin does not appear, make sure Restricted mode is off.

Requires Obsidian 1.4.0 or later. Pure JavaScript — `main.js` is the finished artifact — with no build step and no third-party dependencies. Works on desktop and mobile.

## Usage

### Typing protection

Nothing to configure. Once the plugin is enabled, type `<` in a note and the editor writes `\<` instead: the automatic `<>` pairing no longer happens, and the rendered result is still a plain `<`.

Inside a fenced code block or inline code the plugin stays out of the way, so C++ headers such as `#include <iostream>` are written unchanged.

### Repairing existing notes

Typing protection only covers new input — it cannot change characters already saved in a file. After installing, run a repair once over your older notes:

1. Open the command palette with `Ctrl/Cmd + P`.
2. Search for **repair** and choose one of:
   - **Repair current note** — try this one first.
   - **Repair current file (works in Reading view)** — same result, but available in any view mode.
   - **Repair entire vault** — asks for confirmation and reports how many files will be scanned.
   - **Escape `<` in selection** — only the selected text.

Repair is idempotent: an already-escaped `\<` never gains a second backslash, code blocks and inline code are left alone, and comparisons such as `a < b` are not touched. Undo with `Ctrl/Cmd + Z`. The vault-wide command writes many files at once, so undo those in each file, or restore from the `.bak-<timestamp>` backup that is created before every write.

## Commands

| Command | Description |
| --- | --- |
| Toggle: angle bracket protection | Turns input interception on or off |
| Repair current note: escape `<` that would be treated as HTML | Repairs the note you are editing |
| Repair current file (works in Reading view) | Repairs the active file through the file API |
| Repair entire vault: escape every `<` that would be treated as HTML | Bulk repair across the vault |
| Escape `<` in selection | Repairs only the selected text |

## Settings

**Input protection**

| Setting | Default | Description |
| --- | --- | --- |
| Enable input interception | On | Master switch for interception while typing |
| Escape on input (write `\<`) | On | When off, a bare `<` is written — interception degrades to "block auto-pairing only" |
| Skip fenced code blocks | On | Prevents `#include <iostream>` from becoming `#include \<iostream>` |
| Skip inline code | On | Leaves `` `...` `` spans untouched |

**Repairing existing notes**

| Setting | Default | Description |
| --- | --- | --- |
| Repair automatically when a note is opened | Off | Scans and repairs on open; writes to the file, so it is off by default |

**Other**

| Setting | Default | Description |
| --- | --- | --- |
| Show a notice on toggle | On | Whether to show a notification after a command runs |
| Show a notice on load | On | Confirms the plugin loaded; useful for telling whether the plugin is active |

## How it works

**Input interception.** The handler is attached to `document` in the **capture phase**, so it sees the keystroke before CodeMirror 6, which binds its handler on the editor element itself.

```
key <
   │
   ├─ not inside the editor body? ──────────► pass through (Obsidian default)
   │
   ├─ inside a code block / inline code? ───► pass through (keep code verbatim)
   │
   └─ intercepted
        ├─ preventDefault()      stops the browser inserting the character
        ├─ stopPropagation()     CodeMirror never sees it → no auto-pairing
        └─ editor.replaceSelection('\\<')   the plugin writes the escaped form
```

**Document repair.** Lines are scanned one at a time, with a state machine tracking fenced code block delimiters. Non-code lines are split on backticks into ordinary and code segments, and only ordinary segments are escaped. A `<` is escaped when it is not followed by whitespace, a digit or an equals sign — so `a < b`, `x <= y` and `<3` stay clean, while `vector<int>`, `less<T>` and `<div>` are handled.

Fence detection follows CommonMark: the opening marker may not contain the fence character again, which matters for a line such as ```` ```text``` ```` appearing inside a paragraph.

## Known limitations

- Input interception only applies to **edit mode** (Source mode and Live Preview). Reading view shows rendered output, so pre-existing content must be fixed by repairing the source file.
- Escaping **modifies the note source** (one extra `\` per bracket; the rendered output is unchanged). If you must keep the raw text, wrap the fragment in backticks or close the tag instead.
- If you deliberately write raw HTML in notes (for example `<div style="...">`), turn the protection off first with the toggle command.
- Interception uses DOM events rather than a CodeMirror extension, so it is unaffected by Obsidian's internal upgrades — but a future change away from the `.cm-content` editor container would require updating the selector.
- The vault-wide repair writes to many files. Try it on a single note first.

## Changelog

- **1.2.2** — Added a tag-triggered release workflow that publishes signed build provenance attestations for `main.js` and `manifest.json`; README is now English-first with the Chinese version in `README.zh-CN.md`.
- **1.2.1** — Fixed the trailing punctuation of the manifest description to satisfy the community directory submission requirements, and synced `versions.json`; no functional change.
- **1.2.0** — Fixed fence misdetection: a single-line ```` ```text``` ```` was treated as the start of a code block, which caused the rest of the document to be skipped during repair (making repair appear to do nothing). Added the "repair current file (works in Reading view)" command and a load notice.
- **1.1.0** — Added document repair (current note / entire vault / selection) and the repair-on-open setting.
- **1.0.0** — Input interception, fenced code block and inline code awareness, selection escaping.

## License

MIT
