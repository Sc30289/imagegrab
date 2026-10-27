# 截图与验收素材

本目录的文件与作业表单里的 6 个必填项对应关系如下。

| 表单项 | 文件 | 状态 |
| --- | --- | --- |
| 01 项目源码 | 仓库根目录 | ✅ 已完成（12 次提交） |
| 02 插件安装截图 | 建议在 `chrome://extensions` 自行截一张 | ⬜ 需要你补一张 |
| 03 与 AI 对话的截图（需求分析、方案） | —— | ⬜ 需要你在浏览器里截图（见下方说明） |
| 04 将项目推送到云端的截图 | `04-github-commits.png`、`04-github-repo.png` | ✅ 已完成 |
| 05 部署之后域名访问的网址截图 | `05-domain-home.png`、`05-domain-full.png` | ✅ 已完成 |
| 06 插件使用截图 | `06-plugin-button.png`、`06-gallery.png`、`06-plugin-scroll.png` | ✅ 已完成 |

- 仓库：<https://github.com/Sc30289/imagegrab>
- 站点：<https://sc30289.github.io/imagegrab/>

---

## 已生成的截图

| 文件 | 内容 |
| --- | --- |
| `04-github-commits.png` | GitHub 仓库的提交历史：12 次提交已推送到 `github.com/Sc30289/imagegrab` |
| `04-github-repo.png` | GitHub 仓库首页：目录结构、About 简介、README / MIT 协议识别 |
| `05-domain-home.png` | 部署后的站点首屏（`sc30289.github.io/imagegrab`） |
| `05-domain-full.png` | 部署后的站点整页，页脚可见本站域名 |
| `06-plugin-button.png` | 商品详情页右下角的「获取图片」悬浮按钮 |
| `06-plugin-scroll.png` | 向下滚动后，懒加载的详情长图已铺开，按钮常驻右下角 |
| `06-gallery.png` | 点击后打开的预览页：9 张图（含 1 张背景图），已选数量、勾选框、尺寸标注 |
| `05-site-hero.png` | 官网首屏（本地预览，1440×900） |
| `05-site-full.png` | 官网整页长图（本地预览） |
| `05-site-features.png` | 核心功能区块（本地预览） |
| `05-site-install.png` | 安装步骤区块（本地预览） |

### 这几张是怎么来的

浏览器内核从 Chromium 137 起不再允许用 `--load-extension` 启动参数加载未打包扩展，
无头浏览器里装不上扩展，所以 06 的三张图是在项目自带的**本地演示页**里跑出来的：

- 页面：`demo/product.html`（模拟电商详情页，含懒加载、背景图、1×1 干扰图）
- 脚本：`../content.js`、`../gallery.js` —— 与扩展里**完全同一份文件**，一行没改
- 补丁：`demo/harness.js` 用最小实现顶替 `chrome.runtime` / `chrome.storage`

也就是说界面、扫描逻辑、过滤逻辑、渲染逻辑都是真实的，只是扩展宿主环境用替身模拟。
如果你希望 06 用「真·扩展」的截图，装上扩展后自己按同样角度截 3 张即可（3 分钟）。

---

## 03 怎么截（AI 对话）

作业要求「你跟 AI 对话的一些截图（需求分析，方案）」，通常需要 2～3 张：

1. **需求分析**：把「我要开发一个 chrome 电商图片提取插件……」这段需求发给 AI 的对话截图；
2. **方案拆解**：AI 输出文件结构 / 技术方案（Manifest V3、内容脚本、Service Worker、PNG 转换思路）的截图；
3. 可选：**迭代优化**：例如「再给插件做一个静态官网」这一轮。

直接用系统截图工具（Win + Shift + S）框选对话区域即可。

---

## 05 怎么截（部署后的域名）

1. 按 `DEPLOY.md` 把仓库推到 GitHub，并在 Settings → Pages 选择 `main` 分支 + `/docs` 目录；
2. 等 1～2 分钟，访问 `https://<用户名>.github.io/imagegrab/`；
3. 截一张**带浏览器地址栏**的整页图（推荐用浏览器自带截图或 Win + Shift + S 框选地址栏 + 页面）。

`05-site-hero.png` 可以直接用作本地预览，但带域名的这张更有说服力。
