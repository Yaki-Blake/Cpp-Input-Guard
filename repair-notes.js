'use strict';
/*
 * 直接修复 Obsidian 库中的笔记文件（不依赖插件是否加载）。
 *
 * 用法：
 *   node repair-notes.js            → 只扫描统计，列出有问题的文件
 *   node repair-notes.js --fix      → 实际写入（每个文件先备份为 .md.bak-<时间戳>）
 *   node repair-notes.js --fix --all → 修复全部；默认只修复 TARGET 指定的单篇
 *
 * 转义规则与插件一致：< 后面不是空白/数字/等号才转义；
 * 围栏代码块与行内代码内部一律不改。
 */

const fs = require('fs');
const path = require('path');

// ======== 使用前修改：你的 Obsidian 库路径 ========
const VAULT = ''; // 例：'D:/MyVault'
const TARGET_REL = ''; // 可选：单篇笔记的相对路径，例：'notes/example.md'
// ================================================

if (!VAULT) {
	console.error('请先在脚本顶部把 VAULT 填成你的 Obsidian 库路径，例如：');
	console.error("  const VAULT = 'D:/MyVault';");
	process.exit(1);
}

const TARGET = TARGET_REL ? path.join(VAULT, TARGET_REL) : null;
const SKIP_DIRS = ['.obsidian', '.trash', 'copilot'];

const HTML_LIKE_LT = /(\\?)<(?![\s\d=])/g;

/*
 * 判断一行是否为「围栏代码块边界」，返回 '`' / '~' / null。
 * 关键：按 CommonMark 规范，围栏起始标记之后不能含有同种字符。
 * 否则 ```` ```有个建议...``` ```` 这种「一行里用三个反引号包裹文字」
 * 会被误判成代码块开始，导致其后所有内容被跳过。
 */
function matchFence(line) {
	let m = line.match(/^\s{0,3}(`{3,})[^`]*$/);
	if (m) return m[1].charAt(0);
	m = line.match(/^\s{0,3}(~{3,})[^~]*$/);
	if (m) return m[1].charAt(0);
	return null;
}

function escapeOutsideInlineCode(line, counter) {
	const parts = line.split(/(`+[^`]*`+)/g);
	for (let i = 0; i < parts.length; i += 2) {
		parts[i] = parts[i].replace(HTML_LIKE_LT, (match, backslash) => {
			if (backslash) return match;
			counter.n++;
			return '\\<';
		});
	}
	return parts.join('');
}

function repairText(text) {
	const counter = { n: 0 };
	const lines = text.split('\n');
	const out = new Array(lines.length);
	let openFence = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const c = matchFence(line);
		if (c) {
			if (openFence === null) openFence = c;
			else if (openFence === c) openFence = null;
			out[i] = line;
			continue;
		}
		if (openFence !== null) {
			out[i] = line;
			continue;
		}
		out[i] = escapeOutsideInlineCode(line, counter);
	}
	return { text: out.join('\n'), count: counter.n };
}

function walk(dir, acc) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (e) {
		return acc;
	}
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (SKIP_DIRS.includes(e.name)) continue;
			walk(p, acc);
		} else if (e.name.endsWith('.md') && !e.name.includes('.bak-')) {
			acc.push(p);
		}
	}
	return acc;
}

const args = process.argv.slice(2);
const doFix = args.includes('--fix');
const fixAll = args.includes('--all');
const stamp = new Date()
	.toISOString()
	.replace(/[-:T]/g, '')
	.slice(0, 14);

/* ---------- 1. 目标文件（可选） ---------- */
console.log('=== 目标文件 === ' + (TARGET || '（未配置 TARGET_REL，跳过）'));
if (TARGET) console.log(TARGET);
if (TARGET && fs.existsSync(TARGET)) {
	const src = fs.readFileSync(TARGET, 'utf8');
	const r = repairText(src);
	console.log('需修复: ' + r.count + ' 处');
	if (r.count > 0 && (doFix || !fixAll)) {
		if (doFix) {
			const bak = TARGET + '.bak-' + stamp;
			fs.copyFileSync(TARGET, bak);
			fs.writeFileSync(TARGET, r.text, 'utf8');
			console.log('已写入修复，备份: ' + path.basename(bak));
		} else {
			console.log('（未加 --fix，仅扫描）');
		}
	}
} else if (TARGET) {
	console.log('文件不存在');
}

/* ---------- 2. 全库扫描 ---------- */
const files = walk(VAULT, []);
const needFix = [];
let totalHits = 0;

for (const f of files) {
	if (TARGET && !fixAll && f === TARGET) continue; // 已单独处理
	const c = repairText(fs.readFileSync(f, 'utf8'));
	if (c.count > 0) {
		needFix.push({ file: f, count: c.count });
		totalHits += c.count;
	}
}

console.log('\n=== 全库扫描 ===');
console.log('Markdown 文件总数: ' + files.length);
console.log('仍存在问题的文件: ' + needFix.length + ' 个，合计 ' + totalHits + ' 处');

needFix.sort((a, b) => b.count - a.count);
for (const { file, count } of needFix.slice(0, 30)) {
	console.log('  ' + String(count).padStart(4) + ' 处  ' + path.relative(VAULT, file));
}
if (needFix.length > 30) console.log('  ... 还有 ' + (needFix.length - 30) + ' 个文件');

if (doFix && fixAll) {
	console.log('\n=== 开始批量修复 ===');
	for (const { file } of needFix) {
		const src = fs.readFileSync(file, 'utf8');
		const r = repairText(src);
		fs.copyFileSync(file, file + '.bak-' + stamp);
		fs.writeFileSync(file, r.text, 'utf8');
		console.log('  已修复 ' + path.relative(VAULT, file));
	}
	console.log('批量修复完成。');
} else if (needFix.length > 0) {
	console.log('\n加 --fix --all 可批量修复全部文件。');
}
