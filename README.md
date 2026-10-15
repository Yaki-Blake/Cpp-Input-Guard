# C++ Input Protection

**English** ｜ [简体中文](README.zh-CN.md)

An Obsidian plugin that stops `<` and `[` from being auto-paired, parsed as HTML tags, or parsed as Markdown links — and repairs notes that were already broken by them.

## The problem

Markdown permits inline HTML, and a tag name does not have to be a real element. So in a note like this:

```markdown
- first item
- where greater<int> is a functor
* third item
```

`<int>` is read as an **unclosed HTML tag**. The renderer opens an element that is never closed, so every following sibling gets swallowed into it. In practice: list bullets disappear and turn into literal `*`, paragraphs are glued together, indentation jumps around, and both Live Preview and Reading view break. The source text is intact — only the rendering is corrupted.

Square brackets cause a different but related failure. `arr[5]`, `a[0]` or a stray `[note]` is read as the start of a **link, reference or footnote**. The brackets then either vanish from the output, or turn into a link pointing nowhere.

The Obsidian forum and help documentation list three ways out for the angle bracket case: close the tag manually, wrap it in backticks, or **escape it with a backslash (`\<`)**. This plugin automates the third option for both bracket types: it intercepts new input as you type, and can repair existing notes in bulk.

This matters most if you take notes containing C++ templates, subscripts or comparisons — `vector<int>`, `greater<int>`, `set<T, Compare>`, `arr[5]`, `a[i][j]` — which look exactly like HTML tags or link syntax to a Markdown renderer.

## Features

