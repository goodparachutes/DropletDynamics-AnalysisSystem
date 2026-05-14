# Droplet Dynamics（液滴动力学分析系统）

面向**侧视高速成像**的浏览器端分析工具：从实验视频中提取液滴/射流/空泡的几何与运动学量，并在此基础上计算**动态接触角**、**界面能变化**、**机械能与耗散**、**韦伯数**、**射流能量学**与**Laplace 压差**等。技术栈为 **React 19**、**TypeScript**、**Vite 8**；图表使用 **Recharts**，表格导出使用 **SheetJS (xlsx)**。

**在线演示（GitHub Pages）：** [https://goodparachutes.github.io/DropletDynamics-AnalysisSystem/](https://goodparachutes.github.io/DropletDynamics-AnalysisSystem/)

**源码仓库：** [goodparachutes/DropletDynamics-AnalysisSystem](https://github.com/goodparachutes/DropletDynamics-AnalysisSystem)

---

## 目录

- [系统能做什么](#系统能做什么)
- [推荐分析流程](#推荐分析流程)
- [功能模块详解](#功能模块详解)
- [核心算法与物理模型](#核心算法与物理模型)
- [技术栈与代码结构](#技术栈与代码结构)
- [本地开发](#本地开发)
- [GitHub 与 Pages 部署](#github-与-pages-部署)

---

## 系统能做什么

| 领域 | 能力概述 |
|------|-----------|
| **视频与标定** | 加载侧视视频；**空间标定**（手动标尺或按已知直径 \(D_0\) 自动圆拟合）；**Surface Y** 固–气基准线；**时间标定**（\(t_0\)、导出帧率与采样帧率）；可选**分析区 ROI**、**凹腔/气泡 ROI**。 |
| **轮廓与直径** | 亮度阈值或**背景差分**二值化；**形态学闭运算**弥合高光孔洞；**边框泛洪 + 反转**得到实心液滴；**Moore 边界追踪**闭合外轮廓；子像素级**气–液外缘**检测与**铺展直径** \(D(t)\)、铺展系数 \(\beta = D/D_0\)。 |
| **动态接触角** | 基准线附近**直线最小二乘**或 **PCHIP 保形样条**求切线斜率；可选**时间序列平滑/左右对称修正**；导出左右 \(\theta\) 及平均。 |
| **接触线运动学** | 由 \(D(t)\) 差分估计单侧接触线速度 \(v \approx \frac{1}{2}\mathrm dD/\mathrm dt\) 及加速度。 |
| **液滴高度** | 由外轮廓最低点相对 Surface Y 得**顶点高度**（mm）。 |
| **表面能与能量** | 由旋转母线重建**气–液面积** \(A_{wa}\)、**体积** \(V\)、**质心高度**；多界面张力 \(\gamma_{wa},\gamma_{bw},\gamma_{ba}\) 下 \(\Delta E_\sigma\)；**动能** \(E_k\)（质心竖直 + 铺展分量）；**累积耗散功**与**耗散功率**；**体积守恒**与 \(E_\mathrm{mech}\) 单调性展示护栏。 |
| **撞击分析** | 撞击前多帧**圆拟合**质心轨迹，**线性回归**得合速度；**韦伯数** \(\mathrm{We}=\rho U^2 D_0/\gamma\)。 |
| **射流液滴** | ROI 内 **CLAHE + Otsu + 闭运算**分割；**Halír–Flusser 代数椭圆拟合**；弹道 \(Z_c(t)\) **线性最小二乘**得射流速度；**宏观入射能量** \(E_\mathrm{in}\)、效率 \(\eta\)、放大系数 \(\beta\)（与撞击 \(U_0\) 关联）。 |
| **空泡/凹腔** | 与射流同族的预处理与 Moore 轮廓；**等效半径**、**形心高度**、**顶端曲率** \(\kappa\)；**Young–Laplace** \(\Delta P = 2\sigma/R\)；径向/轴向速度（SG 平滑 + 中心差分）；**长宽比护栏**抑制杂质；支持**手动多边形腔体**。 |
| **导出** | 将曲线与标量结果导出为 **Excel (.xlsx)** 等，便于后处理与论文作图。 |

---

## 推荐分析流程

1. **上传视频**，在侧栏设置**阈值**与液滴相对背景的亮/暗。  
2. 设定或**自动标定**：已知 \(D_0\)（mm）时，程序在 ROI 内对触前近似球冠做**圆盘拟合**，得到 **px/mm** 与 **Surface Y**（与撞击圆拟合共用同一几何假设）。  
3. 拖选**分析区域**（可选），减少倒影与杂散前景干扰。  
4. 选择轮廓模式：**亮度分割**或 **|当前帧灰度 − 背景帧灰度|** 差分；必要时调节**形态学闭运算**、**单帧阈值/差分覆盖**、**掩膜橡皮擦**（圆域抑制误连通）。  
5. 设定 **\(t_0\)** 与帧率关系，使横轴时间与实验一致。  
6. 运行主分析链，得到每帧 **\(\beta\)、\(D\)、外轮廓、接触角** 等；再按需打开**表面能**、**撞击**、**射流**、**凹腔**等面板并导出。

---

## 功能模块详解

### 视频与时间

- 支持侧视序列的帧采样；**导出帧率**与**采样帧率**用于把「帧索引」换算为与标定一致的**物理时间**（与射流、凹腔模块的时间轴约定一致）。  
- **\(t_0\)**：铺展/能量时间零点，通常对应刚接触或选定参考帧。

### 空间标定与 Surface Y

- **手动标定**：在画面上点选标尺两端并输入实际长度。  
- **自动标定**（`autoCalibration.ts` + `dropletSilhouette.ts`）：对 ROI 内二值图逐行统计前景跨度，找**最宽行**估计液滴主体，再用与撞击分析相同的**圆盘/球冠剪影拟合**得到像素直径 \(d_\mathrm{px}\)，由 \(D_0\) 得 **pixelScale = \(d_\mathrm{px}/D_0\)**（px/mm）；同时给出圆心与**基线**位置，映射为全图 **Surface Y**。  
- **Surface Y** 以下像素在轮廓掩膜中可强制为背景，与「\(z=0\) 在固面」的几何约定一致。

### 轮廓提取（`dropletContour.ts` + `contourMorphology.ts`）

- **二值化**：RGB 转灰度后与阈值比较；差分模式则对 \(|I-I_\mathrm{bg}|\) 阈值化。  
- **形态学**：3×3 或**圆盘结构元素**闭运算，连接断裂边缘、填小孔。  
- **实心化**：从图像四边对背景做 4-连通**泛洪**，再将非背景标为前景，缓解 shadowgraphy 下滴内「高光空洞」导致的**错误内轮廓**（Moore 只跟踪最外层气–液边界）。  
- **Moore 邻域**追踪闭合链；可选「**单行射线种子**」减轻误跟封闭内腔。  
- **基准线裁切**：\(y > \lfloor \mathrm{SurfaceY}\rfloor\) 的掩膜清零，去除台面与倒影。  
- **子像素边缘**（`physics.ts`）：在水平剖面上找**背景→液体**首次穿越，并在局部用灰度差分近似二阶、做**亚像素峰**修正，稳定提取左右触点附近的轮廓控制点。

### 铺展直径、\(\beta\) 与样条

- 在 Surface Y 上区分主液滴与两侧噪声/倒影条带；结合左右外缘得到**绝对直径** \(D(t)\) 与铺展系数 \(\beta = D/D_0\)。  
- 对宽度等序列可使用 **PCHIP（Fritsch–Carlson）** 保形单调插值（`spline.ts`），避免自然三次样条在稀疏点上的振荡。

### 动态接触角（`contactAngle.ts`）

- **定义**：Young 接触角 \(\theta\)——液相一侧，固–液与气–液界面切线夹角（\(0^\circ\)–\(180^\circ\)）；侧视固面为水平 **Surface Y**。  
- **方法 A — 直线回归（默认）**：在 Surface Y 上方有限深度带内选点，必要时用 **`subL/subR` 足点**剔除跨侧混点；对 **\(x\) 关于 \(y\)** 做最小二乘 \(x=p+q y\)，\(q=\mathrm dx/\mathrm dy\)；左侧 \(\theta = 90^\circ + \arctan q\)，右侧 \(\theta = 90^\circ - \arctan q\)（与典型弯月面左右斜率符号一致）。  
- **方法 B — 铺展样条**：在同一竖直带内取轮廓边点，构造 **\(x(y)\)** 的 PCHIP（非单调段退回自然三次），在 \(y=\mathrm{SurfaceY}\) 处求 \(\mathrm dx/\mathrm dy\) 得同样 \(\theta\) 公式。  
- **拟合精度滑块**：映射回归带深度与参与点数上限。  
- **后处理**（`contactAngleRefinement.ts`）：左右差过大时向对称滴假设对齐；与前后邻帧插值预测偏差过大时用邻域插值替换，并可多遍平滑。

### 接触线运动学（`contactLineKinematics.ts`）

- 单侧接触线沿铺展方向速度近似为  
  \[
  v \approx \tfrac{1}{2}\,\frac{\mathrm dD}{\mathrm dt}
  \]  
  （\(D\) 为 mm，\(t\) 为 ms）；对 \(v\) 再差分得加速度。 \(\beta=0\) 的参考帧不计算导数。

### 顶点高度（`apexHeightFromContour.ts`）

- 图像坐标 \(y\) 向下增大，轮廓**最高点**对应最小 \(y\)；与 Surface Y 的差乘以标定得**顶点距固面高度**（mm）。

### 表面能与机械能（`surfaceEnergy.ts`、`surfaceEnergyDissipation.ts`）

- 由 **Moore 外轮廓** 提取**旋转母线**（\(r\)–\(z\)），可对该母线半径做 **Savitzky–Golay** 平滑以抑制像素锯齿导致的面积膨胀；显示用轮廓可对 \(x,y\) 在闭合环上做三倍周期 SG，并在触点带保留原始点减轻基线伪影。  
- **气–液面积** \(A_{wa}\)、**体积** \(V\)、**质心竖直坐标** \(z_\mathrm{cm}\) 由母线积分/旋转体几何得到；**固–液盘面积** \(A_b\) 优先采用母线推断的**基线直径**，否则退回左右触点定义的弦径。  
- **表面能变化**相对触前参考球：  
  \[
  \Delta E_\sigma = \gamma_{wa} A_{wa} + (\gamma_{bw}-\gamma_{ba}) A_b - E_{\sigma,0},\quad
  E_{\sigma,0}=\gamma_{wa}\,\pi D_0^2
  \]  
  （程序内对长度单位有 mm→m 换算；\(E_{\sigma,0}\) 与代码注释「触前球 \(A_{wa,0}=\pi D_0^2\)」一致。）  
- **动能**采用  
  \[
  E_k = \tfrac{1}{2} M \left( v_\mathrm{cm}^2 + \tfrac{1}{2} v_\mathrm{spread}^2 \right)
  \]  
  其中 \(M\) 由 \(D_0\) 与液体密度按**不可压缩球**估算；\(v_\mathrm{cm}\)、\(v_\mathrm{spread}\) 由质心高度与直径对时间的数值导数得到。  
- **机械能** \(E_\mathrm{mech}=E_k+\Delta E_\sigma\)；展示上可对 \(E_\mathrm{mech}\) 施加**单调不增**钳制以压制实验噪声导致的非物理回升，**耗散功**仍用未钳制的分量保证能量闭合解释一致。  
- **耗散**：\(W_\mathrm{diss}(t)=\max\bigl(0,\,E_\mathrm{mech}(0)-E_\mathrm{mech}(t)\bigr)\)；功率 \(\Phi=\mathrm dW/\mathrm dt\) 对原始序列中心差分后，再对 \(\Phi\) 做 **滑动平均或 SG**，最后 \(\max(0,\Phi)\) 作为展示用耗散功率。  
- **体积守恒**：比较 \(V(t)\) 与参考球体积 \(V_0=\pi D_0^3/6\)，默认 \(\pm 5\%\) 为 QC 带。

### 撞击速度与韦伯数（`impact.ts` + `dropletSilhouette.ts`）

- 在 \(t_0\) 前取若干帧，对每帧做与自动标定相同的**圆拟合**，得质心 \((c_x,c_y)(t)\)。  
- 物理时间由帧时刻与 \(t_0\)、帧率缩放对齐；对 \(t\)–\(c_x\)、\(t\)–\(c_y\) 分别**线性最小二乘**得 \(\dot c_x,\dot c_y\)，合速度 \(U=\sqrt{\dot c_x^2+\dot c_y^2}\)（px/s → m/s）。  
- **韦伯数**：  
  \[
  \mathrm{We}=\frac{\rho U^2 D_0}{\gamma}
  \]  
  \(\rho\) 默认水密度量级，\(\gamma\) 为气–液表面张力（N/m），\(D_0\) 换为米。

### 射流液滴模块（`jetDynamics.ts`、`ellipseAlgebraicFit.ts`）

- ROI 内 **CLAHE**（分块直方图裁剪 + 双线性映射）增强局部对比后 **Otsu** 自动阈值，再做**圆盘闭运算**；枚举足够大的连通域作为候选液滴。  
- 对轮廓做 **Halír–Flusser 代数最小二乘椭圆拟合**（约束 \(4ac-b^2>0\)），得长半轴、短半轴、倾角；失败时退回面积等效圆与包围盒纵横比。  
- **\(z_\mathrm{tip}\)**：由 Surface Y 与参考高度（椭圆心或形心）换算。  
- **弹道**：对 \(z_\mathrm{tip}(t)\) 与标定时间做**线性回归** \(z \approx \dot Z\,t + Z_0\)，斜率得射流速度 \(V_\mathrm{jet}\)。  
- **动能**：\(E_k=\tfrac{1}{2}\rho V_\mathrm{sphere} v^2\)（\(V_\mathrm{sphere}\) 为有效体积的序列平均锁定）。  
- **宏观入射能量**：  
  \[
  E_\mathrm{in}=\tfrac{1}{2} M_0 U_0^2 + \sigma\cdot 4\pi R_0^2,\quad R_0=D_0/2
  \]  
  其中 \(U_0\) 来自主分析撞击速度；效率 \(\eta = E_k/E_\mathrm{in}\)，速度放大 \(\beta=(V_\mathrm{jet}/U_0)^2\)（与主分析 \(\beta\) 符号不同，为射流模块内定义）。  
- **跟踪**：帧间形心**最近邻贪心匹配**，断裂生成新轨迹 ID。

### 空泡 / 凹腔模块（`bubbleDynamics.ts`、`manualPolygonCavity.ts`）

- 与射流类似的 **CLAHE → Otsu（带 \(\varepsilon\) 松弛）→ 闭运算**；Moore 外轮廓；**鞋带公式**算面积与**多边形形心**；对轮廓序列做 SG 后由**中心差分**得 \(\mathrm dR/\mathrm dt\)、\(\mathrm dz_c/\mathrm dt\)。  
- **Laplace 压差（球近似）**：  
  \[
  \Delta P = \frac{2\sigma}{R_\mathrm{eq}}
  \]  
  \(R_\mathrm{eq}=\sqrt{A/\pi}\) 由像素面积与标定得到。  
- **顶端曲率** \(\kappa\)：由平滑后的轮廓在顶点邻域估计，并换算为 mm⁻¹。  
- **长宽比护栏**：包围盒纵横比超出合理范围时判为**非气泡杂质**并终止序列，避免误跟踪。  
- **手动凹腔**：用户在画面上点击闭合多边形，用鞋带面积与形心参与几何量（见 `manualPolygonCavity.ts`）。

### 导出

- 侧栏可将多类时间序列与标量导出为 **.xlsx**，便于 Origin / MATLAB / Python 复现作图。

---

## 核心算法与物理模型

| 主题 | 要点 |
|------|------|
| **图像分割** | 全局/局部阈值、背景帧差分、Otsu、CLAHE、二值形态学（3×3 / 圆盘）、边框泛洪实心化。 |
| **几何** | Moore 8-邻域轮廓；鞋带面积；旋转体母线 → \(A_{wa},V,z_\mathrm{cm}\)；椭圆代数拟合（Fitzgibbon / Halír–Flusser 系）。 |
| **平滑与求导** | Savitzky–Golay（`ml-savitzky-golay`）平滑与数值导数；PCHIP 保形插值；机械能单调钳制；耗散功率非负截断。 |
| **接触角** | Young 定义；\(x(y)\) 线性回归或样条切线；时间邻域修正。 |
| **无量纲与能量** | 韦伯数 \(\mathrm{We}\)；多界面 \(\Delta E_\sigma\)；\(E_k\)、\(E_\mathrm{mech}\)、\(W_\mathrm{diss}\)、\(\Phi\)；射流 \(E_\mathrm{in},\eta,\beta\)。 |
| **空泡** | Young–Laplace \(\Delta P=2\sigma/R\)；\(R(t),z_c(t)\) 及其导数。 |

实现细节与边界条件以源码注释为准（例如 `contactAngle.ts`、`surfaceEnergyDissipation.ts`、`jetDynamics.ts` 文件头说明）。

---

## 技术栈与代码结构

- **UI / 状态**：`src/app/App.tsx` 为主界面与管道编排。  
- **分析核心**：`src/features/analysis/`（轮廓、接触角、表面能、撞击、样条等）。  
- **标定**：`src/features/calibration/autoCalibration.ts`。  
- **射流 / 凹腔**：`src/features/jet/`、`src/features/cavity/`。  
- **类型**：`src/types/`。  
- **单元测试**：`vitest`，与各 `*.test.ts` 同目录。

---

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

---

## GitHub 与 Pages 部署

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

本仓库包含 [`.github/workflows/deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml)：在推送 `main` / `master` 时构建，并通过 **GitHub Actions** 发布到 Pages。

1. 打开仓库 **Settings → Pages**。  
2. 在 **Build and deployment** 中，将 **Source** 设为 **GitHub Actions**（不要选 “Deploy from a branch”）。  
3. 推送任意提交到 `main` 或 `master`，或在 **Actions** 里手动运行 **Deploy to GitHub Pages**。

构建时会根据仓库名自动设置 Vite 的 `base`（环境变量 `VITE_BASE_PATH`，CI 中为 `/DropletDynamics-AnalysisSystem/`）。若将来改用 **`goodparachutes.github.io`** 根域名仓库且站点在域名根路径，需要把工作流里的 `VITE_BASE_PATH` 改为 `/`（或去掉该变量）。
