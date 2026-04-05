# Trinity Globe 网站使用教程

## 目录
1. [网站结构说明](#1-网站结构说明)
2. [本地预览](#2-本地预览)
3. [后台管理（产品增删改）](#3-后台管理产品增删改)
4. [发布流程（更新上线）](#4-发布流程更新上线)
5. [添加新产品分类](#5-添加新产品分类)
6. [邀请他人使用后台](#6-邀请他人使用后台)
7. [DNS 与部署说明](#7-dns-与部署说明)
8. [常见问题](#8-常见问题)

---

## 1. 网站结构说明

```
TrinityGlobe/
├── index.html          # 主页面（结构）
├── style.css           # 样式
├── script.js           # 逻辑：加载产品、筛选 tab、动画
├── products.json       # 产品数据（后台编辑的是这个文件）
├── products-data.js    # 本地开发备用数据（Live Server 使用）
├── admin/
│   ├── index.html      # 后台入口页
│   └── config.yml      # 后台字段配置
└── images/             # 产品图片文件夹
```

**工作原理：**
- 网站上线后，`script.js` 自动从 `products.json` 读取产品数据并渲染
- 后台修改保存后，Netlify CMS 会把更改 commit 到 GitHub，Netlify 自动重新部署（约 1 分钟）
- 本地用 Live Server 预览时，读取的是 `products-data.js`（无需联网）

---

## 2. 本地预览

使用 VS Code 的 **Live Server** 插件：

1. 在 VS Code 中打开 `TrinityGlobe` 文件夹
2. 右键点击 `index.html` → **Open with Live Server**
3. 浏览器自动打开 `http://127.0.0.1:5500/index.html`

> 注意：本地预览的产品数据来自 `products-data.js`，不是最新的 `products.json`。  
> 如需测试最新数据，直接访问线上网站 `www.trinityglobe.sg`

---

## 3. 后台管理（产品增删改）

### 访问后台

打开浏览器，访问：
```
https://www.trinityglobe.sg/admin
```

用受邀的邮箱账号登录（见第 6 节邀请方法）。

---

### 编辑现有产品

1. 登录后台
2. 点击左侧 **Products**
3. 点击 **Product List**
4. 找到要修改的产品，展开后直接修改字段
5. 修改完成后点击右上角 **Publish** 按钮

---

### 添加新产品

1. 进入 **Products → Product List**
2. 点击右上角 **Add products +**
3. 填写以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| **Product Name** | 产品英文名 | Hennessy VSOP |
| **Category** | 分类（用于筛选 tab） | cognac |
| **Category Label** | 卡片上显示的标签 | Cognac |
| **Image** | 上传产品图片 | 点击上传 |
| **1 Bottle** | 单瓶价格（SGD） | 105 |
| **1 Case** | 一箱价格（SGD） | 1260 |
| **5 Cases** | 五箱价格（SGD，可留空） | — |

4. 填完后点击 **Publish**

---

### 删除产品

1. 进入 **Products → Product List**
2. 找到要删除的产品
3. 点击产品右上角的 **×** 按钮
4. 点击 **Publish** 保存

---

### 更换产品图片

1. 进入对应产品的编辑页
2. 找到 **Image** 字段，点击 **Choose different image**
3. 上传新图片（建议尺寸：600×600px，格式 JPG/PNG）
4. 点击 **Publish**

---

## 4. 发布流程（更新上线）

### 方式一：通过后台（他人自助）

后台修改完成后，点击 **Publish** 即可。Netlify 检测到 GitHub 变化后约 **1 分钟**自动部署上线。

---

### 方式二：通过代码更新（开发者）

适用于修改网站样式、结构、联系方式等需要改代码的情况：

```bash
# 进入项目目录
cd "/Users/hengchangqi/Documents/Singapore/Plan & Note Internship/Part Time/WeChatProjects/TrinityGlobe"

# 查看改动
git status

# 提交改动
git add .
git commit -m "描述这次改动内容"

# 推送到 GitHub（Netlify 自动部署）
git push origin main
```

---

## 5. 添加新产品分类

**不需要改任何代码。**

在后台添加产品时，**Category** 字段填写新分类的英文名（小写），保存发布后，网站筛选 tab 会自动新增该分类。

**现有分类：**

| Category 值 | Tab 显示名 |
|------------|-----------|
| cognac | COGNAC |
| whisky | WHISKY |
| champagne | CHAMPAGNE |
| wine | WINE |
| baijiu | BAIJIU |
| beer | BEER |
| other | OTHERS（始终排最后） |

**添加新分类示例（如 Rum）：**
- Category 填：`rum`
- 保存后，tab 自动出现 **RUM**

---

## 6. 邀请他人使用后台

### 邀请步骤

1. 登录 Netlify：`https://app.netlify.com`
2. 进入项目 **trinityglobe.sg**
3. 地址栏输入：`https://app.netlify.com/sites/trinity-globe/identity`
4. 点击右上角 **Invite users**
5. 输入他人的邮箱地址，发送邀请

### 他人操作

1. 收到邀请邮件，点击邮件中的链接
2. 设置登录密码
3. 之后直接访问 `https://www.trinityglobe.sg/admin` 登录即可

> 他人只能看到产品后台，看不到 GitHub、Netlify 账号或其他任何项目。

---

## 7. DNS 与部署说明

| 项目 | 详情 |
|------|------|
| 域名注册商 | GoDaddy |
| 域名 | trinityglobe.sg |
| 托管平台 | Netlify |
| GitHub 仓库 | github.com/MikeQih/TrinityGlobe |
| Netlify 项目名 | trinity-globe |
| 主域名 | trinityglobe.sg（primary） |
| www 域名 | www.trinityglobe.sg（自动跳转主域名） |

**DNS 配置（GoDaddy）：**
- A 记录：`@` → `75.2.60.5`
- CNAME：`www` → `trinity-globe.netlify.app`

**SSL：** Netlify 自动签发 Let's Encrypt 证书，无需手动操作。

**自动部署：** 每次 push 到 GitHub `main` 分支，Netlify 自动重新部署，约 1 分钟生效。

---

## 8. 常见问题

### Q：网站改动了但没有更新？
- 确认 `git push origin main` 已执行
- 在 Netlify → Deploys 查看是否有新的部署记录
- 清除浏览器缓存（Cmd+Shift+R）

### Q：手机上显示正常，电脑上显示旧页面？
- 电脑 DNS 缓存问题，在终端运行：
```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

### Q：后台登录收不到邮件？
- 检查垃圾邮件文件夹
- 在 Netlify Identity 页面重新发送邀请

### Q：添加产品后价格显示 "—" 而不是金额？
- 确认价格字段填了数字（不能为 0 或空）
- 保存后点击 **Publish** 确认发布

### Q：想修改联系方式（电话/微信）？
- 修改 `index.html` 中 Contact 部分的内容
- 修改完后 `git push origin main` 即可

### Q：想换 About 页面的介绍文字？
- 修改 `index.html` 中 `<section id="about">` 部分的文字
- 修改完后 `git push origin main` 即可
