# Live2D 实验资源说明

当前 Live2D 实验使用以下固定版本和示例资源：

- Live2D Cubism Core for Web：Live2D Inc. 提供的 Web 运行库。
- PixiJS 6.5.10：MIT License。
- pixi-live2d-display 0.4.0：MIT License。
- Haru、Hiyori、Ren、Rice 示例模型：Live2D Inc. 的 Free Material License。

相关条款：

- https://www.live2d.com/en/sdk/license/
- https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
- https://github.com/pixijs/pixijs
- https://github.com/guansss/pixi-live2d-display

示例模型来自 Live2D 官方 `CubismWebSamples/Samples/Resources`。纹理已缩小至 1024
像素以降低内存占用。

## Hiyori 额外表情动作

`assets/live2d/hiyori/motion/` 下 7 条 `Action` 组动作（开心、眨眼、点头、思考、惊讶、害羞、摇头）由
[shinshin86/live2d-add-motion-sample-web-ui](https://github.com/shinshin86/live2d-add-motion-sample-web-ui)
的定义脚本生成（MIT；仅动作 JSON，不含模型）。模型本体仍受 Live2D Free Material License 约束。

`models.json` 中 Hiyori 已将 `Action` 加入 `randomMotions`（待机随机播放）。

## 动作配置（`models.json`）

每个角色可配置：

- `tapMotion`：点击/坐下反应（字符串，动作组名）
- `randomMotions`：站立空闲时随机播放的动作组列表

## 导入自定义动作

1. 在 Cubism Editor 中制作 `.motion3.json`，或像 Hiyori `Action` 一样用手写参数曲线生成。
2. 编辑对应 `*.model3.json` 的 `FileReferences.Motions`，新增分组或追加到现有组。
3. 在 `assets/live2d/models.json` 里把该分组加入 `tapMotion` 或 `randomMotions`。
4. 重新打包或重启应用后生效。

这些文件目前仅用于个人、本地实验。公开发布、上传模型或商业使用前，需要重新核对当时有效的 SDK 与模型许可。
