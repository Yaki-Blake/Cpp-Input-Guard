'use strict';

/*
 * cpp-input-protection（C++ 输入保护）
 * ---------------------------------------------------------------
 * 解决三类问题：
 *
 * 【A】新输入：在编辑模式输入 `<` 或 `[` 时立即拦截，
 *      既不让 Obsidian 自动配对成 `<>` / `[]`，
 *      也不让它被当作 HTML 标签或链接语法。
 *
 * 【B】旧文档（尖括号）：已经写在笔记里的 `vector<int>` / `complex<int>` 之类，
 *      渲染时会被当成未闭合 HTML 标签，把后续内容全部吞进该元素，
 *      导致列表、标题、段落全部失效（实时预览与阅读模式都崩）。
 *
 * 【C】旧文档（方括号）：`arr[5]`、`a[0]`、`[空白]` 之类会被 Markdown
 *      尝试解析成链接 / 脚注 / 维基链接，导致方括号被吞掉或被解析成
 *      一个指向不存在目标的链接。正常链接 `[文字](地址)` 与双链 `[[...]]`
 *      必须保持原样，因此方括号采用更保守的判定规则。
 *
 * 【D】Markdown 语法抑制（斜体、高亮、标签）：
 *      预处理指令（`#include` `#define` `#pragma` `#ifdef` `#endif` 等）补 `\#`，
 *      不再进入标签库；`#` 本身与 `# 标题`、`#标签` 一律原样显示；
 *      `==` 不触发高亮（仅 `===` 触发）；`*` / `_` 不再触发行内强调，
 *      行首「* + 空格」仍保留为列表圆点；`\` 按字面显示。
 *
 * 提供「一键修复」把存量笔记里的上述符号一次性转义，
 * 代码块与行内代码内部一律跳过，保持代码原样。
 * 写盘前可选自动备份。备份与还原的完整路径为：
 *   修复 → 生成 `<原名>.md.bak-时间戳`；
 *   还原 → 设置面板内选笔记 + 选版本，或命令「从最近备份还原当前文件」。
 * 备份扩展名不被 Obsidian 索引，因此扫描走磁盘适配器而非文件索引。
 *
 * 拦截实现：在 document 捕获阶段监听，早于 CodeMirror 6 的内部处理拿到事件。
 *          两个通道——
 *            keydown：手工键入；
 *            paste  ：从课件 / 网页 / 其他笔记复制进来（粘贴不产生 keydown，
 *                     单靠 keydown 会整个漏掉）。
 */

const {
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
	MarkdownView,
} = require('obsidian');

const DEFAULT_SETTINGS = {
	enabled: true,               // 输入拦截总开关
	escapeOnInput: true,         // 输入 < 时写入 \<（false 则只写裸 <）
	escapeSquareOnInput: true,   // 输入 [ 时写入 \[（false 则只写裸 [）
	skipFencedBlocks: true,      // 跳过 ``` / ~~~ 围栏代码块
	skipInlineCode: true,        // 跳过 `行内代码`
	preserveLinks: true,         // 保留 [文字](地址) 与 [[双链]] 语法
	protectHashDirectives: true, // 只对「# + 指令词」补 \#；# 本身永不转义
	disableItalic: true,         // 输入 * 即写 \*，仅行首「* + 空格」还原为列表圆点
	disableUnderscoreItalic: true, // 词边界的 _ 即写 \_，禁用下划线斜体
	literalBackslash: true,      // 输入 \ 写 \\，反斜杠按字面显示、不再吞掉字符
	highlightOnlyTriple: true,   // == 写成 \== 不触发高亮，=== 才触发
	showNoticeOnToggle: true,
	showLoadNotice: true,        // 加载时弹提示，用于确认插件是否生效
	autoRepairOnOpen: false,     // 打开笔记时自动修复（会写盘，默认关闭）
	backupBeforeRepair: true,    // 修复写盘前先生成 .bak-时间戳 副本
	escapeOnPaste: true,         // 粘贴进正文的内容同样按修复规则转义
};

/* ================================================================
 * 一、代码上下文判定
 * ================================================================ */

/*
 * 判断一行是否为「围栏代码块边界」，返回 '`' / '~' / null。
 * 关键：按 CommonMark 规范，围栏起始标记之后不能含有同种字符。
 * 否则 ```` ```有个建议...``` ```` 这种「一行内用三个反引号包裹文字」
 * 会被误判成代码块开始，导致其后所有内容被跳过不处理。
 */
function matchFence(line) {
	let m = line.match(/^\s{0,3}(`{3,})[^`]*$/);
	if (m) return m[1].charAt(0);
	m = line.match(/^\s{0,3}(~{3,})[^~]*$/);
	if (m) return m[1].charAt(0);
	return null;
}

