#!/bin/bash
# Claude Code 演示测试

echo "🎯 Claude Code 项目演示"
echo "======================="
echo ""

# 显示项目信息
echo "📊 项目信息:"
echo "  - 版本: $(./run.sh --version 2>&1 | grep -o '[0-9.]*')"
echo "  - 总文件数: $(find src -name '*.ts' -o -name '*.tsx' | wc -l)"
echo "  - 代码行数: $(find src -name '*.ts' -o -name '*.tsx' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')"
echo ""

# 测试基本功能
echo "🧪 功能测试:"
echo "  1. 版本命令: $(./run.sh --version >/dev/null 2>&1 && echo '✅ 通过' || echo '❌ 失败')"
echo "  2. 帮助命令: $(./run.sh --help >/dev/null 2>&1 && echo '✅ 通过' || echo '❌ 失败')"
echo ""

# 检查配置
echo "⚙️  环境配置:"
echo "  - Node.js: $(node --version)"
echo "  - Bun: $(export PATH="$HOME/.bun/bin:$PATH"; bun --version 2>/dev/null || echo '未安装')"
echo "  - 工作目录: $(pwd)"
echo ""

echo "======================="
echo "✅ 项目就绪，可以开始使用！"
echo ""
echo "🚀 快速开始命令:"
echo "  ./run.sh              # 启动交互式会话"
echo "  ./run.sh --help       # 查看帮助"
echo "  ./run.sh --version    # 查看版本"
echo ""
