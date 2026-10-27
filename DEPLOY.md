# 部署说明

`docs/` 是一个零依赖的纯静态网站（无需构建、无外部资源），任何静态托管都能直接跑。
下面给出三种方式，**推荐 GitHub Pages**：仓库和网站放在一起，推送即上线。

---

## 一、推送到 GitHub

### 1. 本地已经是一个 git 仓库

```bash
git log --oneline          # 查看已有提交
git remote -v              # 默认没有远端
```

### 2. 在 GitHub 上新建空仓库

打开 <https://github.com/new>，Repository name 填 `imagegrab`，
**不要**勾选 README / .gitignore / License（保持空仓库），创建后拿到仓库地址：

```
https://github.com/<你的用户名>/imagegrab.git
```

### 3. 关联远端并推送

```bash
git remote add origin https://github.com/<你的用户名>/imagegrab.git
git branch -M main
git push -u origin main
```

首次推送会要求登录：用户名填 GitHub 用户名，密码填 **Personal Access Token**（不是登录密码）。
令牌在 GitHub → Settings → Developer settings → Personal access tokens 里创建，
经典令牌勾选 `repo` 即可。

> 也可以用仓库里的一键脚本（会提示输入仓库地址和令牌）：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File tools/push-to-github.ps1
> ```

---

## 二、部署官网（GitHub Pages）

推送完成后，两种方式开启 Pages：

### 方式 A：网页操作（1 分钟）

1. 仓库 → **Settings** → 左侧 **Pages**；
2. Source 选 **Deploy from a branch**；
3. Branch 选 `main`，目录选 **`/docs`**，点 **Save**；
4. 等 1～2 分钟，访问：

```
https://<你的用户名>.github.io/imagegrab/
```

### 方式 B：命令行（GitHub CLI）

```bash
gh api --method POST repos/<用户名>/imagegrab/pages \
  -f 'source[branch]=main' -f 'source[path]=/docs'
```

### 方式 C：把 docs 作为根目录发布

如果希望网址里不带 `/imagegrab/` 前缀，可以新建 `gh-pages` 分支并只放 `docs/` 的内容：

```bash
git subtree push --prefix docs origin gh-pages
```

然后在 Settings → Pages 里把分支选成 `gh-pages` / `/(root)`。

---

## 三、其它平台

| 平台 | 做法 |
| --- | --- |
| **Vercel** | 导入仓库 → Framework 选 Other → Root Directory 填 `docs` → Deploy，自动得到 `xxx.vercel.app` |
| **Cloudflare Pages** | 创建项目 → 连接仓库 → Build command 留空、Build output directory 填 `docs` |
| **Netlify** | New site from Git → Publish directory 填 `docs`，构建命令留空 |
| **任意外网服务器** | 把 `docs/` 整个目录上传到站点根目录即可（纯静态，无后端） |

---

## 四、部署后自检清单

- [ ] 首页 Hero、功能卡片、安装步骤三个区块正常显示
- [ ] 手机端（<768px）导航折叠成汉堡菜单，点击可展开
- [ ] 「下载插件」按钮能下载到 `docs/downloads/imagegrab-v1.0.0.zip`
- [ ] 刷新后图片、样式、脚本都没有 404

## 五、改内容

| 想改什么 | 位置 |
| --- | --- |
| 主色调 / 圆角 / 阴影 | `docs/css/style.css` 顶部 `:root` 里的 CSS 变量 |
| 文案、功能卡片 | `docs/index.html` 对应区块文字 |
| 仓库链接（页脚与「查看源码」） | `docs/index.html` 中 `https://github.com/` 占位地址 |
| 插件下载包 | 重新执行 `python tools/package.py` |
