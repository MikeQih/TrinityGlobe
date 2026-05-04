# 图片 Logo 处理说明

## 流程概述

每张产品图片经过两步处理：
1. **去除背景** → 透明 PNG
2. **叠加 Logo** → 右下角水印

---

## 第一步：去除背景

使用 Python 库 **rembg**，基于 AI 模型（U2Net）自动识别瓶子轮廓并去掉背景，输出为透明 PNG。

```python
from rembg import remove

with open("原图.jpg", "rb") as f:
    result = remove(f.read())

with open("去背景.png", "wb") as f:
    f.write(result)
```

- 输出格式强制为 `.png`（JPEG 不支持透明通道）
- 原始文件保留不删除，新文件覆盖同名 `.png`

---

## 第二步：叠加 Logo

使用 Python 库 **Pillow** 将 Logo 合成到图片右下角。

```python
from PIL import Image

# Logo 文件：1 处理背景后.png（带白色背景）
# 先把白色背景变透明
logo = Image.open("1 处理背景后.png").convert("RGBA")
data = logo.getdata()
new_data = [(r, g, b, 0) if r > 230 and g > 230 and b > 230 else (r, g, b, a)
            for r, g, b, a in data]
logo.putdata(new_data)

# 缩放：Logo 宽度 = 图片宽度 × 40%
logo_w = int(base.width * 0.40)
logo_h = int(logo.height * (logo_w / logo.width))
logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

# 透明度调为 80%
r, g, b, a = logo.split()
a = a.point(lambda x: int(x * 0.80))
logo.putalpha(a)

# 放置位置：右下角，距边缘 20px
margin = 20
x = base.width - logo_w - margin
y = base.height - logo_h - margin
base.paste(logo, (x, y), logo)
base.save("输出.png")
```

---

## 参数设置

| 参数 | 值 | 说明 |
|------|-----|------|
| Logo 文件 | `1 处理背景后.png` | 完整 Trinity Globe 文字 Logo |
| Logo 尺寸 | 图片宽度 × 40% | 相对缩放，适配不同分辨率图片 |
| Logo 透明度 | 80% | 保留可见度，不遮挡产品 |
| 放置位置 | 右下角 | 距右边 20px，距底部 20px |
| 白底处理 | RGB > 230 → 透明 | Logo 原图有白色背景，需转透明 |
| 输出格式 | PNG | 保留透明通道 |

---

## 已处理种类

| 种类 | 数量 | 状态 |
|------|------|------|
| 干邑白兰地（Cognac） | 8 张 | 已完成（透明背景 + Logo） |
| 中国白酒（Baijiu） | 32 张 | 已完成（透明背景 + Logo） |
| 威士忌（Whisky） | 7 张 | 已完成（透明背景 + Logo） |
| 香槟（Champagne） | 4 张 | 已完成（透明背景 + Logo） |
| 红酒 / 白葡萄酒（Wine） | 4 张 | 已完成（透明背景 + Logo） |
| 清酒（Sake） | 5 张 | 已完成（透明背景 + Logo） |
| 啤酒（Beer） | 2 张 | 已完成（透明背景 + Logo） |
| 伏特加（Vodka） | 1 张 | 已完成（透明背景 + Logo） |
| 龙舌兰（Tequila） | 1 张 | 已完成（透明背景 + Logo） |
| **合计** | **64 张** | |

---

## 备份说明

无 Logo 原版（纯透明背景）保存在 `images/originals/` 文件夹，共 66 个文件。

**以下 9 张无法恢复无 logo 版本**（原始文件为 `.png` 且已被覆盖），`originals/` 中保存的是含 logo 的版本：

| 文件 | 原因 |
|------|------|
| `干邑白兰地 - Martell VSOP.png` | 原始为 PNG，已覆盖 |
| `威士忌 - 麦卡伦15年.png` | 原始为 PNG，已覆盖 |
| `威士忌 - 麦卡伦30年.png` | 原始为 PNG，已覆盖 |
| `香槟 - Dom Pérignon 2015.png` | 原始为 PNG，已覆盖 |
| `红酒 - Penfolds Bin 389.png` | 原始为 PNG，已覆盖 |
| `红酒 - Penfolds Bin 407.png` | 原始为 PNG，已覆盖 |
| `中国白酒 - 五粮液.png` | 原始为 PNG，已覆盖 |
| `中国白酒 - 汾酒 - 复兴版青花30.png` | 原始为 PNG，已覆盖 |
| `中国白酒 - 洋河 - 微分子 33.8度.png` | 原始为 PNG，已覆盖 |

> 后续如需重新处理这 9 张，需重新提供原始图片。

### 调整参数流程

1. 从 `images/originals/` 取对应文件
2. 修改脚本参数（大小、透明度、位置）
3. 重新运行叠加 Logo 脚本
4. 覆盖 `images/` 中对应文件

---

## 依赖安装

```bash
pip install rembg onnxruntime pillow
```

---

## Logo 文件位置

| 文件 | 说明 |
|------|------|
| `~/Downloads/1 处理背景后.png` | 完整文字 Logo（Trinity Globe） |
| `~/Downloads/1.1 处理背景后.png` | TG 字母组合 Logo |
| `images/logo-overlay.png` | 已转透明背景的 Logo（备用） |
