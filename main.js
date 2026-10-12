'use strict';

/*
 * Angle Bracket Shield
 * ---------------------------------------------------------------
 * 解决两类问题：
 *
 * 【A】新输入：在编辑模式输入 `<` 时立即拦截，
 *      既不让 Obsidian 自动配对成 `<>`，也不让它变成 HTML 标签。
 *
 * 【B】旧文档：已经写在笔记里的 `vector<int>` / `complex<int>` 之类，
 *      渲染时会被当成未闭合 HTML 标签，把后续内容全部吞进该元素，
 *      导致列表、标题、段落全部失效（实时预览与阅读模式都崩）。
 *      提供「一键修复」把普通文本里的 `<` 转义成 `\<`，
 *      代码块与行内代码内部一律跳过，保持代码原样。
 *
 * 拦截实现：在 document 捕获阶段监听 keydown，早于 CodeMirror 6 的
 *          closeBrackets / inputHandler 拿到事件，因此能可靠地"抢"下输入。
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
	enabled: true,           // 输入拦截总开关
	escapeOnInput: true,     // 输入 < 时写入 \<（false 则只写裸 <）
	skipFencedBlocks: true,  // 跳过 ``` / ~~~ 围栏代码块
	skipInlineCode: true,    // 跳过 `行内代码`
	showNoticeOnToggle: true,
	showLoadNotice: true,    // 加载时弹提示，用于确认插件是否生效
	autoRepairOnOpen: false, // 打开笔记时自动修复（会写盘，默认关闭）
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
 * 二、文档修复：把会被当作 HTML 的 < 转义掉
 * ================================================================ */

// 命中条件：< 后面不是空白 / 数字 / 等号。
// 这样 `a < b`、`x <= y`、`<3` 保持原样不动，
// 而 `vector<int>`、`less<类型>`、`<div>` 会被转义。
const HTML_LIKE_LT = /(\\?)<(?![\s\d=])/g;

