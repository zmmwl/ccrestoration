#!/bin/bash
# Claude Code 功能测试脚本

echo "🧪 Claude Code 功能测试"
echo "========================="
echo ""

# 测试 1: 版本检查
echo "📋 测试 1: 版本检查"
./run.sh --version
if [ $? -eq 0 ]; then
    echo "✅ 版本检查通过"
else
    echo "❌ 版本检查失败"
fi
echo ""

# 测试 2: 帮助信息
echo "📖 测试 2: 帮助信息"
./run.sh --help | head -10
if [ $? -eq 0 ]; then
    echo "✅ 帮助信息正常"
else
    echo "❌ 帮助信息失败"
fi
echo ""

# 测试 3: 检查主要文件
echo "📁 测试 3: 检查主要文件"
FILES_TO_CHECK=(
    "package/cli.js"
    "src/main.tsx"
    "run.sh"
    "restoration.md"
)

for file in "${FILES_TO_CHECK[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file 存在"
    else
        echo "❌ $file 缺失"
    fi
done
echo ""

# 测试 4: 检查目录结构
echo "📂 测试 4: 检查目录结构"
DIRS_TO_CHECK=(
    "src"
    "package"
    "extracted_sources"
)

for dir in "${DIRS_TO_CHECK[@]}"; do
    if [ -d "$dir" ]; then
        echo "✅ $dir 目录存在"
    else
        echo "❌ $dir 目录缺失"
    fi
done
echo ""

# 测试 5: 环境检查
echo "🔍 测试 5: 环境检查"
echo "  - Node.js: $(node --version)"
echo "  - Bun: $(export PATH="$HOME/.bun/bin:$PATH"; bun --version 2>/dev/null || echo '未安装')"
echo "  - 工作目录: $(pwd)"
echo ""

# 测试 6: 源代码统计
echo "📊 测试 6: 源代码统计"
echo "  - TypeScript 文件: $(find src -name '*.ts' | wc -l)"
echo "  - TSX 文件: $(find src -name '*.tsx' | wc -l)"
echo "  - 总源文件: $(find src -type f | wc -l)"
echo "  - 代码行数: $(find src -name '*.ts' -o -name '*.tsx' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"
echo ""

echo "========================="
echo "✨ 测试完成！"
