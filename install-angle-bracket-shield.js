'use strict';
// 安装脚本：把 Angle Bracket Shield 复制进目标库并加入已启用列表
const fs = require('fs');
const path = require('path');

// ======== 使用前修改：你的 Obsidian 库路径 ========
const VAULT = ''; // 例：'D:/MyVault'
// ================================================

if (!VAULT) {
	console.error('请先在脚本顶部把 VAULT 填成你的 Obsidian 库路径，例如：');
	console.error("  const VAULT = 'D:/MyVault';");
	process.exit(1);
}

const SRC = path.join(__dirname, 'angle-bracket-shield');
const PLUGIN_ID = 'angle-bracket-shield';
const DEST = path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID);

// ---- 1. 复制插件文件（存在则覆盖，不删除任何其他内容）----
fs.mkdirSync(DEST, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'versions.json', 'README.md']) {
	const from = path.join(SRC, f);
	if (!fs.existsSync(from)) throw new Error('缺少源文件: ' + from);
	fs.copyFileSync(from, path.join(DEST, f));
}

// ---- 2. 备份并更新 community-plugins.json ----
const cpFile = path.join(VAULT, '.obsidian', 'community-plugins.json');
const stamp = new Date()
	.toISOString()
	.replace(/[-:T]/g, '')
	.slice(0, 14);
const bakFile = cpFile + '.bak-' + stamp;
fs.copyFileSync(cpFile, bakFile);

const enabled = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
if (!Array.isArray(enabled)) throw new Error('community-plugins.json 不是数组');
if (!enabled.includes(PLUGIN_ID)) enabled.push(PLUGIN_ID);
fs.writeFileSync(cpFile, JSON.stringify(enabled, null, 2) + '\n', 'utf8');

// ---- 3. 校验 ----
const manifest = JSON.parse(fs.readFileSync(path.join(DEST, 'manifest.json'), 'utf8'));
const after = JSON.parse(fs.readFileSync(cpFile, 'utf8'));

console.log('目标目录   : ' + DEST);
console.log('已复制文件 : ' + fs.readdirSync(DEST).join(', '));
console.log('备份文件   : ' + path.basename(bakFile));
console.log('插件ID     : ' + manifest.id + '  v' + manifest.version);
console.log('最低版本   : ' + manifest.minAppVersion);
console.log('启用列表   : ' + JSON.stringify(after));
console.log('状态       : ' + (after.includes(PLUGIN_ID) ? '已启用 OK' : '启用失败'));
