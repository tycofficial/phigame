# PHIGAME · 音游球

根据参考视频后半段制作的自动弹球 Web App。打开即开始，无需手动接球。

- 蓝键 Tap：反弹，碰过后消失。
- 红键 Flick：向随机方向反弹，同时加速。
- 黄键 Drag：沿原方向穿过，同时加速。
- 长条 Hold：锁定在长条上，竖直缓慢贯穿，尾端释放。

默认四色混合；设置中可切换视频蓝键和各单色模式。支持暂停、重开、速度调整、打击音效、随机路线和全屏。iPad Safari 不支持原生全屏时使用沉浸布局。

## 本地运行

需要 Node.js 20 以上，不需要第三方 npm 依赖。

```sh
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

## 自动部署

游戏网址：[https://tycofficial.github.io/phigame/](https://tycofficial.github.io/phigame/)

游戏入口直接放在仓库根目录 `index.html`，样式、脚本和所有素材使用相对路径。GitHub Pages 使用现有的 `main` 分支根目录发布设置；每次推送到 `main` 都会自动部署更新。`.github/workflows/deploy.yml` 负责验证物理规则和完整构建，GitHub 自带的 Pages 工作流负责发布。无需在页面里打开 README 或跳转到其他网站。

## 资源来源

音符贴图、打击特效和音效取自 [phigrostl/PhiVideo](https://github.com/phigrostl/PhiVideo/tree/de34e743cb9f70c728086bd696bf0aa2231fd4b7/resources/Notes)，固定上游提交 `de34e743cb9f70c728086bd696bf0aa2231fd4b7`。这些为项目收录的 Phigros 原版游戏资源；版权归 Pigeon Games。开源代码的许可证不改变游戏素材本身的权利归属。长条贴图按网页显示需要等比例缩至 494×1000，其原版设计保持不变。逐文件来源和 SHA-256 校验值见 `assets/skin/provenance.json`。

本项目为非官方粉丝游戏，与 Phigros 官方没有隶属关系。

## 实现

240 Hz 固定物理步长、扫掠碰撞检测、带种子的随机路线、与刷新率独立的模拟、单次消耗的音符、按视野回收场景。页面隐藏时停止模拟，不会切回后突然跳跃。渲染使用 Canvas 2D，纹理预处理，适配高像素密度屏幕。
