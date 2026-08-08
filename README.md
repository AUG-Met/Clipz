# 剪贴板管理器 Clipboard Manager

[English version](README.en.md)

Windows 剪贴板历史管理器，常驻系统托盘，自动记录剪贴板中的文本、文件和图片。基于 Tauri + Rust + React 重构，更轻量、更稳定。

## 功能

- **自动记录** — 自动追踪剪贴板内容（文本 / 文件 / 图片）
- **系统托盘常驻** — 后台运行，**Ctrl+F1** 唤出/隐藏
- **多种点击模式** — 单击复制、双击复制、复制后自动关闭
- **历史记录搜索** — 快速搜索历史条目
- **主题切换** — 日间 / 夜间 / 跟随系统
- **中英文双语** — 界面语言自由切换
- **QuickLook 文件预览** — 选中文件后按空格键快速预览（需安装 [QuickLook](https://github.com/QL-Win/QuickLook)）
- **文件操作** — 右键菜单支持打开文件、浏览所在目录
- **文本编辑** — 预览区可直接编辑文本内容（不会保存到数据库）
- **开机静默启动** — 随系统启动并最小化到托盘

## 使用说明

1. 运行 `Clipboard Manager.exe`（安装后从开始菜单启动）
2. 程序自动最小化到系统托盘
3. 按 **Ctrl+F1** 唤出主界面
4. 点击历史记录项复制内容（支持文本 / 文件 / 图片）
5. 选中文件后按**空格键**使用 QuickLook 预览

### 设置

点击底部 **⚙ 设置** 进入：

| 设置项 | 说明 |
|--------|------|
| 语言 | 中文 / English |
| 主题 | 日间 / 夜间 / 跟随系统 |
| 全局快捷键 | 自定义唤出热键（修饰键 + 按键） |
| 点击操作方式 | 单击复制 / 单击选择双击复制 / 复制并关闭 |
| 开机静默启动 | 开启后随系统启动并最小化到托盘 |
| QuickLook 预览 | 开启后按空格键调用 QuickLook |

## 下载

从 [Releases](https://github.com/AUG-Met/clipboard-manager-tauri/releases) 下载最新版本安装包。

> 历史记录存储在 `%APPDATA%\com.clipboardmanager.app\clipboard.db`，卸载程序时请注意备份重要数据。

## 开发环境

- **前端**: React + TypeScript + Vite
- **后端**: Rust + Tauri v2
- **构建工具**: Node.js 20+, Rust 1.77+, MSVC 构建工具

### 本地开发

```bash
# 安装前端依赖
npm install

# 启动开发模式（热更新）
npm run tauri dev

# 构建生产版本
npm run tauri build
```

## 技术栈

- **前端**: React 18, TypeScript, Vite
- **后端**: Rust, Tauri v2
- **数据库**: SQLite (rusqlite)
- **剪贴板**: arboard (文本/图片), clipboard-win (文件 CF_HDROP)
- **快捷键**: rdev (全局键盘监听)
- **主题**: CSS 变量 + Windows DwmSetWindowAttribute / SetWindowTheme

## 作者

- **AUG-Met** — [GitHub](https://github.com/AUG-Met)