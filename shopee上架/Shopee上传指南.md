# Shopee Mass Upload 指南

## 模板文件
- 使用官方模板：`Shopee_mass_upload_XXXXXX_basic_template.xlsx`
- 数据填写在 **Template sheet**（不是 Upload Sample sheet）
- 数据从第 **7 行**开始填写（1-6 行是系统表头，不能动）

---

## 完整字段说明（Excel 列映射）

### 必填字段

| 列 | 字段名 | 类型 | 规范 |
|----|--------|------|------|
| A | Category | 数字字符串 | 分类 ID，见下方列表，不能填分类名称 |
| B | Product Name | 字符串 | **10–120 字符**（中文每字算 1 个字符） |
| C | Product Description | 字符串 | **20–3000 字符** |
| K | Price | 数字字符串 | 正数，单位本地货币（SGD），不含货币符号 |
| L | Stock | 数字字符串 | 正整数 |
| Q | Cover Image | URL 字符串 | 必须可公开访问的图片直链，见图片要求 |
| Z | Weight | 数字字符串 | 单位 **kg**，正数，范围 0.00–100,000.00 |
| AD | Doorstep Delivery | `On` / `Off` | 至少一个渠道填 `On` |
| AE | Pick Lockers | `On` / `Off` | 同上 |
| AF | Collection Points | `On` / `Off` | 同上 |
| AG | SPX Express Lockers | `On` / `Off` | 同上 |

> 物流渠道（AD–AG）至少勾选一个 **On**，否则上传失败。

### 条件必填字段（建议填写，影响运费计算）

| 列 | 字段名 | 类型 | 规范 |
|----|--------|------|------|
| AA | Length | 数字字符串 | 包装尺寸，单位 **cm**，范围 0–10,000,000 |
| AB | Width | 数字字符串 | 包装尺寸，单位 **cm**，范围 0–10,000,000 |
| AC | Height | 数字字符串 | 包装尺寸，单位 **cm**，范围 0–10,000,000 |

> 酒瓶参考尺寸：标准 700ml 瓶约 10 × 10 × 30（cm）

### 可选字段（变体产品）

| 列 | 字段名 | 类型 | 规范 |
|----|--------|------|------|
| E | Variation Integration No. | 数字字符串 | 同一产品所有变体填相同编号 |
| F | Variation Name1 | 字符串 | 变体维度名，如 `Volume`、`Size` |
| G | Option for Variation 1 | 字符串 | 变体值，如 `700ml`、`1L` |
| H | Image per Variation | URL 字符串 | 每个变体对应图片 URL |

> 同一产品每个变体占一行，Product Name / Description 只在第一行填，其余行留空。

### 格式注意事项
- **所有字段均以字符串形式存储**（包括数字），不要设置单元格为数值格式
- `On` / `Off` 区分大小写，必须首字母大写
- 图片 URL 不要有空格或换行
- Product Name 中文名称短于 10 字的需补充英文描述，例：`茅台` → `贵州茅台酒 Moutai Baijiu 500ml`

---

## 酒类 Category ID（Singapore）

| Category ID | 分类 | 适用产品 |
|-------------|------|---------|
| `100862` | Liquor & Spirits | 干邑、威士忌、伏特加、龙舌兰、白酒 |
| `100861` | Wine & Champagne | 红酒、白葡萄酒、香槟 |
| `100863` | Sake, Soju & Umeshu | 清酒 |
| `100860` | Beer & Cider | 啤酒 |
| `100864` | Alcoholic Beverages / Others | 其他酒类 |

---

## 图片 URL 要求
- 格式：JPG / JPEG / PNG
- 大小：每张最大 2MB
- 最小尺寸：1×1 px
- 必须是**可公开访问的 URL**（不能是本地路径）
- **使用 GitHub raw URL 时，仓库必须设为 Public**，否则返回 404
  - 格式：`https://raw.githubusercontent.com/{user}/{repo}/main/images/{filename}`
  - 文件名含中文/空格时需 URL encode（Python：`urllib.parse.quote(path)`）
- 备用图床：[imgbb.com](https://imgbb.com)
- 测试用占位图：`https://placehold.co/800x800/png`

---

## 常见错误

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `Product name length must be between 10 and 120 characters` | 产品名不足 10 字符（中文短名常见） | 补充英文译名或规格，如 `茅台` → `贵州茅台酒 Moutai Baijiu 500ml` |
| `invalid category id` | Category ID 填错或不存在 | 对照上方表格填写正确数字 ID |
| `Sorry, your request contains invalid file` | 数据填在了错误的 sheet | 确保数据在 **Template sheet**（不是 Upload Sample） |
| 图片无法加载 | URL 不可公开访问 | 检查 GitHub 仓库是否为 Public；或换用图床 |
| 物流报错 | 所有渠道都是 Off | AD–AG 至少设一个为 `On` |

---

## 批量生成文件（Python 脚本）

生成脚本核心逻辑：
1. 复制官方模板 xlsx（保留所有格式和隐藏 sheet）
2. 直接修改 `xl/worksheets/sheet2.xml`（Template sheet）
3. 从第 7 行开始写入产品数据，所有值以 `t="s"` 共享字符串存储
4. 同步更新 `xl/sharedStrings.xml`（追加新字符串，不覆盖原有）

生成好的文件：`shopee上架/TrinityGlobe_Shopee_upload.xlsx`（67 个产品）

---

## 上传流程

1. Seller Centre → **My Products → Mass Upload**
2. 点击 **Upload File**，上传填好的 xlsx
3. 等待处理完成
4. 下载 Result 文件（**Result 文件只包含失败的行**，成功行不显示）
5. 查看最后一列 **Fail Reason** 了解每行的失败原因
6. 修正后重新生成补充文件，只上传失败的产品即可（不会重复已成功的）
