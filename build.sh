#!/bin/bash
# 打包 JupyterHub Remote 插件

cd "$(dirname "$0")"

echo "正在编译 TypeScript..."
npm run compile

echo ""
echo "正在打包插件..."
vsce package --allow-missing-repository --allow-star-activation

echo ""
echo "✅ 打包完成！"
echo "插件文件：jupyterhub-remote-extension-0.1.0.vsix"
echo ""
echo "安装命令："
echo "code --install-extension ./jupyterhub-remote-extension-0.1.0.vsix"
