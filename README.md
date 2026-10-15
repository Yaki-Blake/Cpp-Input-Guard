# C++ Input Protection

**English** ｜ [简体中文](README.zh-CN.md)

An Obsidian plugin that keeps Markdown syntax out of the way of C++ notes. It escapes trigger characters as you type, does the same for pasted text, and can repair notes you have already written — while leaving fenced code blocks, inline code and genuine link syntax untouched.

## The problem

Obsidian renders Markdown, and Markdown gives a second meaning to many characters that C++ uses constantly.

| What you write | What Markdown sees | What happens |
| --- | --- | --- |
| `greater<int>` | an unclosed HTML tag | Every following sibling is swallowed into the element: list bullets turn into literal `*`, paragraphs merge together, indentation jumps. Both Live Preview and Reading view break |
| `arr[5]`, `[note]` | the start of a link, reference or footnote | The brackets vanish from the output, or become a link pointing nowhere |
| `#include <iostream>` | a tag | `#include` is collected into the tag pane (`tag-pane` must be on), polluting it a little more with every note |
| `if (a == b) return c == d;` | a highlight span | Two `==` on one line turn everything between them into highlighted text |
| `a*b*c`, `int** p` | emphasis | Two asterisks that are not adjacent to whitespace become italic / bold |
| `"C:\\path"`, `"100%%"` | an escape sequence | The backslash silently eats the next character; the rendered text loses it |

Obsidian's own documentation lists three ways out of the angle-bracket case: close the tag manually, wrap the fragment in backticks, or **escape it with a backslash** (`\<`). This plugin automates the third option for `<`, `[`, `*`, `_`, `=` and `#`, both for new input and for notes that already exist.

## Features

