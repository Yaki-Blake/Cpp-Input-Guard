# C++ Input Protection

An Obsidian plugin that keeps Markdown syntax out of the way of C++ notes. It escapes trigger characters as you type or paste, and can repair notes you have already written — while leaving code blocks, inline code and genuine link syntax untouched.

中文版见本文件下半部分（Chinese version below）。

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

---

<a id="zh-cn"></a>

# C++ Input Protection（C++ 输入保护）

Obsidian 插件：让 Markdown 语法不再干扰 C++ 笔记。输入与粘贴时自动转义触发符号，也能一键修复已写好的旧笔记——同时放过围栏代码块、行内代码和正常的链接语法。

## 解决的问题

Markdown 给很多 C++ 天天在用的符号赋予了第二重含义。

| 你写的 | Markdown 看到的 | 后果 |
| --- | --- | --- |
| `greater<int>` | 未闭合的 HTML 标签 | 后续同级内容全被吞进该元素 |
| `arr[5]`、`[note]` | 链接的起点 | 方括号消失，或变成指向空处的链接 |
| `#include <iostream>` | 标签 | `#include` 被收进标签面板 |
| `a == b` | 高亮定界符 | 两处 `==` 之间的内容整体变高亮 |
| `a*b*c`、`int** p` | 强调语法 | 星号变成斜体 / 粗体 |
| `"C:\\path"` | 转义序列 | 反斜杠悄悄吞掉后一个字符 |

## 安装

1. 从 [最新 Release](../../releases/latest) 下载 `main.js`、`manifest.json`、`versions.json`。
2. 放入 `<库>/.obsidian/plugins/cpp-input-protection/`。
3. 设置 → 第三方插件 → 刷新 → 启用 **C++ Input Protection**。

也可用 BRAT 添加 `Yaki-Blake/Cpp-Input-Protection` 作为 beta 插件。

需要 Obsidian 1.4.0+。纯 JavaScript——`main.js` 即成品——无需构建，桌面端与移动端均可用。

## 转义规则

| 你输入 | 编辑器写入 | 说明 |
| --- | --- | --- |
| `<` | `\<` | `a < b`、`x <= y`、`<3` 一律放行 |
| `[` | `\[` | 保留 `[文字](地址)`、`[[双链]]`、`[^脚注]`；转义 `arr[5]` 这类下标 |
| `*` | `\*` | 行首「`*` + 空格」会还原，列表圆点仍可用 |
| `_` | `\_` | 仅词边界；`my_var_name` 不动 |
| `\` | `\\` | 反斜杠按字面显示，不再吞字符 |
| `==` | `\==` | `===` 仍触发高亮，想高亮时照常用 |
| `#include` 等 | `\#include` | 仅 14 个预处理指令词；`# 标题`、`#tag` 不受影响 |

围栏代码块（``` / ~~~）与行内代码内一律不处理；粘贴进正文的内容走同一套规则。

**14 个指令词：** `include` `import` `define` `undef` `pragma` `line` `error` `warning` `ifdef` `ifndef` `endif` `elif` `else` `if`

## 命令

命令面板（`Ctrl/Cmd + P`）搜 **repair**：

| 命令 | 作用 |
| --- | --- |
| 切换：括号输入保护 | 拦截总开关 |
| 修复当前笔记 | 转义正在编辑的笔记 |
| 修复当前文件（阅读模式也可用） | 任何视图模式都能用 |
| 修复整个库 | 批量修复，带确认弹窗 |
| 转义选区中的 Markdown 触发符号 | 只处理选中文字 |
| 从最近备份还原当前文件 | 回滚到最新备份 |
| 选择笔记还原（打开设置） | 跳到还原面板 |

修复是幂等的（`\<` 不会变成 `\\<`），跳过代码块，`a < b` 不受影响。每次修复写盘前，先生成 `<原名>.md.bak-时间戳` 副本。

## 设置

**输入保护** —— 总开关、`<`、`[`、保留链接语法、跳过围栏代码块、跳过行内代码、粘贴时转义。默认全开。

**Markdown 抑制** —— 指令词不当标签、禁用斜体（保留列表圆点）、禁用下划线斜体、仅 `===` 高亮、反斜杠字面化。默认全开。

**修复** —— 修复前备份（开）、打开笔记时自动修复（关，因为会写盘）。

**备份与还原** —— 选笔记 → 选版本 → 还原 / 刷新。

**其他** —— 加载时提示、命令执行后提示（均开）。

## 限制

- 只作用于编辑模式（源码模式与实时预览）；老内容需跑一次修复。
- 转义会改写笔记源码——每个字符多一个 `\`。渲染结果不变，但原文可读性下降。
- 「反斜杠字面化」开启时，手动打的 `\<` 会失效——写两个反斜杠，或临时关掉该设置。
- YAML frontmatter 不跳过：行内写法 `tags: [C++, STL]` 会被转义导致属性损坏，请用块状写法。
- 整库修复会扫描库里每一个 Markdown 文件，包括你放在库内的备份目录。
- 若你要特意写裸 HTML（如 `<div style="...">`），先用切换命令关掉保护。

---

## License / 许可

[Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/)

## Changelog / 更新日志

- **1.8.0** — directive list grew from 3 words to 14; a directive now matches after any whitespace, not only at a line start.
- **1.7.0** — added the **Backups & restore** section: pick a note and a version, restore without opening the note.
- **1.6.0** — added paste interception and the *Restore current file from the most recent backup* command.
- **1.5.0** — extended repair to `#`, `==`, `*` and `_`, plus automatic backup before every repair write.
- **1.4.0** — Markdown syntax suppression: directives no longer become tags, `==` no longer highlights, italics disabled while bullets survive, backslash made literal.
- **1.3.0** — added square-bracket protection; renamed from Angle Bracket Shield to C++ Input Protection.
- **1.0.0–1.2.2** — input interception, code awareness, selection escaping, repair commands, release workflow.