| Feature | Description |
| --- | --- |
| Intercept on input | Stops Obsidian's auto-pairing when you type `<` or `[`, and writes the character itself |
| Escape by default | Writes `\<` and `\[`, which render as literal brackets and bypass HTML/link parsing entirely |
| Code aware | Never touches fenced code blocks (``` / ~~~) or inline code, so `#include <iostream>` and `arr[0]` stay intact |
| Smart detection (angle) | Leaves `a < b`, `x <= y` and `<3` alone; only escapes what would really become a tag |
| Link awareness (square) | Keeps `[text](url)`, `[[wikilink]]`, `[text][ref]` and `[^footnote]` untouched; escapes subscripts such as `arr[5]`, `a[i][j]` and bare `[note]` |
| Repair current note | Fixes the whole document in one action (undoable with `Ctrl/Cmd + Z`) |
| Repair current file | Uses the file API, so it also works in Reading view |
| Repair entire vault | Scans and repairs every Markdown file, with a confirmation dialog |
| Repair selection | Fixes only the selected text |
| Repair on open | Optional; scans and repairs a note when you open it (off by default) |

## Installation

### From the community directory

1. Open **Settings → Community plugins → Browse**.
2. Search for **C++ Input Protection**.
3. Select **Install**, then **Enable**.

### Manually

1. Download `main.js`, `manifest.json` and `versions.json` from the [latest release](../../releases/latest).
2. Create the folder `<your vault>/.obsidian/plugins/cpp-input-protection/` and put the three files in it:

   ```
   <your vault>/.obsidian/plugins/cpp-input-protection/
   ├── main.js
   ├── manifest.json
   └── versions.json
   ```

3. Open **Settings → Community plugins**, select **Refresh**, then enable **C++ Input Protection**. If the plugin does not appear, make sure Restricted mode is off.

Requires Obsidian 1.4.0 or later. Pure JavaScript — `main.js` is the finished artifact — with no build step and no third-party dependencies. Works on desktop and mobile.

## Usage

### Typing protection

Nothing to configure. Once the plugin is enabled, type `<` or `[` in a note and the editor writes `\<` / `\[` instead: the automatic pairing no longer happens, and the rendered result is still a plain bracket.

Inside a fenced code block or inline code the plugin stays out of the way, so C++ headers such as `#include <iostream>` and subscripts such as `arr[0]` are written unchanged.

Pressing a second `[` straight after a first one is allowed through, so you can still type `[[` for a wikilink; the plugin only intercepts the opening bracket of a new run.

### Repairing existing notes

Typing protection only covers new input — it cannot change characters already saved in a file. After installing, run a repair once over your older notes:

1. Open the command palette with `Ctrl/Cmd + P`.
2. Search for **repair** and choose one of:
   - **Repair current note** — try this one first.
   - **Repair current file (works in Reading view)** — same result, but available in any view mode.
   - **Repair entire vault** — asks for confirmation and reports how many files will be scanned.
   - **Escape `<` and `[` in selection** — only the selected text.

Repair is idempotent: an already-escaped `\<` or `\[` never gains a second backslash, code blocks and inline code are left alone, comparisons such as `a < b` are not touched, and real link syntax keeps working. Undo with `Ctrl/Cmd + Z`. The vault-wide command writes many files at once, so undo those in each file, or restore from the `.bak-<timestamp>` backup that is created before every write.

### What does and does not get escaped

| Input | Result | Why |
| --- | --- | --- |
| `vector<int>`, `less<T>`, `<div>` | escaped to `\<` | looks like an HTML tag |
| `a < b`, `x <= y`, `<3` | untouched | cannot start a tag |
| `arr[5]`, `a[0]`, `T[N]`, `a[i][j]`, `m["k"]` | escaped to `\[` | subscript attached to an identifier |
| `[note]`, `[blank]` | escaped to `\[` | bare brackets would be parsed as a link label |
| `[text](url)`, `[text][ref]`, `[[wikilink]]`, `[^footnote]` | untouched | genuine link / footnote syntax (can be disabled) |
| anything inside ``` / ~~~ or `` ` `` | untouched | code must stay verbatim |

## Commands

| Command | Description |
| --- | --- |
| Toggle: bracket input protection | Turns input interception on or off |
| Repair current note: escape `<` and `[` that would be treated as HTML/links | Repairs the note you are editing |
| Repair current file (works in Reading view) | Repairs the active file through the file API |
| Repair entire vault: escape every `<` and `[` that would be treated as HTML/links | Bulk repair across the vault |
| Escape `<` and `[` in selection | Repairs only the selected text |

## Settings

**Input protection**

| Setting | Default | Description |
| --- | --- | --- |
| Enable input interception | On | Master switch for interception while typing |
| Escape `<` on input (write `\<`) | On | When off, a bare `<` is written — interception degrades to "block auto-pairing only" |
| Escape `[` on input (write `\[`) | On | When off, a bare `[` is written — interception degrades to "block auto-pairing only" |
| Preserve link syntax | On | Skips `[text](url)`, `[text][ref]`, `[[wikilink]]` and `[^footnote]` during repair; only subscripts and bare brackets are escaped |
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
key <  or  key [
   │
   ├─ not inside the editor body? ──────────► pass through (Obsidian default)
   │
   ├─ inside a code block / inline code? ───► pass through (keep code verbatim)
   │
   ├─ bracket already escaped? ─────────────► write the bare bracket
   │
   ├─ `[` right after another `[`? ─────────► pass through (so `[[` still works)
   │
   └─ intercepted
        ├─ preventDefault()      stops the browser inserting the character
        ├─ stopPropagation()     CodeMirror never sees it → no auto-pairing
        └─ editor.replaceSelection('\\<') / ('\\[')   the plugin writes the escaped form
```

**Document repair.** Lines are scanned one at a time, with a state machine tracking fenced code block delimiters. Non-code lines are split on backticks into ordinary and code segments, and only ordinary segments are escaped.

A `<` is escaped when it is not followed by whitespace, a digit or an equals sign — so `a < b`, `x <= y` and `<3` stay clean, while `vector<int>`, `less<T>` and `<div>` are handled.

Square brackets use a two-stage strategy, because a lone `[` cannot tell which kind it is. First the line is scanned to locate **protected spans** — `[[...]]`, `[...](...)`, `[...][...]` and `[^...]`. Then every `[` outside those spans is escaped. A bracket that is immediately preceded by an identifier character (`A–Z`, `a–z`, `0–9`, `_`, `]`, `)`) is treated as a C++ subscript and is never protected, which is what keeps `arr[5]` and `a[i][j]` safe while `[text][ref]` still counts as a reference link.

Fence detection follows CommonMark: the opening marker may not contain the fence character again, which matters for a line such as ```` ```text``` ```` appearing inside a paragraph.

## Known limitations

- Input interception only applies to **edit mode** (Source mode and Live Preview). Reading view shows rendered output, so pre-existing content must be fixed by repairing the source file.
- Escaping **modifies the note source** (one extra `\` per bracket; the rendered output is unchanged). If you must keep the raw text, wrap the fragment in backticks or close the tag instead.
- If you deliberately write raw HTML in notes (for example `<div style="...">`), turn the protection off first with the toggle command.
- If you deliberately want a bare `[...]` to be parsed as a link label, either turn off "Preserve link syntax" semantics by keeping the target in place, or disable square-bracket escaping temporarily.
- Interception uses DOM events rather than a CodeMirror extension, so it is unaffected by Obsidian's internal upgrades — but a future change away from the `.cm-content` editor container would require updating the selector.
- The vault-wide repair writes to many files. Try it on a single note first.

## Changelog

- **1.3.0** — Added square-bracket protection: `arr[5]`, `a[i][j]` and bare `[note]` are now escaped like `<`, while `[text](url)`, `[text][ref]`, `[[wikilink]]` and `[^footnote]` are preserved. Renamed the plugin from Angle Bracket Shield to C++ Input Protection (new plugin id `cpp-input-protection`).
- **1.2.2** — Added a tag-triggered release workflow that publishes signed build provenance attestations for `main.js` and `manifest.json`; README is now English-first with the Chinese version in `README.zh-CN.md`.
- **1.2.1** — Fixed the trailing punctuation of the manifest description to satisfy the community directory submission requirements, and synced `versions.json`; no functional change.
- **1.2.0** — Fixed fence misdetection: a single-line ```` ```text``` ```` was treated as the start of a code block, which caused the rest of the document to be skipped during repair (making repair appear to do nothing). Added the "repair current file (works in Reading view)" command and a load notice.
- **1.1.0** — Added document repair (current note / entire vault / selection) and the repair-on-open setting.
- **1.0.0** — Input interception, fenced code block and inline code awareness, selection escaping.

## License

MIT