| Feature | Description |
| --- | --- |
| Intercept on input | Catches `<`, `[`, `*`, `_`, `\` and `=` in the capture phase, so Obsidian's auto-pairing never sees them |
| Intercept on paste | Text pasted into the body goes through the same rules; text pasted into a code block does not |
| Escape by default | Writes `\<`, `\[`, `\*`, `\_`, `\\` — all of which render as the literal character |
| Code aware | Never touches fenced code blocks (``` / ~~~) or inline code, so `#include <iostream>` and `arr[0]` stay verbatim |
| Smart angle brackets | Leaves `a < b`, `x <= y` and `<3` alone; escapes only what would really start a tag |
| Smart square brackets | Keeps `[text](url)`, `[[wikilink]]`, `[text][ref]` and `[^footnote]`; escapes subscripts such as `arr[5]`, `a[i][j]` and bare `[note]` |
| Markdown syntax suppression | `==` no longer highlights (only `===` does), `*` and `_` no longer italicise, `\` is literal, and C/C++ preprocessor directives no longer become tags |
| Repair existing notes | Five commands: current note, current file (works in Reading view), entire vault, selection, and on-open |
| Automatic backup | Every repair writes a `<name>.md.bak-<timestamp>` copy next to the file first (on by default) |
| Restore from backup | Pick a note and a version from a dropdown in the settings tab, or restore the active file from its most recent backup with one command |

## Installation

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

### Via BRAT

Add `Yaki-Blake/Cpp-Input-Protection` as a beta plugin when prompted. BRAT will install and update it from this repository's releases.

Requires Obsidian 1.4.0 or later. Pure JavaScript — `main.js` is the finished artifact — with no build step and no third-party dependencies. Works on desktop and mobile.

## Usage

### Typing

Nothing to configure. Once the plugin is enabled:

| You type | The editor writes | Why |
| --- | --- | --- |
| `<` | `\<` | stops auto-pairing and HTML parsing |
| `[` | `\[` | stops auto-pairing and link parsing |
| `*` | `\*` | stops italic / bold |
| `_` | `\_` (only at a word boundary — see below) | stops underscore italics |
| `\` | `\\` | makes the backslash literal instead of an escape character |
| `==` | `\==` | stops highlighting |
| `===` | `==` | the third `=` removes the backslash, so highlighting still works when you mean it |
| `*` at the start of a line, followed by a space | `* ` | the backslash is removed again, so bullet lists still work |
| `#include`, `#define`, `#ifdef`, … | `\#include`, … | stops the directive from being collected as a tag |

Two exceptions are worth stating explicitly:

- **Underscores inside identifiers stay clean.** `_` is only escaped when the character before it is not a letter or a digit, so `my_var_name` is written unchanged while `_private` and `_text_` are escaped. This keeps variable names readable in the source.
- **A second `[` right after a first one is allowed through**, so you can still type `[[` for a wikilink. Only the opening bracket of a new run is intercepted.

Inside a fenced code block or inline code the plugin stays out of the way entirely.

### Pasting

Pasted text is treated like typed text: the same rules run over the clipboard content before it is inserted. If nothing needs escaping, the paste is handed straight back to Obsidian, so ordinary pasting is not disturbed. Pasting into a fenced code block or inline code is left alone — that is where code belongs. This can be turned off with **Escape on paste**.

### Repairing existing notes

Typing protection only covers new input; it cannot change characters already saved in a file. After installing, run a repair once over your older notes. Open the command palette (`Ctrl/Cmd + P`) and search for **repair**:

- **Repair current note: escape Markdown trigger characters** — try this one first.
- **Repair current file (works in Reading view)** — same result, available in any view mode.
- **Repair entire vault: escape every Markdown trigger character** — asks for confirmation and reports how many files will be scanned.
- **Escape Markdown trigger characters in selection** — only the selected text.

Repair is idempotent: an already-escaped `\<` never gains a second backslash. Fenced code blocks and inline code are skipped. Comparisons such as `a < b` are not touched, and real link syntax keeps working. Undo with `Ctrl/Cmd + Z`; the vault-wide command writes many files at once, so undo those per file.

Before any repair writes to disk, a copy of the original file is saved next to it as `<name>.md.bak-<timestamp>`. The extension is not `md`, so Obsidian does not index it, and later repairs do not scan it.

### Restoring a backup

Two ways:

- **Command:** *Restore current file from the most recent backup* — finds the newest `.bak-` file next to the active note and replaces the note with it.
- **Settings:** scroll to the **Backups & restore** section. Pick a note from the first dropdown, pick a version from the second (newest first), then press **Restore**. This works across folders and does not require opening the note first.

Restoring is a destructive operation, so the current content is always saved as a new backup first — regardless of the *Back up before repair* setting. If you restore the wrong version, the previous state is still there.

## What gets escaped

| Input | Result | Why |
| --- | --- | --- |
| `vector<int>`, `less<T>`, `<div>` | `\<` | looks like an HTML tag |
| `a < b`, `x <= y`, `<3` | untouched | cannot start a tag |
| `arr[5]`, `a[0]`, `T[N]`, `a[i][j]`, `m["k"]` | `\[` | subscript attached to an identifier |
| `[note]`, `[blank]` | `\[` | a bare bracket would be parsed as a link label |
| `[text](url)`, `[text][ref]`, `[[wikilink]]`, `[^footnote]` | untouched | genuine link / footnote syntax |
| `#include <iostream>` inside ``` / ~~~ | untouched | code must stay verbatim |
| `my_var_name` | untouched | underscore inside a word |
| `_text_`, `_private` | `\_` | underscore at a word boundary |
| `a*b*c`, `int** p` | `a\*b\*c`, `int\*\* p` | asterisk would start emphasis |
| `if (a == b)` | `if (a \== b)` | two equals would highlight |
| `if (a === b)` | untouched | three equals is deliberate highlighting |
| `# 标题`, `## Section`, `#tag`, `a # b` | untouched | a hash that is not a directive, or a real heading / tag |
| `a#b`, `https://x.com/p#if` | untouched | a tag needs the hash to follow a line start or whitespace |

## Commands

| Command | Description |
| --- | --- |
| Toggle: bracket input protection | Turns interception on or off |
| Repair current note: escape Markdown trigger characters | Repairs the note you are editing |
| Repair current file (works in Reading view) | Repairs the active file through the file API |
| Repair entire vault: escape every Markdown trigger character | Bulk repair across the vault, with a confirmation dialog |
| Escape Markdown trigger characters in selection | Repairs only the selected text |
| Restore current file from the most recent backup | Rolls the active note back to its newest backup |
| Restore a note from backup (open settings) | Jumps to the Backups & restore section |

## Settings

### Input protection

| Setting | Default | Description |
| --- | --- | --- |
| Enable input interception | On | Master switch for interception while typing |
| Escape `<` on input (write `\<`) | On | When off, a bare `<` is written |
| Escape `[` on input (write `\[`) | On | When off, a bare `[` is written |
| Preserve link syntax | On | Skips `[text](url)`, `[text][ref]`, `[[wikilink]]` and `[^footnote]`; only subscripts and bare brackets are escaped |
| Skip fenced code blocks | On | Prevents `#include <iostream>` from becoming `#include \<iostream>` |
| Skip inline code | On | Leaves `` `...` `` spans untouched |
| Escape on paste | On | Runs the same rules over pasted text, except inside code |

### Markdown syntax suppression

| Setting | Default | Description |
| --- | --- | --- |
| Preprocessor directives are not treated as tags | On | Writes `\#include`, `\#define`, `\#pragma`, `\#ifdef`, `\#endif` and the rest. The hash itself is never escaped, so `# Heading` and `#tag` are unaffected |
| Disable italics (keep list bullets) | On | `*` is written as `\*`; a `*` at the start of a line followed by a space is restored to `* ` for bullet lists |
| Disable underscore italics | On | `_` is escaped at word boundaries, left alone inside identifiers such as `my_var` |
| Highlight only on `===` | On | `==` is written as `\==`; three or more equals keep the highlight |
| Backslash is literal | On | `\` is written as `\\`. Note: after this, a *manually* typed `\<` no longer escapes — write the backslash twice, or turn this off |

### Repairing existing notes

| Setting | Default | Description |
| --- | --- | --- |
| Back up before repair | On | Writes a `.bak-<timestamp>` copy before any repair writes to disk |
| Repair automatically when a note is opened | Off | Scans and repairs on open; writes to the file, so it is off by default |

### Backups & restore

| Control | Description |
| --- | --- |
| Which note | Every note that has at least one backup; the active note is preselected |
| Which version | All backups of that note, newest first; the newest is marked |
| Restore | Saves the current content as a new backup, then overwrites the note |
| Refresh | Rescans the vault after a restore has created new backups |

### Other

| Setting | Default | Description |
| --- | --- | --- |
| Show a notice on load | On | Confirms the plugin loaded; useful for telling whether it is active |
| Show a notice on toggle | On | Whether to show a notification after a command runs |

## How it works

**Interception.** Handlers are attached to `document` in the **capture phase**, so they run before CodeMirror 6, which binds on the editor element itself. Two channels feed the same rules: `keydown` for typing and `paste` for the clipboard — pasting produces no keydown at all, so a keyboard-only handler would miss it entirely.

```
key < [ * _ \ =  or  paste
   │
   ├─ outside the editor body? ─────────────► pass through
   ├─ inside a fenced block / inline code? ─► pass through (keep code verbatim)
   ├─ already escaped? ─────────────────────► write the bare character
   ├─ `[` right after another `[`? ─────────► pass through (so `[[` still works)
   ├─ `_` preceded by a letter or digit? ───► pass through (identifier)
   │
   └─ intercepted
        ├─ preventDefault()      stops the browser inserting the character
        ├─ stopPropagation()     CodeMirror never sees it, so no auto-pairing
        └─ editor.replaceSelection('\\<')   the plugin writes the escaped form
```

**Repair.** Lines are scanned one at a time with a state machine tracking fenced code block delimiters, so an opening fence can be found without a parser. Non-code lines are split on backticks into ordinary and code segments, and only ordinary segments are escaped.

A `<` is escaped when it is not followed by whitespace, a digit or an equals sign, so `a < b`, `x <= y` and `<3` stay clean while `vector<int>` and `less<T>` are handled.

A `#` is escaped only when it follows a line start or whitespace **and** is followed by one of the 14 known directives. That condition matches Obsidian's own tag syntax, which is why anchor links (`[[note#Heading]]`, `https://x.com/p#if`) are never touched.

Square brackets use a two-stage strategy, because a lone `[` cannot tell which kind it is. First the line is scanned to locate **protected spans** — `[[...]]`, `[...](...)`, `[...][...]` and `[^...]`. Then every `[` outside those spans is escaped. A bracket immediately preceded by an identifier character (`A-Z`, `a-z`, `0-9`, `_`, `]`, `)`) is treated as a C++ subscript and is never protected, which keeps `arr[5]` and `a[i][j]` safe while `[text][ref]` still counts as a reference link.

Fence detection follows CommonMark: the opening marker may not contain the fence character again, which matters for a line such as ```` ```text``` ```` appearing inside a paragraph.

## Known limitations

- Interception applies to **edit mode** only (Source mode and Live Preview). Reading view shows rendered output, so pre-existing content has to be fixed by repairing the source file.
- Escaping **modifies the note source** — one extra `\` per character. The rendered result is unchanged, but the raw text is less readable. If you keep your source mode visible, you will see those backslashes. Wrap a fragment in backticks instead if you want to keep the text pristine.
- **Manually typed backslash escapes stop working when *Backslash is literal* is on**, because the typed `\` is doubled: `\\<` renders as a literal `\<`.
- If you deliberately write raw HTML in notes (`<div style="...">`), turn the protection off first with the toggle command.
- If you deliberately want a bare `[...]` parsed as a link label, disable square-bracket escaping temporarily.
- Pre-existing trigger characters are **not** fixed automatically. Run a repair command, or turn on *Repair automatically when a note is opened*.
- The vault-wide repair writes to many files at once. Try it on a single note first.
- The vault-wide repair scans every Markdown file in the vault, including any you keep inside it for other purposes (a backup folder, plugin resources). Excluding folders is not implemented.
- YAML frontmatter is not skipped either. A block-style `tags:` list is safe, but an inline `tags: [C++, STL]` will have its bracket escaped, which breaks the property. Keep frontmatter tags in block style.
- Interception relies on DOM events rather than a CodeMirror extension, so it is unaffected by Obsidian's internal upgrades — but a change away from the `.cm-content` container would require updating the selector.

## Changelog

- **1.8.0** — Expanded the preprocessor-directive list from 3 words to 14 (`include`, `import`, `define`, `undef`, `pragma`, `line`, `error`, `warning`, `ifdef`, `ifndef`, `endif`, `elif`, `else`, `if`). A directive is now matched after any whitespace, not only at the start of a line, so a mention inside a sentence no longer becomes a tag. Unified two duplicated regexes into one constant.
- **1.7.0** — Added the **Backups & restore** section: pick a note and a version from two dropdowns and restore without opening the note. Backup scanning now uses the disk adapter, because `.bak-<timestamp>` files are not indexed by Obsidian and were invisible to the old `vault.getFiles()` lookup — the old restore command could never find anything. The backup-name regex now accepts both the compact `-YYYYMMDDHHmmss` form written by older versions and the current `-YYYYMMDD-HHmmss` form.
- **1.6.0** — Added paste interception and the *Restore current file from the most recent backup* command. Restoring always writes a backup of the current content first, so a wrong restore can be undone.
- **1.5.0** — Extended repair to `#`, `==`, `*` and `_`, and added automatic backup before every repair write.
- **1.4.0** — Added Markdown syntax suppression: preprocessor directives no longer become tags, `==` no longer highlights (only `===` does), italics and underscore italics are disabled while bullet lists are preserved, and the backslash is written literally instead of acting as an escape character.
- **1.3.0** — Added square-bracket protection: `arr[5]`, `a[i][j]` and bare `[note]` are now escaped like `<`, while `[text](url)`, `[text][ref]`, `[[wikilink]]` and `[^footnote]` are preserved. Renamed the plugin from Angle Bracket Shield to C++ Input Protection (new plugin id `cpp-input-protection`).
- **1.2.2** — Added a tag-triggered release workflow that publishes signed build provenance attestations for `main.js` and `manifest.json`; the README is now English-first with the Chinese version in `README.zh-CN.md`.
- **1.2.1** — Fixed the trailing punctuation of the manifest description to satisfy the community directory submission requirements, and synced `versions.json`; no functional change.
- **1.2.0** — Fixed fence misdetection: a single-line ```` ```text``` ```` was treated as the start of a code block, which caused the rest of the document to be skipped during repair (making repair appear to do nothing). Added the "repair current file (works in Reading view)" command and a load notice.
- **1.1.0** — Added document repair (current note / entire vault / selection) and the repair-on-open setting.
- **1.0.0** — Input interception, fenced code block and inline code awareness, selection escaping.

## License

This project is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/). See [LICENSE](LICENSE) for the full text.