// 逐段处理一行：反引号包裹的段原样保留，其余段执行转义
function escapeOutsideInlineCode(line, counter) {
	const parts = line.split(/(`+[^`]*`+)/g); // 偶数索引 = 非代码段
	for (let i = 0; i < parts.length; i += 2) {
		parts[i] = parts[i].replace(HTML_LIKE_LT, (match, backslash) => {
			if (backslash) return match; // 已经转义过，跳过
			counter.n++;
			return '\\<';
		});
	}
	return parts.join('');
}

// 修复整篇文档；返回 { text, count }
function repairText(text) {
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

		out[i] = escapeOutsideInlineCode(line, counter);
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
 * 四、插件主体
 * ================================================================ */

class AngleBracketShieldPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.addSettingTab(new AngleBracketShieldSettingTab(this.app, this));

		/* --- 命令 1：输入拦截开关 --- */
		this.addCommand({
			id: 'toggle-shield',
			name: '切换：尖括号输入保护',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				if (this.settings.showNoticeOnToggle) {
					new Notice(`尖括号保护已${this.settings.enabled ? '开启' : '关闭'}`);
				}
			},
		});

		/* --- 命令 2：修复当前笔记 --- */
		this.addCommand({
			id: 'repair-current-note',
			name: '修复当前笔记：转义会被当作 HTML 的 <',
			editorCallback: (editor) => {
				const { text, count } = repairText(editor.getValue());
				if (count === 0) {
					new Notice('当前笔记无需修复');
					return;
				}
				const lastLine = editor.lastLine();
				editor.replaceRange(
					text,
					{ line: 0, ch: 0 },
					{ line: lastLine, ch: editor.getLine(lastLine).length }
				);
				new Notice(`已修复 ${count} 处尖括号（Ctrl+Z 可撤销）`);
			},
		});

		/* --- 命令 3：修复整个库 --- */
		this.addCommand({
			id: 'repair-vault',
			name: '修复整个库：转义所有会被当作 HTML 的 <',
			callback: () => {
				const files = this.app.vault.getMarkdownFiles();
				new ConfirmModal(this.app, {
					title: '批量修复整个库',
					body:
						`将扫描本库全部 ${files.length} 个 Markdown 文件，` +
						'把普通文本里会被当作 HTML 标签的 < 转义成 \\<。\n\n' +
						'代码块与行内代码内部不会改动，仅修改确有问题的文件。' +
						'建议先在单个文件上试用一次再执行。',
					confirmText: '开始修复',
					onConfirm: () => this.repairVault(files),
				}).open();
			},
		});

		/* --- 命令 4：修复选区 --- */
		this.addCommand({
			id: 'escape-selection',
			name: '转义选区中的 <',
			editorCheckCallback: (checking, editor) => {
				const selection = editor.getSelection();
				if (!selection || selection.indexOf('<') === -1) return false;
				if (!checking) {
					const { text, count } = repairText(selection);
					editor.replaceSelection(text);
					new Notice(count > 0 ? `已修复 ${count} 处` : '选区无需修复');
				}
				return true;
			},
		});

		/* --- 命令 3：修复当前文件（阅读模式也可用） --- */
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
				const { text, count } = repairText(src);
				if (count === 0) {
					new Notice('当前文件无需修复');
					return;
				}
				await this.app.vault.modify(file, text);
				new Notice(`已修复「${file.basename}」${count} 处尖括号`);
			},
		});

		/* --- 核心：捕获阶段拦截 `<` --- */
		this.keydownHandler = this.handleKeydown.bind(this);
		this.registerDomEvent(document, 'keydown', this.keydownHandler, true);

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
			new Notice('Angle Bracket Shield 已加载，Ctrl+P 搜「修复」即可使用');
		}
	}

	/* ---------- 输入拦截 ---------- */

	handleKeydown(evt) {
		const s = this.settings;
		if (!s.enabled) return;
		if (evt.defaultPrevented || evt.isComposing || evt.keyCode === 229) return;
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
		if (evt.key !== '<') return;

		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		if (!target.closest('.cm-content')) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.editor) return;
		const editor = view.editor;
		const cursor = editor.getCursor();

		if (s.skipFencedBlocks && isInsideFencedBlock(editor, cursor.line, cursor.ch)) return;
		if (s.skipInlineCode) {
			const lineText = editor.getLine(cursor.line);
			if (isInsideInlineCode(lineText, cursor.ch)) return;
		}

		evt.preventDefault();
		evt.stopPropagation();

		let insertText = '<';
		if (s.escapeOnInput) {
			const lineText = editor.getLine(cursor.line);
			const prevChar = cursor.ch > 0 ? lineText.charAt(cursor.ch - 1) : '';
			insertText = prevChar === '\\' ? '<' : '\\<';
		}
		editor.replaceSelection(insertText);
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

			const { text, count } = repairText(src);
			if (count > 0) {
				await this.app.vault.modify(file, text);
				new Notice(`已自动修复「${file.basename}」${count} 处尖括号`);
			}
		} catch (e) {
			console.error('[angle-bracket-shield] 自动修复失败:', file.path, e);
		}
	}

	async repairVault(files) {
		const notice = new Notice('正在扫描并修复…', 0);
		let changedFiles = 0;
		let changedCount = 0;
		try {
			for (const file of files) {
				const src = await this.app.vault.cachedRead(file);
				const { text, count } = repairText(src);
				if (count > 0) {
					await this.app.vault.modify(file, text);
					changedFiles++;
					changedCount += count;
				}
			}
		} finally {
			notice.hide();
		}
		new Notice(`修复完成：${changedFiles} 个文件，共 ${changedCount} 处`);
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

class AngleBracketShieldSettingTab extends PluginSettingTab {
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
			.setDesc('输入 < 时阻止自动配对与 HTML 解析。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
					this.plugin.settings.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('输入即转义（写入 \\<）')
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

		new Setting(containerEl).setName('已有文档修复').setHeading();

		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text:
				'已经写在笔记里的内容不会被输入拦截覆盖，需要先执行一次修复。' +
				'按 Ctrl+P 打开命令面板，搜索「修复」：可修复当前笔记、整个库或选中内容。',
		});

		new Setting(containerEl)
			.setName('打开笔记时自动修复')
			.setDesc(
				'开启后每次打开笔记会扫描并自动转义出问题的 <（会写入文件）。默认关闭。'
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoRepairOnOpen).onChange(async (v) => {
					this.plugin.settings.autoRepairOnOpen = v;
					await this.plugin.saveSettings();
				})
			);

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
			.setDesc('使用「切换：尖括号输入保护」命令时弹出提示。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showNoticeOnToggle).onChange(async (v) => {
					this.plugin.settings.showNoticeOnToggle = v;
					await this.plugin.saveSettings();
				})
			);
	}
}

module.exports = AngleBracketShieldPlugin;
