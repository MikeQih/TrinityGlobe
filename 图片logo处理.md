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
| 干邑白兰地（Cognac） | 8 张 | 已完成（透明背景，无 Logo） |
| 中国白酒（Baijiu） | 32 张 | 已完成（透明背景 + Logo） |

> 注：Cognac 目前只去了背景，未加 Logo。

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