// 光标是否处于未闭合的围栏代码块（``` 或 ~~~）中
function isInsideFencedBlock(editor, lineIndex, ch) {
	let openFence = null;
	for (let i = 0; i < lineIndex; i++) {
		const c = matchFence(editor.getLine(i));
		if (!c) continue;
		if (openFence === null) openFence = c;
		else if (openFence === c) openFence = null;
	}

	// 光标所在行本身是围栏行时，按列位置区分「标记之前 / 之后」
	const curLine = editor.getLine(lineIndex);
	const curChar = matchFence(curLine);
	if (curChar) {
		const markerLen = curLine.match(/^\s{0,3}(`{3,}|~{3,})/)[0].length;
		if (typeof ch === 'number' && ch <= markerLen) return openFence !== null;
		if (openFence === null) return true;
		if (openFence === curChar) return false;
	}

	return openFence !== null;
}

// 光标是否落在行内代码中（该行内左侧反引号数量为奇数）
function isInsideInlineCode(lineText, ch) {
	let ticks = 0;
	for (let i = 0; i < ch && i < lineText.length; i++) {
		if (lineText.charAt(i) === '`') ticks++;
	}
	return ticks % 2 === 1;
}

/* ================================================================
 * 二、文档修复：把会被当作 HTML / 链接语法的括号转义掉
 * ================================================================ */

// 命中条件：< 后面不是空白 / 数字 / 等号。
// 这样 `a < b`、`x <= y`、`<3` 保持原样不动，
// 而 `vector<int>`、`less<类型>`、`<div>` 会被转义。
const HTML_LIKE_LT = /(\\?)<(?![\s\d=])/g;

// ---------------------------------------------------------------
// 预处理指令：# + 指令词
// ---------------------------------------------------------------
// 规则：# 本身一律原样显示，绝不转义。
//      `# 标题`、`## 二级标题`、`#标签`、`a # b` 等一律保持干净。
//      只有当 # 后面紧跟下表里的指令词、且 # 前面是行首或空白时，
//      才在 # 前补一个反斜杠，阻止它被解析为标签。
//
// 「# 前面是行首或空白」与 Obsidian 自身的标签语法一致：标签要求 # 之前
// 是行首或空白，否则不成标签。因此 a#b、网址锚点 https://x.com/p#if、
// 双链 [[笔记#标题]] 都不会被误伤。
//
// 词表覆盖 C / C++ 标准预处理指令，外加常用编译器扩展。
// `\b` 会挡住 `#iffy`、`#includes` 这类前缀误匹配。
// 已转义的 `\#include` 中 # 前是 \（既非行首也非空白），故不会被二次处理。
const HASH_DIRECTIVE_WORDS = [
	'include', 'import',
	'define', 'undef',
	'pragma', 'line', 'error', 'warning',
	'ifdef', 'ifndef', 'endif', 'elif', 'else', 'if',
];
const HASH_DIRECTIVE_SOURCE =
	'(^|\\s)#(?=(?:' + HASH_DIRECTIVE_WORDS.join('|') + ')\\b)';
// 不带 g：用 match 定位 # 的下标（供输入时单点补反斜杠）
const HASH_DIRECTIVE = new RegExp(HASH_DIRECTIVE_SOURCE);
// 带 g：用 replace 一次处理一行里的全部命中（供修复 / 粘贴）
const HASH_DIRECTIVE_G = new RegExp(HASH_DIRECTIVE_SOURCE, 'g');

// 星号：一律转义；行首「* + 空格」的列表圆点在调用处单独豁免
const STAR_ANY = /(\\?)\*/g;

// 下划线：词内（前一字符为字母 / 数字）放行，词边界转义
const UNDERSCORE_ANY = /(\\?)_/g;

// 等号：两个 `==` 转义；三个及以上 `===` 保留为高亮定界符
const EQUAL_PAIR = /(\\?)(={2,})/g;

/*
 * 方括号判定：比尖括号保守得多。
 *
 * 采用「先划保护区，再保护区外转义」两阶段策略，
 * 而不是逐字符判断 —— 因为单个 `[` 无法判断自己属于哪一类。
 *
 * 需要保护（不转义）的四种语法：
 *   1. `[[双链]]`        —— wiki 链接，整段扫描到对称的 `]]`
 *   2. `[文字](地址)`    —— 行内链接，`]` 后紧跟 `(`
 *   3. `[文字][引用]`    —— 引用式链接，`]` 后紧跟 `[`
 *   4. `[^脚注]`         —— 脚注定义 / 引用
 *
 * 需要转义：
 *   - `arr[5]`、`a[0]`、`T[N]`  —— 数组下标 / 模板参数
 *   - `[空白]`、`[随便写]`      —— 没跟 `(` / `[` 的裸方括号，
 *                                  会被渲染器当作「链接文本」而不显示方括号
 */

/*
 * 扫描文本，返回需要保护（保持原样）的区间 [start, end)。
 * 区间一经确定即不再被后续扫描破坏。
 */
/*
 * 关键消歧规则：`[` 是否「紧贴在标识符之后」。
 *
 * Markdown 的链接 / 脚注 / 双链都有一个共同前提：
 * 开方括号前面不应紧贴标识符字符。而 C++ 的下标恰恰总是紧贴：
 *   arr[5]  a[0]  T[N]  m["key"]  a[i][j]  —— 前面是字母、数字、`_`、`]`、`)`
 *
 * 若不做这项判断，`a[i][j]` 会因为 `][` 模式被误判成「引用式链接」而漏转义，
 * 这正是最需要保护的 C++ 二维数组写法。
 */
function isSubscriptBracket(text, i) {
	if (i === 0) return false;
	const prev = text.charAt(i - 1);
	return /[A-Za-z0-9_\]\)]/.test(prev);
}

function findProtectedSpans(text) {
	const spans = [];
	let i = 0;
	const n = text.length;

	while (i < n) {
		if (text.charAt(i) !== '[') {
			i++;
			continue;
		}
		// 已转义的 \[ 不参与语法判定
		if (i > 0 && text.charAt(i - 1) === '\\') {
			i++;
			continue;
		}

		// 紧贴标识符 —— 是下标，绝不保护
		if (isSubscriptBracket(text, i)) {
			i++;
			continue;
		}

		// --- 1. `[[双链]]` ---
		if (text.charAt(i + 1) === '[') {
			const close = text.indexOf(']]', i + 2);
			if (close !== -1) {
				spans.push([i, close + 2]);
				i = close + 2;
				continue;
			}
			i++;
			continue;
		}

		// --- 2/3/4. 需要找到成对的 `]` ---
		const close = text.indexOf(']', i + 1);
		if (close === -1) {
			i++;
			continue;
		}
		const label = text.slice(i + 1, close);
		// 链接文本 / 脚注名不应跨行
		if (label.indexOf('\n') !== -1) {
			i++;
			continue;
		}

		// `[^脚注]`
		if (label.charAt(0) === '^') {
			spans.push([i, close + 1]);
			i = close + 1;
			continue;
		}

		const after = text.charAt(close + 1);

		// `[文字](地址)` 行内链接
		if (after === '(') {
			const paren = text.indexOf(')', close + 2);
			if (paren !== -1) {
				spans.push([i, paren + 1]);
				i = paren + 1;
				continue;
			}
		}

		// `[文字][引用]` 引用式链接。
		// 走到这里说明本组 `[` 前面不是标识符（否则早已被上面的下标分支拦掉）。
		// 因此 `]` 后紧跟 `[` 且能成对闭合时，判定为引用式链接；
		// 而 `a[i][j]` 的两个 `[` 都紧贴标识符，根本不会进入本分支。
		if (after === '[') {
			const refClose = text.indexOf(']', close + 2);
			if (refClose !== -1) {
				spans.push([i, refClose + 1]);
				i = refClose + 1;
				continue;
			}
		}

		// 都不是 —— 保持未保护状态，交由转义阶段处理
		i++;
	}

	return spans;
}

