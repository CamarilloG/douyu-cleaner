const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const core = read('src/native-repeat.js');
const start = '// BEGIN SHARED NATIVE REPEAT';
const end = '// END SHARED NATIVE REPEAT';
const shared = `${start}\n${core}\n${end}`;
let douyu = read('douyu-cleaner.user.js');
const a = douyu.indexOf(start), b = douyu.indexOf(end);
if (a >= 0 && b >= a) douyu = douyu.slice(0, a) + shared + douyu.slice(b + end.length);
else douyu = douyu.replace('// ==/UserScript==', `// ==/UserScript==\n\n${shared}`);
const base = 'https://raw.githubusercontent.com/CamarilloG/douyu-cleaner/main';
const huya = `// ==UserScript==
// @name         虎牙直播间纯净增强
// @namespace    https://github.com/CamarilloG/douyu-cleaner
// @version      0.1.0
// @description  保留官方播放器和弹幕，原生弹幕悬停复读 +1、可选纯净布局与一键恢复。
// @match        https://www.huya.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// @updateURL    ${base}/huya-cleaner.user.js
// @downloadURL  ${base}/huya-cleaner.user.js
// @supportURL   https://github.com/CamarilloG/douyu-cleaner/issues
// ==/UserScript==

${shared}

${read('src/huya.js')}`;
fs.writeFileSync(path.join(root, 'douyu-cleaner.user.js'), douyu);
fs.writeFileSync(path.join(root, 'huya-cleaner.user.js'), huya);
console.log('Built douyu-cleaner.user.js and huya-cleaner.user.js');
