#!/usr/bin/env node
/**
 * 全面修复源代码中的导入路径
 * 将所有 "src/" 开头的路径转换为相对路径
 */

const fs = require('fs');
const path = require('path');

function fixImportsInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // 获取文件的当前目录深度（相对于 src 目录）
    const relativeToSrc = path.relative('./src', path.dirname(filePath));
    const depth = relativeToSrc === '' ? 0 : relativeToSrc.split(path.sep).length;

    // 构建回退到 src 的相对路径
    let backtrackPath = '';
    if (depth > 0) {
        backtrackPath = '../'.repeat(depth);
    }

    const originalContent = content;

    // 替换静态导入: from 'src/...
    content = content.replace(/from 'src\//g, `from '${backtrackPath}`);
    content = content.replace(/from "src\//g, `from "${backtrackPath}`);

    // 替换 import 语句: import 'src/...
    content = content.replace(/import ['"]src\//g, `import "${backtrackPath}`);

    // 替换动态导入: await import("src/...)
    content = content.replace(/await import\(["']src\//g, `await import("${backtrackPath}`);
    content = content.replace(/import\(["']src\//g, `import("${backtrackPath}`);

    // 替换 export from 语句
    content = content.replace(/export ['"]src\//g, `export "${backtrackPath}`);

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    }
    return false;
}

function findTypeScriptFiles(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...findTypeScriptFiles(fullPath));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            files.push(fullPath);
        }
    }
    return files;
}

console.log('🔧 开始修复导入路径...');
console.log('━'.repeat(60));

const srcFiles = findTypeScriptFiles('./src');
console.log(`📊 发现 ${srcFiles.length} 个 TypeScript 文件`);

let fixedCount = 0;

for (const file of srcFiles) {
    if (fixImportsInFile(file)) {
        fixedCount++;
    }
    if (fixedCount % 100 === 0) {
        console.log(`✅ 已修复: ${fixedCount} 个文件`);
    }
}

console.log('━'.repeat(60));
console.log(`🎉 修复完成！共修复 ${fixedCount} 个文件`);
