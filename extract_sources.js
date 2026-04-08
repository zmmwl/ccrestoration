#!/usr/bin/env node
/**
 * 从 source map 文件中提取原始源代码
 * 用法: node extract_sources.js
 */

const fs = require('fs');
const path = require('path');

// 读取 source map 文件
console.log('🔍 正在读取 source map 文件...');
const mapContent = fs.readFileSync('package/cli.js.map', 'utf8');
const sourceMap = JSON.parse(mapContent);

console.log(`✅ Source map 版本: ${sourceMap.version}`);
console.log(`📊 发现 ${sourceMap.sources.length} 个源文件`);
console.log(`💾 包含源代码内容: ${sourceMap.sourcesContent ? '是' : '否'}`);

// 创建输出目录
const outputDir = './extracted_sources';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 提取每个源文件
let successCount = 0;
let errorCount = 0;
let skipCount = 0;

console.log('🚀 开始提取源文件...');
console.log('━'.repeat(60));

sourceMap.sources.forEach((sourcePath, index) => {
    try {
        // 获取源代码内容
        const content = sourceMap.sourcesContent[index];
        if (!content) {
            skipCount++;
            if (skipCount <= 10) {
                console.log(`⏭️  跳过: ${sourcePath} (无内容)`);
            }
            return;
        }

        // 构建输出文件路径
        const safePath = sourcePath
            .replace(/\.\./g, '') // 移除 .. 避免路径遍历
            .replace(/\//g, path.sep); // 转换路径分隔符

        const outputPath = path.join(outputDir, safePath);

        // 创建目录结构
        const outputFileDir = path.dirname(outputPath);
        if (!fs.existsSync(outputFileDir)) {
            fs.mkdirSync(outputFileDir, { recursive: true });
        }

        // 写入文件
        fs.writeFileSync(outputPath, content, 'utf8');
        successCount++;

        // 显示进度
        if (successCount % 500 === 0) {
            console.log(`📦 已处理: ${successCount}/${sourceMap.sources.length} 文件`);
        }
    } catch (error) {
        errorCount++;
        console.error(`❌ 错误处理 ${sourcePath}:`, error.message);
    }
});

console.log('━'.repeat(60));
console.log('🎉 提取完成！');
console.log(`✅ 成功: ${successCount} 个文件`);
console.log(`⏭️  跳过: ${skipCount} 个文件`);
console.log(`❌ 失败: ${errorCount} 个文件`);
console.log(`📁 输出目录: ${outputDir}`);
