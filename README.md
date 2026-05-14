# Droplet Dynamics

浏览器端液滴与射流等实验视频的分析工具（轮廓、接触角、表面能等）。基于 React、TypeScript 与 Vite。

## 本地开发

```bash
npm install
npm run dev
```

```bash
npm run build   # 生产构建
npm run test    # 单元测试
npm run lint
```

## 开源到 GitHub

目标仓库：**[goodparachutes/DropletDynamics-AnalysisSystem](https://github.com/goodparachutes/DropletDynamics-AnalysisSystem)**（仓库名需与 GitHub 上完全一致，Pages 子路径才会正确）。

1. 在 GitHub 上创建公开仓库 `DropletDynamics-AnalysisSystem`（可先不加 README，避免与本地冲突）。
2. 在本地初始化并推送（若尚未 `git init`）：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/goodparachutes/DropletDynamics-AnalysisSystem.git
git push -u origin main
```

3. 按需补充 **License**、**项目描述**、**Topics** 等仓库元信息。

## GitHub Pages 部署

本仓库包含 [`.github/workflows/deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml)：在推送 `main` / `master` 时构建，并通过 **GitHub Actions** 发布到 Pages。

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment** 中，将 **Source** 设为 **GitHub Actions**（不要选 “Deploy from a branch”）。
3. 推送任意提交到 `main` 或 `master`，或在 **Actions** 里手动运行 **Deploy to GitHub Pages**。

发布后站点地址为：

**[https://goodparachutes.github.io/DropletDynamics-AnalysisSystem/](https://goodparachutes.github.io/DropletDynamics-AnalysisSystem/)**

构建时会根据仓库名自动设置 Vite 的 `base`（环境变量 `VITE_BASE_PATH`，CI 中为 `/DropletDynamics-AnalysisSystem/`）。若将来改用 **`goodparachutes.github.io`** 根域名仓库且站点在域名根路径，需要把工作流里的 `VITE_BASE_PATH` 改为 `/`（或去掉该变量）。
