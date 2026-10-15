# C++ Input Protection

**English** ｜ [简体中文](README.zh-CN.md)

An Obsidian plugin that keeps Markdown syntax out of the way of C++ notes. It escapes trigger characters as you type or paste, and can repair notes you have already written — while leaving code blocks, inline code and genuine link syntax untouched.

## The problem

Markdown gives a second meaning to characters C++ uses constantly.

| You write | Markdown sees | Result |
| --- | --- | --- |
| `greater<int>` | an unclosed HTML tag | everything after it is swallowed into the element |
| `arr[5]`, `[note]` | the start of a link | the brackets vanish, or become a link to nowhere |
| `#include <iostream>` | a tag | `#include` is collected into the tag pane |
| `a == b` | a highlight span | everything between the two `==` is highlighted |
| `a*b*c`, `int** p` | emphasis | the asterisks turn into italic / bold |
| `"C:\\path"` | an escape sequence | the backslash silently eats the next character |

## Installation

1. Download `main.js`, `manifest.json` and `versions.json` from the [latest release](../../releases/latest).
2. Put them in `<vault>/.obsidian/plugins/cpp-input-protection/`.
3. Settings → Community plugins → Refresh → enable **C++ Input Protection**.

Or add `Yaki-Blake/Cpp-Input-Protection` as a beta plugin via BRAT.

Requires Obsidian 1.4.0+. Plain JavaScript — `main.js` is the finished artifact — no build step, desktop and mobile.

## Escaping rules

| You type | Editor writes | Notes |
| --- | --- | --- |
| `<` | `\<` | `a < b`, `x <= y`, `<3` are left alone |
| `[` | `\[` | keeps `[text](url)`, `[[wikilink]]`, `[^footnote]`; escapes subscripts such as `arr[5]` |
| `*` | `\*` | a line-leading `* ` is restored, so bullet lists still work |
| `_` | `\_` | only at a word boundary; `my_var_name` is untouched |
| `\` | `\\` | the backslash becomes literal instead of an escape character |
| `==` | `\==` | `===` still highlights, so deliberate highlighting works |
| `#include` … | `\#include` … | 14 directives only; `# Heading` and `#tag` are untouched |

Nothing inside fenced code blocks (``` / ~~~) or inline code is touched, and pasted text goes through the same rules.

**The 14 directives:** `include` `import` `define` `undef` `pragma` `line` `error` `warning` `ifdef` `ifndef` `endif` `elif` `else` `if`

## Commands

Open the command palette (`Ctrl/Cmd + P`) and search for **repair**:

| Command | What it does |
| --- | --- |
| Toggle: bracket input protection | master switch for interception |
| Repair current note | escapes the note you are editing |
| Repair current file (works in Reading view) | works in any view mode |
| Repair entire vault | bulk repair, with a confirmation dialog |
| Escape Markdown trigger characters in selection | selection only |
| Restore current file from the most recent backup | rolls back to the newest backup |
| Restore a note from backup (open settings) | jumps to the restore panel |

Repair is idempotent (`\<` never gains a second backslash), skips code, and leaves `a < b` alone. A `<name>.md.bak-<timestamp>` copy is written before every repair.

## Settings

**Input protection** — master switch, `<`, `[`, preserve links, skip fenced blocks, skip inline code, escape on paste. All on by default.

**Markdown suppression** — directives are not tags, disable italics (keep list bullets), disable underscore italics, highlight only on `===`, backslash is literal. All on by default.

**Repair** — back up before repair (on), repair on open (off, because it writes to disk).

**Backups & restore** — pick a note → pick a version → Restore / Refresh.

**Other** — notice on load, notice on toggle (both on).

## Limitations

- Edit mode only (Source mode and Live Preview); existing notes need a repair run.
- Escaping rewrites the note source — one extra `\` per character. The rendered result is unchanged, but the raw text is less readable.
- With *Backslash is literal* on, a manually typed `\<` no longer escapes — write the backslash twice, or turn the setting off.
- YAML frontmatter is not skipped: inline `tags: [C++, STL]` gets escaped and breaks the property. Keep frontmatter tags in block style.
- Vault-wide repair scans every Markdown file, including any backup folder you keep inside the vault.
- Writing raw HTML such as `<div style="...">`? Turn the protection off first.

## License

[Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/)

## Changelog

- **1.8.0** — directive list grew from 3 words to 14; a directive now matches after any whitespace, not only at a line start.
- **1.7.0** — added the **Backups & restore** section: pick a note and a version, restore without opening the note.
- **1.6.0** — added paste interception and the *Restore current file from the most recent backup* command.
- **1.5.0** — extended repair to `#`, `==`, `*` and `_`, plus automatic backup before every repair write.
- **1.4.0** — Markdown syntax suppression: directives no longer become tags, `==` no longer highlights, italics disabled while bullets survive, backslash made literal.
- **1.3.0** — added square-bracket protection; renamed from Angle Bracket Shield to C++ Input Protection.
- **1.0.0–1.2.2** — input interception, code awareness, selection escaping, repair commands, release workflow.
