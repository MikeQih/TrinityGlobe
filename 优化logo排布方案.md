# 优化 Logo 排布方案

## 背景问题

产品卡片中各图片尺寸不一，logo 按图片宽度 40% 定比例贴在右下角，导致在网页卡片里缩放后位置参差不齐，视觉上不整齐。

---

## 方案一：CSS 叠加 Logo（推荐，待实施）

### 思路
- 产品图片只保留**透明底、无 logo**版本（存在 `images/originals/`）
- 网站卡片通过 CSS `position: absolute` 在固定位置叠加 logo 图片
- Logo 位置由 CSS 控制，与图片本身尺寸无关，永远对齐卡片右下角

### 改动文件

**style.css**
```css
.card-img-wrap {
  position: relative;
}

.card-logo {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 36%;
  opacity: 0.8;
  pointer-events: none;
  z-index: 1;
}
```

**script.js** — 卡片模板注入 logo 图片
```javascript
<div class="card-img-wrap">
  <img src="${p.image}" ... />
  <img class="card-logo" src="images/logo-tg-transparent.png" alt="" />
</div>
```

**products-data.js** — 图片路径改用 `originals/` 无 logo 版本
```javascript
image: "originals/干邑白兰地 - Hennessy VSOP.png"
```

### 优点
- Logo 位置完全一致，不受图片分辨率影响
- 新增产品无需重新处理图片加 logo
- 可随时调整 logo 大小、位置、透明度，只改 CSS

### 问题与阻塞点
- `images/originals/` 需要存放**干净无 logo** 的透明底图片
- 原有 originals/ 中部分图片已被覆盖（误操作），需从 git commit `3277fb3` 恢复
- 新增的产品图片（麦卡伦 Double Cask / Sherry Oak 系列等）尚无对应 originals/ 版本，需补充处理

### 恢复 originals/ 方法
```bash
git checkout 3277fb3 -- images/originals/
```

---

## 方案二：统一图片画布

### 思路
所有产品图先 padding 到相同尺寸（如 900×1200），产品居中，再在固定像素坐标贴 logo。

### 缺点
- 若产品在画布里占比不同，logo 相对于产品位置仍会有偏差
- 每张新图都需重新处理
- 实施成本高，效果不如方案一稳定

---

## 当前状态（已回退）

因方案一实施中 originals/ 图片处理耗时较长，暂时回退至原有方式：

- **图片**：产品图带 logo 直接存在 `images/` 文件夹
- **网站**：`products-data.js` 路径指向 `images/`，无 CSS 叠加
- **Shopee**：Excel Q 列链接指向 `images/` GitHub raw URL（有 logo 透明底）

---

## 文件夹说明

| 文件夹 | 内容 | 用途 |
|--------|------|------|
| `images/` | 透明底 + TrinityGlobe logo | 网站当前使用 / Shopee 上架 |
| `images/originals/` | 透明底，**无 logo** | 备用；方案一实施后供网站使用 |

---

## Logo 处理脚本参数（参考）

| 参数 | 值 |
|------|----|
| Logo 文件 | `~/Downloads/1 处理背景后.png` |
| Logo 宽度 | 图片宽度 × 40% |
| Logo 透明度 | 80% |
| 放置位置 | 右下角，距边缘 20px |
| 白底转透明阈值 | RGB > 230 → alpha = 0 |

```python
from PIL import Image

logo = Image.open("1 处理背景后.png").convert("RGBA")
data = logo.getdata()
logo.putdata([(r,g,b,0) if r>230 and g>230 and b>230 else (r,g,b,a) for r,g,b,a in data])

logo_w = int(base.width * 0.40)
logo_h = int(logo.height * (logo_w / logo.width))
logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

r, g, b, a = logo.split()
a = a.point(lambda x: int(x * 0.80))
logo.putalpha(a)

margin = 20
x = base.width - logo_w - margin
y = base.height - logo_h - margin
base.paste(logo, (x, y), logo)
```
