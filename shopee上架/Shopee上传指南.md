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

---

## Mass Update（批量改价/改库存，不是新建产品）

跟 Mass Upload 的区别：**Mass Upload 是新建 listing**（会丢失原有销量/评价/排名），**Mass Update 是更新已有 listing 的字段**（按 Item ID 匹配，不影响历史数据）。批量改价格、改库存一律用 Mass Update，不要用 Mass Upload。

### 操作路径
Seller Centre → **My Products → Mass Function → Mass Update**

### 模板类型（Download 标签里选）
| 模板 | 包含字段 | 用途 |
|------|---------|------|
| Basic Info | 标题、图片、描述 | 改基础信息 |
| **Sales Info** | Product ID / Product Name / Variation ID / **Parent SKU / SKU / Price / GTIN / Stock**（可编辑） | **改价格、改库存用这个** |
| Shipping Info | 物流渠道设置 | 改配送方式 |
| BCRS Info | Beverage Container Return Scheme / Quantity per Pack / Volume(ML) / Packaging Type | 饮料容器回收计划合规申报（见下方说明，跟Specification标签的Volume是两回事） |

### Sales Info 模板结构
- 数据从第 **7 行**开始（1-6 行是系统表头，含字段说明和校验规则文字，不能动）
- 列：A=Product ID, B=Product Name, C=Variation ID, D=Variation Name, E=Parent SKU, F=SKU, **G=Price**, H=GTIN, **I=Stock**, J=Fail Reason
- **只改 G(Price) 列**，其余列（尤其 I 库存列）保持原样，否则会被覆盖成过期的库存数字

### 标准流程
1. Download 标签 → Template 选 **Sales Info** → Generate → 等 Records 处理完 → 下载（拿到的是当前**实时**价格库存）
2. 只修改 Price 列，其余不动
3. Upload 标签 → 上传改好的文件
4. 记录里 **Processed 显示 "成功数/总数"**（例如 64/71），有失败的话点 **Download** 拿结果文件，最后一列 Fail Reason 看失败原因

**不要用之前导出/生成过的 Mass Update 文件当涨价基准**，哪怕文件名看起来是"最新版"或"最终版"。价格和库存会因为中间的手动改价（例如处理 200 门槛用手动 Update 改的价格，往往不是整数、也不等于批量算出来的目标价）、库存变动等原因跟线上实际值不一致。每次要在"当前价格"基础上加价，都要重新走一遍上面第 1 步现下载，在这份新下载的文件上改 Price，不要复用旧文件历史价格再叠加。

### 已知问题：价格超过 200 新币，自提渠道报错
**现象**：`The max price of the product is over max limit. Channel detail: Pick Lockers / Collection Points / SPX Express Lockers`

**原因**：Pick Lockers、Collection Points、SPX Express Lockers 这三个"自提"配送渠道有 **SGD 200 价格上限**（新加坡自提柜/自提点对物品价值的限制）。产品价格一旦从 ≤200 涨到 >200，会触发这个校验；已经在 200 以上的产品继续涨价不受影响（说明系统只在"首次跨过 200 门槛"时校验，已经在门槛以上的产品这几个渠道其实早就对其失效了）。

**Mass Update 批量上传不会自动处理这个问题**——价格超限但渠道还开着，直接报错拒绝整行更新。

**解决方法：改成手动编辑单个产品**（Sales Information 标签改 Price → 点 Update）。手动编辑时系统会**自动把这三个自提渠道禁用**（变灰、显示"Price Exceeded $200.00"），价格能顺利保存到位，不需要额外去 Shipping 标签手动关渠道。经实测这个方法对所有卡在 200 上限的产品都有效，价格能涨到完整目标值，不用退而求其次封顶在 200。

**不要尝试的方法**：
- 在 Shipping 标签手动关闭 Pick Lockers / Collection Points / SPX Express Lockers 这三个开关——这几个渠道跟 Doorstep Delivery 是**同一个 Shopee Supported Logistics（SSL）物流商的不同腿**，只要店铺只接入了 SPX 一家物流，这几个渠道就是绑定在一起的，关掉自提会连 Doorstep 一起关掉，导致"没有任何配送方式"保存失败。
- 全部渠道关闭后指望买家私信下单——技术上保存不了（Shopee 强制要求至少一个渠道开启），而且这属于平台外交易，违反 Shopee 规则，有封号风险。

### xlsx 文件读取报错（activePane invalid）
Shopee 导出的 Mass Update 结果/模板文件，`xl/worksheets/sheetN.xml` 里 `activePane` 属性有时是 `bottom_left`（下划线），不是 openpyxl 要求的驼峰写法 `bottomLeft`，会导致 `openpyxl.load_workbook()` 报错 `ValueError: Value must be one of {'topLeft', 'bottomLeft', 'topRight', 'bottomRight'}`。

修复方法：
```bash
unzip -o file.xlsx -d /tmp/extract
sed -i '' 's/activePane="bottom_left"/activePane="bottomLeft"/' /tmp/extract/xl/worksheets/sheet*.xml
cd /tmp/extract && zip -q -r -X /tmp/fixed.xlsx . -x '.*'
```
修复后用 openpyxl 正常读取 `/tmp/fixed.xlsx` 即可。

### BCRS（饮料容器回收计划）跟 Specification 的 Volume 不是一回事
- **Specification 标签**的 Volume / Packaging Type：产品常规必填属性（下拉选择，如 500ml / Bottle），跟回收计划无关，正常按实际规格填。
- **Sales Information 标签**里的 **"NEA Beverage Container Return Scheme"**（Yes/No）：这个才是 BCRS 合规申报开关。只有**罐装/塑料瓶装**饮料（150-3000ml）才需要选 Yes 并填 Packaging Type=罐；**玻璃瓶装**选 **No** 即可，不需要额外填 Volume(ML)/Packaging Type。
- Mass Update 的 BCRS Info 模板导出的就是这个 Sales Information 里的开关状态，跟 Specification 的 Volume 字段是两套独立数据，互不影响。
- **本地文件（Mass Update 各模板、`TrinityGlobe_Shopee_upload.xlsx` 的 Template/Description）都不存 Volume/ml 数据**，只有部分产品把容量写进了 Product Name（如 "Gaulois XO **1L**"），没写的产品名称里就查不到容量。要查某产品实际 ml，得去 Shopee 后台该产品的 Specification 标签看，别凭产品名或描述猜。