const ESCAPED_LB = /(\\?)\[/g;

/*
 * 转义一行中的方括号。
 * preserveLinks 为真时跳过保护区间；为假时一律转义。
 */
function escapeSquareBrackets(segment, counter, preserveLinks) {
	const spans = preserveLinks ? findProtectedSpans(segment) : [];
	const inSpan = (pos) => {
		for (const [s, e] of spans) {
			if (pos >= s && pos < e) return true;
		}
		return false;
	};

	return segment.replace(ESCAPED_LB, (match, backslash, offset) => {
		if (backslash) return match; // 已转义，跳过
		if (inSpan(offset)) return match;
		counter.n++;
		return '\\[';
	});
}

// 逐段处理一行：反引号包裹的段原样保留，其余段执行转义
function escapeOutsideInlineCode(line, counter, opts) {
	const o = opts || {};

	// 预处理指令：在每个命中的 # 之前补一个反斜杠，阻止其被识别为标签。
	// 一行里可能出现多处（如说明文字「用 #include 与 #define」），一并处理。
	// 已转义的 `\#include` 中 # 前是 \，既非行首也非空白，天然幂等。
	if (o.hashDirectives) {
		line = line.replace(HASH_DIRECTIVE_G, (_m, pre) => {
			counter.n++;
			return pre + '\\#';
		});
	}

	const parts = line.split(/(`+[^`]*`+)/g); // 偶数索引 = 非代码段

	// 行首列表圆点豁免：`* `（星号 + 空格）位于行首时保留为列表标记。
	// 列表标记必然出现在行首，且其前只可能是空白（不会有 < / [ 被插入反斜杠），
	// 所以在首段中定位一次即可，偏移不会漂移。
	let listBullet = -1;
	if (o.italic) {
		const lm = parts[0].match(/^(\s*)\*(?=\s)/);
		if (lm) listBullet = lm[1].length;
	}

	for (let i = 0; i < parts.length; i += 2) {
		let seg = parts[i];

		seg = seg.replace(HTML_LIKE_LT, (match, backslash) => {
			if (backslash) return match; // 已经转义过，跳过
			counter.n++;
			return '\\<';
		});

		if (o.escapeSquare) {
			seg = escapeSquareBrackets(seg, counter, o.preserveLinks);
		}

		// 星号：一律转义；仅行首列表圆点例外（保留 `* 项目`）
		if (o.italic) {
			seg = seg.replace(STAR_ANY, (match, backslash, offset) => {
				if (backslash) return match;
				if (i === 0 && offset === listBullet) return match;
				counter.n++;
				return '\\*';
			});
		}

		// 下划线：前一字符是字母 / 数字（词内，如 my_var）时放行
		if (o.underscore) {
			seg = seg.replace(UNDERSCORE_ANY, (match, backslash, offset) => {
				if (backslash) return match;
				const prev = offset > 0 ? seg.charAt(offset - 1) : '';
				if (/[A-Za-z0-9]/.test(prev)) return match;
				counter.n++;
				return '\\_';
			});
		}

		// 等号：`==` 不再触发高亮；三个及以上保留为高亮定界符
		if (o.highlight) {
			seg = seg.replace(EQUAL_PAIR, (match, backslash, eqs) => {
				if (backslash) return match;
				if (eqs.length >= 3) return match;
				counter.n++;
				return '\\' + eqs;
			});
		}

		parts[i] = seg;
	}
	return parts.join('');
}

// 修复整篇文档；返回 { text, count }
function repairText(text, options) {
	const opts = Object.assign(
		{
			escapeSquare: true,
			preserveLinks: true,
			hashDirectives: true,
			highlight: true,
			italic: true,
			underscore: true,
		},
		options || {}
	);
	const counter = { n: 0 };
	const lines = text.split('\n');
	const out = new Array(lines.length);
	let openFence = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// 围栏行本身不改，只切换状态
		const c = matchFence(line);
		if (c) {
			if (openFence === null) openFence = c;
			else if (openFence === c) openFence = null;
			out[i] = line;
			continue;
		}

		// 代码块内部不改
		if (openFence !== null) {
			out[i] = line;
			continue;
		}

		out[i] = escapeOutsideInlineCode(line, counter, opts);
	}

	return { text: out.join('\n'), count: counter.n };
}

/* ================================================================
 * 三、确认弹窗
 * ================================================================ */

class ConfirmModal extends Modal {
	constructor(app, opts) {
		super(app);
		this.opts = opts;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.opts.title });
		contentEl.createEl('p', { text: this.opts.body });

		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		const ok = row.createEl('button', {
			text: this.opts.confirmText || '确认',
			cls: 'mod-warning',
		});
		ok.onclick = () => {
			this.close();
			this.opts.onConfirm();
		};
		const cancel = row.createEl('button', { text: '取消' });
		cancel.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* ================================================================
 * 三·五、备份文件名解析
 * ================================================================ */

/*
 * 备份命名规则：`<笔记路径>.bak-YYYYMMDD-HHmmss`，
 * 同一秒内重复备份时尾部会追加 `-随机串`。
 * 兼容旧版紧凑写法 `<笔记路径>.bak-YYYYMMDDHHmmss`（日期与时间之间没有横杠），
 * 因此正则里那一位横杠是可选的。
 *
 * 注意：备份的扩展名是 `bak-20261012101827` 这种非标准后缀，
 * Obsidian 默认不索引不支持的扩展名，因此**不能用 vault.getFiles() 找备份**，
 * 必须走磁盘适配器（vault.adapter.list / read）。
 */
const BACKUP_PATH_RE = /^(.*)\.bak-(\d{8})-?(\d{6})(?:-([a-z0-9]{1,8}))?$/;

function backupStamp(date) {
	const d = date || new Date();
	const p2 = (n) => String(n).padStart(2, '0');
	return (
		`${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
		`-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
	);
}

// 解析备份路径；不是备份文件则返回 null
function parseBackupPath(path) {
	const m = BACKUP_PATH_RE.exec(path);
	if (!m) return null;
	const day = m[2];
	const clock = m[3];
	return {
		path: path,
		notePath: m[1],
		stamp: `${day}-${clock}`, // 可用于排序
		name: path.slice(path.lastIndexOf('/') + 1),
		label:
			`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ` +
			`${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}`,
	};
}

/* ================================================================
 * 四、插件主体
 * ================================================================ */

class BracketShieldPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.addSettingTab(new BracketShieldSettingTab(this.app, this));

		/* --- 命令 1：输入拦截开关 --- */
		this.addCommand({
			id: 'toggle-shield',
			name: '切换：括号输入保护',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				if (this.settings.showNoticeOnToggle) {
					new Notice(`括号保护已${this.settings.enabled ? '开启' : '关闭'}`);
				}
			},
		});

		/* --- 命令 2：修复当前笔记 --- */
		this.addCommand({
			id: 'repair-current-note',
			name: '修复当前笔记：转义 Markdown 触发符号',
			editorCallback: async (editor) => {
				const before = editor.getValue();
				const { text, count } = repairText(before, this.repairOptions());
				if (count === 0) {
					new Notice('当前笔记无需修复');
					return;
				}
				const file = this.app.workspace.getActiveFile();
				if (file) await this.backupBeforeWrite(file, before);
				const lastLine = editor.lastLine();
				editor.replaceRange(
					text,
					{ line: 0, ch: 0 },
					{ line: lastLine, ch: editor.getLine(lastLine).length }
				);
				new Notice(`已修复 ${count} 处（Ctrl+Z 可撤销）`);
			},
		});

		/* --- 命令 3：修复整个库 --- */
		this.addCommand({
			id: 'repair-vault',
			name: '修复整个库：转义全部 Markdown 触发符号',
			callback: () => {
				const files = this.app.vault.getMarkdownFiles();
				const backupTip = this.settings.backupBeforeRepair
					? '写盘前会为每个将被改动的文件生成 .bak-时间戳 备份。'
					: '当前未开启自动备份，请先自行确认整个库已有备份。';
				new ConfirmModal(this.app, {
					title: '批量修复整个库',
					body:
						`将扫描本库全部 ${files.length} 个 Markdown 文件，` +
						'转义会被解析的语法符号：<、[、==、*、_，' +
						'以及 C/C++ 预处理指令' +
						'（#include / #define / #pragma / #ifdef / #endif / #if 等）。\n\n' +
						'代码块与行内代码内部不会改动；' +
						'正常的 [文字](地址) 与 [[双链]] 会按设置保留；' +
						'行首「* + 空格」仍保留为列表圆点；' +
						'仅修改确有问题的文件。\n\n' +
						backupTip +
						' 建议先在单个文件上试用一次再执行全库。',
					confirmText: '开始修复',
					onConfirm: () => this.repairVault(files),
				}).open();
			},
		});

		/* --- 命令 4：修复选区 --- */
		this.addCommand({
			id: 'escape-selection',
			name: '转义选区中的 Markdown 触发符号',
			editorCheckCallback: (checking, editor) => {
				const selection = editor.getSelection();
				if (!selection || !/[<[*_=#]/.test(selection)) return false;
				if (!checking) {
					const { text, count } = repairText(
						selection,
						this.repairOptions()
					);
					editor.replaceSelection(text);
					new Notice(count > 0 ? `已修复 ${count} 处` : '选区无需修复');
				}
				return true;
			},
		});

		/* --- 命令 5：修复当前文件（阅读模式也可用） --- */
		this.addCommand({
			id: 'repair-active-file',
			name: '修复当前文件（阅读模式也可用）',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('没有打开的文件');
					return;
				}
				if (file.extension !== 'md') {
					new Notice('当前文件不是 Markdown');
					return;
				}
				const src = await this.app.vault.read(file);
				const { text, count } = repairText(src, this.repairOptions());
				if (count === 0) {
					new Notice('当前文件无需修复');
					return;
				}
				await this.backupBeforeWrite(file, src);
				await this.app.vault.modify(file, text);
				new Notice(`已修复「${file.basename}」${count} 处`);
			},
		});

		/* --- 命令 6：从最近备份还原当前文件 --- */
		this.addCommand({
			id: 'restore-from-backup',
			name: '从最近备份还原当前文件',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') {
					new Notice('请先打开一篇 Markdown 笔记');
					return;
				}
				const cands = await this.listBackupsFor(file.path);
				if (cands.length === 0) {
					new Notice(`「${file.basename}」没有找到备份`);
					return;
				}
				this.confirmRestore(file.path, cands[0], cands.length);
			},
		});

		/* --- 命令 7：打开设置面板选文件还原 --- */
		this.addCommand({
			id: 'open-restore-settings',
			name: '选择笔记还原（打开设置）',
			callback: () => {
				const setting = this.app.setting;
				if (setting && typeof setting.open === 'function') {
					setting.open();
				}
				if (setting && setting.openTabById) setting.openTabById(this.manifest.id);
			},
		});
			/* --- 核心：捕获阶段拦截 `<` `[` `*` `_` `\` `=` --- */
		this.keydownHandler = this.handleKeydown.bind(this);
		this.registerDomEvent(document, 'keydown', this.keydownHandler, true);

		/* --- 粘贴拦截：keydown 捕获不到粘贴，这里补上同一套转义 --- */
		this.pasteHandler = this.handlePaste.bind(this);
		this.registerDomEvent(document, 'paste', this.pasteHandler, true);

		/* --- 预处理指令：内容变化后自动补 `\#` --- */
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor) => {
				this.handleEditorChange(editor);
			})
		);

		/* --- 可选：打开笔记时自动修复 --- */
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!this.settings.autoRepairOnOpen) return;
				if (!file || file.extension !== 'md') return;
				window.setTimeout(() => this.autoRepair(file), 400);
			})
		);

		/* --- 加载自检：确认插件是否真的被 Obsidian 加载 --- */
		if (this.settings.showLoadNotice) {
			new Notice('cpp-input-protection 已加载，Ctrl+P 搜「修复」即可使用');
		}
	}

	/* ---------- 修复选项：由设置推导 ---------- */
	repairOptions() {
		return {
			escapeSquare: this.settings.escapeSquareOnInput,
			preserveLinks: this.settings.preserveLinks,
			hashDirectives: this.settings.protectHashDirectives,
			highlight: this.settings.highlightOnlyTriple,
			italic: this.settings.disableItalic,
			underscore: this.settings.disableUnderscoreItalic,
		};
	}

	/* ---------- 粘贴拦截 ---------- */

	/*
	 * 输入拦截挂在 keydown 上，而粘贴不产生 keydown —— 从外部复制进来的
	 * `vector<int>`、`a==b`、`#include` 会整个绕过防护。这里对剪贴板文本
	 * 跑同一套修复规则后再插入，行为与逐字键入保持一致。
	 *
	 * 围栏代码块内与行内代码内不处理（粘代码本就该保持原样）；
	 * 剪贴板内容若无需转义（count 为 0），不拦截，交回 Obsidian 默认粘贴。
	 */
	handlePaste(evt) {
		const s = this.settings;
		if (!s.enabled || !s.escapeOnPaste) return;
		if (evt.defaultPrevented) return;

		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		if (!target.closest('.cm-content')) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.editor) return;
		const editor = view.editor;
		const cursor = editor.getCursor();

		if (s.skipFencedBlocks && isInsideFencedBlock(editor, cursor.line, cursor.ch)) return;
		const lineText = editor.getLine(cursor.line);
		if (s.skipInlineCode && isInsideInlineCode(lineText, cursor.ch)) return;

		const cb = evt.clipboardData;
		if (!cb) return;
		const raw = cb.getData('text/plain');
		if (!raw) return;

		const { text, count } = repairText(raw, this.repairOptions());
		if (count === 0) return; // 无需转义，交回默认粘贴行为

		evt.preventDefault();
		evt.stopPropagation();
		editor.replaceSelection(text);
		new Notice(`粘贴内容已转义 ${count} 处`);
	}

	/* ---------- 输入拦截 ---------- */

	handleKeydown(evt) {
		const s = this.settings;
		if (!s.enabled) return;
		if (evt.defaultPrevented || evt.isComposing || evt.keyCode === 229) return;
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;

		const key = evt.key;
		const HANDLED = ['<', '[', '*', '_', '\\', '=', ' '];
		if (HANDLED.indexOf(key) === -1) return;

		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		if (!target.closest('.cm-content')) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.editor) return;
		const editor = view.editor;
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const ch = cursor.ch;

		if (s.skipFencedBlocks && isInsideFencedBlock(editor, cursor.line, ch)) return;
		if (s.skipInlineCode && isInsideInlineCode(lineText, ch)) return;

		// ---- 空格：把行首刚写入的 `\*` 还原为列表圆点 `* ` ----
		if (key === ' ') {
			if (s.disableItalic) this.tryRestoreListBullet(evt, editor, cursor, lineText, ch);
			return;
		}

		// ---- 等号：`==` 不触发高亮，`===` 才触发（见 handleEquals）----
		if (key === '=') {
			if (s.highlightOnlyTriple && this.handleEquals(evt, editor, cursor, lineText, ch)) return;
		}

		// ---- 星号：禁用斜体，输入即写 `\*` ----
		if (key === '*' && s.disableItalic) {
			evt.preventDefault();
			evt.stopPropagation();
			editor.replaceSelection('\\*');
			return;
		}

		// ---- 下划线：词内放行（变量名内部），词边界写 `\_` ----
		if (key === '_' && s.disableUnderscoreItalic) {
			const before = ch > 0 ? lineText.charAt(ch - 1) : '';
			if (/[A-Za-z0-9]/.test(before)) return; // my_var 这类保持源码干净
			evt.preventDefault();
			evt.stopPropagation();
			editor.replaceSelection('\\_');
			return;
		}

		// ---- 反斜杠：写两个，按字面显示，不再吞掉后续字符 ----
		if (key === '\\' && s.literalBackslash) {
			evt.preventDefault();
			evt.stopPropagation();
			editor.replaceSelection('\\\\');
			return;
		}

		// ---- 尖括号 / 方括号（原有逻辑）----
		const isLt = key === '<';
		const isLb = key === '[';
		if (!isLt && !isLb) return;
		if (isLb && !s.escapeSquareOnInput) return;

		const prevChar = ch > 0 ? lineText.charAt(ch - 1) : '';
		const alreadyEscaped = prevChar === '\\';

		// 方括号额外保护：光标前若已是 `[`，说明正在写 `[[双链]]`，
		// 此时放行第二个 `[`，避免把双链拆开。
		if (isLb && !alreadyEscaped && prevChar === '[') return;
		// 同理，紧随其后的 `]` 无需处理；这里只拦截开括号

		evt.preventDefault();
		evt.stopPropagation();

		let insertText;
		if (isLt) {
			insertText = s.escapeOnInput && !alreadyEscaped ? '\\<' : '<';
		} else {
			insertText = s.escapeSquareOnInput && !alreadyEscaped ? '\\[' : '[';
		}
		editor.replaceSelection(insertText);
	}

	/* ---------- 等号：`==` 反斜杠化，`===` 还原为高亮定界符 ---------- */

	/*
	 * 目标：`==` 不再触发高亮，只有连敲三次 `=` 才形成高亮定界符。
	 *
	 * 用户敲第 2 个 `=` 时：把前一个 `=` 写成 `\=`，阻断配对；
	 * 用户敲第 3 个 `=` 时：把那个 `\` 撤掉，还原成真正的 `==`。
	 *
	 * 于是「==」→ `\==`（字面显示），「===」→ `==`（触发高亮）。
	 */
	handleEquals(evt, editor, cursor, lineText, ch) {
		const line = cursor.line;
		const p1 = ch > 0 ? lineText.charAt(ch - 1) : '';
		const p2 = ch > 1 ? lineText.charAt(ch - 2) : '';
		const p3 = ch > 2 ? lineText.charAt(ch - 3) : '';

		// A. 刚敲下第二个 `=`：转义前一个，阻断 `==` 配对
		if (p1 === '=' && p2 !== '\\') {
			evt.preventDefault();
			evt.stopPropagation();
			editor.replaceRange('\\=', { line, ch: ch - 1 }, { line, ch });
			editor.replaceSelection('=');
			return true;
		}

		// B. 前面是 `\==` 且又敲下 `=`：撤掉反斜杠，还原为 `==`
		if (p1 === '=' && p2 === '=' && p3 === '\\') {
			evt.preventDefault();
			evt.stopPropagation();
			editor.replaceRange('', { line, ch: ch - 3 }, { line, ch: ch - 2 });
			editor.setCursor({ line, ch: ch - 1 });
			return true;
		}

		return false;
	}

	/* ---------- 空格：把行首 `\*` 还原为列表圆点 ---------- */

	/*
	 * `*` 被一律写成 `\*`，但行首的「星号 + 空格」应该保留为列表圆点。
	 * 因此当用户在行首的 `\*` 后面敲空格时，撤掉反斜杠。
	 */
	tryRestoreListBullet(evt, editor, cursor, lineText, ch) {
		if (ch < 2) return;
		if (lineText.slice(ch - 2, ch) !== '\\*') return; // 前面不是刚写入的 `\*`
		if (lineText.slice(0, ch - 2).trim() !== '') return; // 星号不在行首，不是列表

		evt.preventDefault();
		evt.stopPropagation();
		const line = cursor.line;
		editor.replaceRange('', { line, ch: ch - 2 }, { line, ch: ch - 1 });
		editor.replaceSelection(' ');
	}

	/* ---------- 预处理指令：自动补 `\#` ---------- */

	/*
	 * Obsidian 把 `#include` 这类「井号 + 非空白」识别为标签，且不限行首：
	 * 说明文字里的「用 #include 引入头文件」同样会被收进标签库。
	 * 因此在编辑器内容变化后检查一次光标所在行：
	 * 只有当 # 后面紧跟指令词（见 HASH_DIRECTIVE_WORDS）、且 # 前面是行首
	 * 或空白时，才在 # 前补一个反斜杠。
	 * 单独的 `#`、`# 标题`、`#标签` 一律放行，不做任何改动。
	 */
	handleEditorChange(editor) {
		const s = this.settings;
		if (!s.enabled || !s.protectHashDirectives) return;
		if (this.applyingHashFix) return; // 防止自己写入的内容再次触发

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const m = line.match(HASH_DIRECTIVE);
		if (!m) return;

		const hashCh = m.index + m[1].length;
		if (hashCh > 0 && line.charAt(hashCh - 1) === '\\') return; // 已转义

		if (s.skipFencedBlocks && isInsideFencedBlock(editor, cursor.line, cursor.ch)) return;
		if (s.skipInlineCode && isInsideInlineCode(line, cursor.ch)) return;

		this.applyingHashFix = true;
		try {
			editor.replaceRange(
				'\\',
				{ line: cursor.line, ch: hashCh },
				{ line: cursor.line, ch: hashCh }
			);
			if (cursor.ch >= hashCh) {
				editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
			}
		} finally {
			this.applyingHashFix = false;
		}
	}

	/* ---------- 修复逻辑 ---------- */

	async autoRepair(file) {
		try {
			const src = await this.app.vault.cachedRead(file);

			// 若该文件正在编辑器里且内容已被改动，说明用户已在输入，跳过
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && view.file && view.file.path === file.path) {
				if (view.editor.getValue() !== src) return;
			}

			const { text, count } = repairText(src, this.repairOptions());
			if (count > 0) {
				await this.backupBeforeWrite(file, src);
				await this.app.vault.modify(file, text);
				new Notice(`已自动修复「${file.basename}」${count} 处`);
			}
		} catch (e) {
			console.error('[bracket-shield] 自动修复失败:', file.path, e);
		}
	}

	/* ---------- 备份：写盘前生成 .bak-时间戳 副本 ---------- */

	/*
	 * 备份与被修复文件同目录，命名为 `<原名>.md.bak-YYYYMMDD-HHmmss`。
	 * 扩展名不是 md，Obsidian 不会把它当作笔记收录，也不会再次扫描修复。
	 */
	async backupBeforeWrite(file, content, force) {
		return this.backupContentByPath(file.path, content, force);
	}

	// 按路径写备份（不依赖 Obsidian 的文件索引，备份扩展名本来就不被索引）
	async backupContentByPath(notePath, content, force) {
		// force 用于「从备份还原」：还原是覆盖性操作，无论备份开关如何都先存一份
		if (!force && !this.settings.backupBeforeRepair) return null;
		try {
			const adapter = this.app.vault.adapter;
			let target = `${notePath}.bak-${backupStamp()}`;
			if (await adapter.exists(target)) {
				target += '-' + Math.random().toString(36).slice(2, 6);
			}
			await adapter.write(target, content);
			return target;
		} catch (e) {
			console.error('[cpp-input-protection] 备份失败:', notePath, e);
			return null;
		}
	}

	/* ---------- 备份扫描：只走磁盘，不走文件索引 ---------- */

	async listDir(dir) {
		const adapter = this.app.vault.adapter;
		try {
			return await adapter.list(dir);
		} catch (e) {
			if (dir === '') {
				try {
					return await adapter.list('/');
				} catch (e2) {
					console.error('[cpp-input-protection] 列目录失败:', dir, e2);
				}
			} else {
				console.error('[cpp-input-protection] 列目录失败:', dir, e);
			}
			return { files: [], folders: [] };
		}
	}

	/*
	 * 扫描整个库，返回按笔记分组的备份列表：
	 *   [{ notePath, noteName, backups: [{ path, name, label, stamp }] }]
	 * 每组内按时间倒序（最新的在前），组间按路径排序。
	 */
	async scanBackups() {
		const found = [];
		const queue = [''];
		let guard = 0;
		while (queue.length > 0 && guard < 2000) {
			guard++;
			const dir = queue.shift();
			const res = await this.listDir(dir);
			for (const f of res.files || []) {
				const info = parseBackupPath(f);
				if (info) found.push(info);
			}
			for (const sub of res.folders || []) {
				const base = sub.slice(sub.lastIndexOf('/') + 1);
				// 插件目录与回收站不扫
				if (base === '.obsidian' || base === '.trash' || base === '.git') continue;
				queue.push(sub);
			}
		}

		const map = new Map();
		for (const b of found) {
			if (map.has(b.notePath)) map.get(b.notePath).push(b);
			else map.set(b.notePath, [b]);
		}

		const groups = [];
		map.forEach((backups, notePath) => {
			backups.sort((a, b) => b.stamp.localeCompare(a.stamp));
			groups.push({
				notePath: notePath,
				noteName: notePath.slice(notePath.lastIndexOf('/') + 1),
				backups: backups,
			});
		});
		groups.sort((a, b) => a.notePath.localeCompare(b.notePath, 'zh'));
		return groups;
	}

	// 单篇笔记的备份：只列它所在的那个目录，快
	async listBackupsFor(notePath) {
		const idx = notePath.lastIndexOf('/');
		const dir = idx === -1 ? '' : notePath.slice(0, idx);
		const res = await this.listDir(dir);
		const prefix = notePath + '.bak-';
		const out = [];
		for (const f of res.files || []) {
			if (f.indexOf(prefix) !== 0) continue;
			const info = parseBackupPath(f);
			if (info) out.push(info);
		}
		out.sort((a, b) => b.stamp.localeCompare(a.stamp));
		return out;
	}

	/* ---------- 还原 ---------- */

	// 弹确认框：notePath 目标笔记，backup 由 parseBackupPath 得到，total 同目录备份数（可选）
	confirmRestore(notePath, backup, total) {
		if (!backup) {
			new Notice('请先选择一份备份');
			return;
		}
		const target = this.app.vault.getAbstractFileByPath(notePath);
		const base = target && target.basename ? target.basename : notePath;
		new ConfirmModal(this.app, {
			title: '从备份还原',
			body:
				`将用备份覆盖「${base}」。\n\n` +
				`目标笔记：${notePath}\n` +
				`备份文件：${backup.name}\n` +
				`备份时间：${backup.label}\n` +
				(total > 1
					? `同目录下共 ${total} 份备份，本次使用上面这一份。\n\n`
					: '\n') +
				'当前内容会先自动存一份（若笔记仍在），还原后若不对还能再退回来。',
			confirmText: '确认还原',
			onConfirm: () => this.restoreFromBackup(notePath, backup),
		}).open();
	}

	async restoreFromBackup(notePath, backup) {
		const adapter = this.app.vault.adapter;
		try {
			const src = await adapter.read(backup.path);
			let cur = null;
			try {
				cur = await adapter.read(notePath);
			} catch (e) {
				cur = null; // 目标已被删除：不必为"不存在的内容"留空备份
			}
			// 还原是覆盖性操作，先强制存一份当前内容当退路
			if (cur !== null) await this.backupContentByPath(notePath, cur, true);
			const target = this.app.vault.getAbstractFileByPath(notePath);
			if (target && target.extension === 'md') {
				await this.app.vault.modify(target, src);
			} else {
				await adapter.write(notePath, src);
			}
			new Notice(`已还原「${notePath}」← ${backup.name}`);
			return true;
		} catch (e) {
			console.error('[cpp-input-protection] 还原失败:', e);
			new Notice('还原失败，详见控制台');
			return false;
		}
	}

	async repairVault(files) {
		const notice = new Notice('正在扫描并修复…', 0);
		let changedFiles = 0;
		let changedCount = 0;
		let backedUp = 0;
		try {
			for (const file of files) {
				const src = await this.app.vault.cachedRead(file);
				const { text, count } = repairText(src, this.repairOptions());
				if (count > 0) {
					if (await this.backupBeforeWrite(file, src)) backedUp++;
					await this.app.vault.modify(file, text);
					changedFiles++;
					changedCount += count;
				}
			}
		} finally {
			notice.hide();
		}
		new Notice(
			`修复完成：${changedFiles} 个文件，共 ${changedCount} 处` +
				(backedUp > 0 ? `；已备份 ${backedUp} 个` : '')
		);
	}

	/* ---------- 设置读写 ---------- */

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/* ================================================================
 * 五、设置面板
 * ================================================================ */

class BracketShieldSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('输入保护').setHeading();

		new Setting(containerEl)
			.setName('启用输入拦截')
			.setDesc('输入 < 或 [ 时阻止自动配对、HTML 解析与链接解析。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
					this.plugin.settings.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('尖括号输入即转义（写入 \\<）')
			.setDesc(
				'开启：输入 < 写入 \\<，Markdown 永不把它当 HTML，渲染结果仍是 <。' +
					'关闭：只写裸 <，仅阻止自动配对。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.escapeOnInput).onChange(async (v) => {
					this.plugin.settings.escapeOnInput = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('方括号输入即转义（写入 \\[）')
			.setDesc(
				'开启：输入 [ 写入 \\[，方括号不会被当作链接 / 脚注 / 维基链接。' +
					'注意：开启后 [[双链]] 需要手动补齐，或依靠下方「保留链接语法」放行。'
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.escapeSquareOnInput)
					.onChange(async (v) => {
						this.plugin.settings.escapeSquareOnInput = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('保留链接语法')
			.setDesc(
				'修复时跳过 [文字](地址)、[文字][引用]、[[双链]] 与 [^脚注]，' +
					'只转义 arr[5]、a[0]、[空白] 这类会被误解析的方括号。建议保持开启。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.preserveLinks).onChange(async (v) => {
					this.plugin.settings.preserveLinks = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('跳过围栏代码块')
			.setDesc('在 ``` / ~~~ 块内不转义，保持代码原样。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.skipFencedBlocks).onChange(async (v) => {
					this.plugin.settings.skipFencedBlocks = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('跳过行内代码')
			.setDesc('在 `行内代码` 中不转义，保持代码原样。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.skipInlineCode).onChange(async (v) => {
					this.plugin.settings.skipInlineCode = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('粘贴时同样转义')
			.setDesc(
				'从外部复制进来的内容（课件、网页、其他笔记）按同一套规则转义后再插入，' +
				'避免粘贴绕过键盘拦截。粘到围栏代码块或行内代码内时不处理。' +
				'关闭后粘贴保持原样，可事后再执行「修复当前笔记」。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.escapeOnPaste).onChange(async (v) => {
					this.plugin.settings.escapeOnPaste = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName('Markdown 语法抑制').setHeading();

		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'以下各项通过「输入即转义」削弱 Obsidian 的 Markdown 语法，' +
				'渲染结果不变，代价是源文件里会多出反斜杠。',
		});

		new Setting(containerEl)
			.setName('预处理指令不识别为标签')
			.setDesc(
				'只有 C/C++ 预处理指令会自动写成 \\#include 这种形式：' +
					'#include / #define / #undef / #pragma / #line / #error / #warning / ' +
					'#ifdef / #ifndef / #endif / #if / #elif / #else / #import。' +
					'不限行首，行文里提到的 #include 同样处理。' +
					'# 本身、「# 标题」、#标签 一律原样显示，不受影响。'
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.protectHashDirectives)
					.onChange(async (v) => {
						this.plugin.settings.protectHashDirectives = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('禁用斜体（仅保留列表圆点）')
			.setDesc(
				'输入 * 写入 \\*，斜体不再触发；只有在行首输入「* 加空格」时才还原为列表圆点。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.disableItalic).onChange(async (v) => {
					this.plugin.settings.disableItalic = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('禁用下划线斜体')
			.setDesc(
				'词边界处的 _ 输入即写成 \\_；变量名内部的 _（如 my_var）不受影响，源码保持干净。'
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.disableUnderscoreItalic)
					.onChange(async (v) => {
						this.plugin.settings.disableUnderscoreItalic = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('高亮仅由 === 触发')
			.setDesc(
				'输入 == 会写成 \\==，不触发高亮；连敲三个 = 时自动还原为 == 并触发高亮。'
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.highlightOnlyTriple)
					.onChange(async (v) => {
						this.plugin.settings.highlightOnlyTriple = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('反斜杠按字面显示')
			.setDesc(
				'输入 \\ 写入 \\\\，反斜杠不再吞掉后面的字符，也不再触发行末硬换行。' +
					'注意：开启后手动输入的 \\< 与 \\[ 会失效（插件自动插入的不受影响）。'
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.literalBackslash)
					.onChange(async (v) => {
						this.plugin.settings.literalBackslash = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName('已有文档修复').setHeading();

		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'已经写在笔记里的内容不会被输入拦截覆盖，需要先执行一次修复。' +
				'修复范围：<、[、==、*、_，以及 C/C++ 预处理指令。# 本身不在修复范围内。' +
				'按 Ctrl+P 打开命令面板，搜索「修复」：可修复当前笔记、整个库或选中内容。',
		});

		new Setting(containerEl)
			.setName('修复前自动备份')
			.setDesc(
				'写盘前为每个将被改动的文件生成一份「原名.md.bak-时间戳」副本，' +
				'与原文件同目录。备份扩展名不是 md，不会被当成笔记收录。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.backupBeforeRepair).onChange(async (v) => {
					this.plugin.settings.backupBeforeRepair = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('打开笔记时自动修复')
			.setDesc(
				'开启后每次打开笔记会扫描并自动转义上述符号（会写入文件）。默认关闭。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoRepairOnOpen).onChange(async (v) => {
					this.plugin.settings.autoRepairOnOpen = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName('备份与还原').setHeading();

		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'在这里直接选笔记、选备份版本还原，不必先打开那篇笔记。' +
				'备份按「原名.md.bak-时间戳」存在原笔记同目录下，' +
				'扩展名不是 md，因此不会被 Obsidian 当成笔记收录。' +
				'还原属于覆盖性操作：执行前会强制把当前内容再存一份，错了还能退回来。',
		});

		const restoreWrap = containerEl.createDiv();
		this.initRestoreSection(restoreWrap);

		new Setting(containerEl).setName('其他').setHeading();

		new Setting(containerEl)
			.setName('加载时显示提示')
			.setDesc(
				'插件被 Obsidian 加载时弹一次提示，用于确认插件是否真的生效。排查完可关闭。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showLoadNotice).onChange(async (v) => {
					this.plugin.settings.showLoadNotice = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('切换时显示提示')
			.setDesc('使用「切换：括号输入保护」命令时弹出提示。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showNoticeOnToggle).onChange(async (v) => {
					this.plugin.settings.showNoticeOnToggle = v;
					await this.plugin.saveSettings();
				})
			);
	}

	/* ---------- 「备份与还原」区块：在设置里选笔记 / 选版本 ---------- */

	async initRestoreSection(containerEl) {
		this.backupState = { groups: [], note: null, backup: null };
		const statusEl = containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: '正在扫描备份…',
		});
		const box = containerEl.createDiv();

		await this.loadBackupGroups(statusEl);

		const groups = this.backupState.groups;
		if (groups.length === 0) return;

		// 默认选中当前打开的笔记；没有就选第一项
		const active = this.app.workspace.getActiveFile();
		this.backupState.note =
			groups.find((g) => active && g.notePath === active.path) || groups[0];
		this.backupState.backup = this.backupState.note.backups[0];
		this.renderRestoreControls(box, statusEl);
	}

	async loadBackupGroups(statusEl) {
		statusEl.setText('正在扫描备份…');
		try {
			this.backupState.groups = await this.plugin.scanBackups();
		} catch (e) {
			console.error('[cpp-input-protection] 扫描备份失败:', e);
			this.backupState.groups = [];
		}
		const groups = this.backupState.groups;
		const total = groups.reduce((n, g) => n + g.backups.length, 0);
		statusEl.setText(
			groups.length > 0
				? `已找到 ${groups.length} 篇笔记、共 ${total} 份备份。`
				: '没有找到任何备份。开启「修复前自动备份」后，执行过一次修复才会生成。'
		);
	}

	renderRestoreControls(box, statusEl) {
		box.empty();
		const st = this.backupState;
		const noteBox = box.createDiv();
		const bakBox = box.createDiv();
		const actBox = box.createDiv();

		const fillBackups = () => {
			bakBox.empty();
			st.backup = st.note.backups[0];
			new Setting(bakBox)
				.setName('选择备份版本')
				.setDesc('按时间倒序，默认最新的一份。想回到更早的版本就换一个。')
				.addDropdown((dd) => {
					st.note.backups.forEach((b, i) => {
						dd.addOption(b.path, `${b.label}${i === 0 ? '（最新）' : ''}`);
					});
					dd.setValue(st.backup.path);
					dd.onChange((v) => {
						const hit = st.note.backups.find((b) => b.path === v);
						if (hit) st.backup = hit;
					});
				});
		};

		new Setting(noteBox)
			.setName('选择要还原的笔记')
			.setDesc('列出库内所有存在备份的笔记，按路径排序。')
			.addDropdown((dd) => {
				st.groups.forEach((g) => {
					dd.addOption(g.notePath, `${g.notePath}　·　${g.backups.length} 份`);
				});
				dd.setValue(st.note.notePath);
				dd.onChange((v) => {
					const hit = st.groups.find((g) => g.notePath === v);
					if (hit) st.note = hit;
					fillBackups();
				});
			});

		fillBackups();

		new Setting(actBox)
			.setName('执行还原')
			.setDesc(
				'用选中的备份覆盖该笔记。执行前会强制把当前内容另存一份，' +
					'所以选错了还能再还原回来。'
			)
			.addButton((b) =>
				b
					.setButtonText('还原到选中备份')
					.setWarning()
					.onClick(() => {
						this.plugin.confirmRestore(
							st.note.notePath,
							st.backup,
							st.note.backups.length
						);
					})
			)
			.addButton((b) =>
				b.setButtonText('刷新列表').onClick(async () => {
					b.setDisabled(true);
					await this.loadBackupGroups(statusEl);
					if (this.backupState.groups.length === 0) {
						box.empty();
						return;
					}
					const keep = this.backupState.groups.find(
						(g) => g.notePath === st.note.notePath
					);
					this.backupState.note = keep || this.backupState.groups[0];
					this.renderRestoreControls(box, statusEl);
				})
			);
	}
}

module.exports = BracketShieldPlugin;
