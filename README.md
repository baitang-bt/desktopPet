# 跨平台桌宠实验

用于验证 macOS 和 Windows 桌宠所需的基础窗口能力。当前版本使用 Electron、PixiJS 和 Live2D Cubism。

## 当前实验内容

- 透明、无边框窗口
- 可关闭的始终置顶选项
- 分别拖动桌宠和设置窗口，并自动记忆两者位置
- 四个可切换的 Live2D 示例角色、待机动作和视线跟随
- 拖到其他窗口顶部边缘时预览坐姿，松手后自动吸附并对齐；再次拖动可脱离
- 点击模型触发动作或表情
- 右键桌宠打开或关闭独立设置窗口
- 常规与外观设置，并在本机自动保存
- 设置菜单可直接关闭应用
- 菜单栏托盘图标：显示、隐藏、退出（备用入口）
- 桌宠可覆盖全屏应用（macOS 因此不显示程序坞图标，入口在菜单栏托盘）

> macOS 若无法识别其他窗口，需在「系统设置 → 隐私与安全性」中为 DesktopPet 开启辅助功能/屏幕录制（视系统版本而定）。Windows 窗口吸附需在真机再验透明坐标与 DPI。

## 本地运行

```bash
npm install
npm start
```

运行静态检查：

```bash
npm run check
```

## 打包成可双击的应用

```bash
npm run dist:mac   # 生成 macOS .app、.dmg 与自动更新用 .zip
npm run dist:win   # 生成 Windows 安装包（需在 Windows 上运行）
```

产物在 `dist/` 目录：

- `dist/mac-arm64/DesktopPet.app`：可直接双击打开
- `dist/DesktopPet-0.1.0-arm64.dmg`：拖入“应用程序”后即可使用
- `dist/DesktopPet-0.1.0-arm64-mac.zip`：供设置页自动更新使用

### 发布与检查更新（私有仓库）

更新源：`https://github.com/baitang-bt/desktopPet`（private）。

1. 创建 GitHub Token（需 `repo` 权限），发布时设置环境变量：

```bash
export GH_TOKEN=你的token
npm run publish:mac
```

2. 客户端检查更新时同样需要 Token，任选其一：
   - 环境变量：`DESKTOP_PET_GH_TOKEN` 或 `GH_TOKEN`
   - 文件：把 Token 写入应用数据目录下的 `github-token`（macOS 一般在 `~/Library/Application Support/cursor-desktop-pet/github-token`）

3. 设置 → 常规 →「检查更新」/「更新」。发现新版本后先下载，再点「安装并重启」。

当前构建未做代码签名和公证。首次打开被 Gatekeeper 拦截时，右键应用选择“打开”，或在“系统设置 → 隐私与安全性”中允许一次。

Live2D 运行库和示例模型仅用于个人实验，来源及许可见 `docs/live2d-assets.md`。

## 手工验证

1. 确认桌宠周围没有矩形背景。
2. 将其他窗口覆盖到桌宠位置，确认桌宠仍然置顶。
3. 分别拖动桌宠和设置窗口，确认两者可以独立移动。
4. 右键桌宠，确认设置窗口可以打开和关闭，并测试角色切换、大小和其他设置。
5. 修改设置和两个窗口的位置，重启后确认都能恢复。
6. 将桌宠拖到其他窗口顶部边缘，确认进入坐姿预览；松手后自动对齐，再次拖动可脱离。
7. 从托盘菜单退出，确认程序完全结束。

正式开发前还需在 Windows 真机验证透明窗口、DPI 缩放、多显示器、全屏应用行为与窗口吸附。
