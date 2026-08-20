# Trinity Globe 商城项目 — 当前状态清单

> 用途：新开 session 时把这份文件读一遍就能接着做。会随进展更新，别当成一次性交接文档。
> 最后更新：2026-08-20

## 项目背景

Trinity Globe Trading Pte. Ltd.（新加坡烈酒/酒类批发零售商）目前主要靠 Shopee 卖货（约9.81%平台佣金）。
目标：给官网 trinityglobe.sg 加购物车+结账+Stripe支付能力，让客户可以直接在官网下单付款，绕开 Shopee 抽成。

技术栈（已拍板，不再讨论备选）：
- 前台：保留现有静态 HTML/CSS，新增逻辑用 Vite（库模式）+ TypeScript，编译成 `assets/storefront.js`，用 `<script type="module">` 挂进现有 `index.html`
- 内容仍用 Netlify CMS 编辑 `products.json`，不搬进数据库
- 后端：Netlify Functions (TypeScript)
- 数据库：Supabase Postgres（用到 Auth + RLS + RPC）
- 校验：Zod
- 支付：Stripe Checkout（卡 + PayNow）
- 邮件：Resend
- 后台：独立 `admin-app/`（React + Vite + TS）

完整功能范围见仓库根目录 `Trinity_Globe_商城_PRD_v1.0.md`。
详细实现计划见 `/Users/hengchangqi/.claude/plans/federated-twirling-coral.md`（Phase 1 七个切片的完整分解）。

---

## 代码进度：Phase 1 MVP 已完整实现并本地验证通过

- [x] 切片1 项目脚手架（package.json, vite.config.ts, tsconfig.json, netlify.toml）
- [x] 切片2 Supabase schema（`supabase/migrations/0001_init.sql`, `0002_checkout_support.sql`）—— **已真实执行到线上 Supabase 项目**
- [x] 切片3 `products.json` 全部72个商品加了 `sku` 字段，已同步 seed 进 Supabase 的 `product_variants`/`inventory`
- [x] 切片4 前台购物车/结账 UI（`src/cart.ts`, `src/checkout.ts`），含 i18n（中英文），已修复语言切换时错误提示文案不刷新的 bug
- [x] 切片5 Netlify Functions（`products-live.ts`, `create-checkout-session.ts`, `stripe-webhook.ts`, `admin-refund-order.ts`, `release-expired-reservations.ts`）—— **已用真实 Stripe test mode + 真实 Supabase 联调跑通**（返回真实 checkoutUrl/orderId）

**关于怎么把 migration/数据改动跑到真实 Supabase（后续 session 照这个来）**：
这台机器**没有装 Supabase CLI**（`which supabase` 查不到），本地也没配 Postgres 连接串（`.env` 里只有 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 这两个 REST API 层面的凭证，不能直接跑裸 SQL DDL）。所以每次要新增/改表结构，走的是：
1. 浏览器打开 Supabase Dashboard 的 SQL Editor：`https://supabase.com/dashboard/project/zmnkzopqwfawkctrbgfd/sql/new`（项目是 `trinity-globe`，在 `MikeQih's Org` 底下；这台机器的 Chrome 一直是登录状态，不用重新登录）
2. 把 migration 文件内容整段贴进编辑器（用剪贴板 `navigator.clipboard.writeText` + `cmd+v`，比让浏览器工具逐字符打字更可靠，尤其是 SQL 里有转义单引号的时候）
3. 点 Run，确认返回 "Success"
4. 用一个临时的 `.mjs` 脚本（读 `.env`、`@supabase/supabase-js` 连接、查询确认字段/数据、跑完就删掉）验证改动真的生效了——这个仓库里没有留任何这类脚本，都是用完即删

像批量把 72 个产品的 `case_size` 设成占位值 12 这种"改数据不改表结构"的操作，也是同样走一个临时 `.mjs` 脚本 + `service_role` key 直接调 `supabase-js` 的 `.update()`，不走 SQL Editor。

`supabase/migrations/*.sql` 这些文件本身**不会被任何工具自动跑到线上**——它们只是留档，真正生效必须手动走上面这个流程。

**2026-08-20 修复1：支付成功购物车未清空**。用户实测下单后发现"支付完购物车没清空"。查代码发现 `src/cart.ts` 确实没有处理 Stripe 支付成功跳转回来的 `?checkout=success` 参数。已修复：`handleCheckoutRedirect()`（`src/cart.ts`）在页面加载时检测该参数，成功则清空购物车 + 弹出金色提示条（新增 `.cart-toast` 样式于 `style.css`，新增 `cart-order-success`/`cart-order-cancelled` 文案于 `script.js` 两种语言），并清理 URL 参数防止刷新重复触发。已过 typecheck + 浏览器实测（模拟 `?checkout=success&order_id=...` 跳转，确认 localStorage 购物车清空、徽章消失、提示条正常显示）。

**2026-08-20 修复2：结账页配送方式无说明**。用户指出"标准配送/自提"两个选项没有任何说明，选自提也看不到地址。已修复：`checkoutViewHtml()` 新增 `#ck-delivery-info` 提示区，切换配送方式时动态更新文案（新增 `checkout-standard-delivery-info`/`checkout-self-collection-info` 两语言文案）。**按用户要求，自提的详细地址不在结账页直接展示**，只提示"订单确认后会通过邮件/电话告知"；真正的地址/开放时间/联系人信息改为写进支付成功后的订单确认邮件（`netlify/functions/_lib/email.ts` 新增 `deliveryDetailsHtml()`，`delivery_method === 'self_collection'` 时才附上地址，与 `policies/delivery.html` 保持一致），确保这个"稍后告知"的承诺真的被兑现，不是空话。浏览器实测确认两种配送方式文案切换、地址栏/运费联动均正常。

**2026-08-20 功能3：整箱/五箱自动分级定价（基础设施已上线，等实际箱装数据）**。用户提出把"1 Bottle / 1 Case / 5 Cases"三档价格从纯展示改成可点击直接加购，且同一 SKU 混合数量时应按累计瓶数自动跳档定价（用户已确认这个方案）。已完成：
- 新增 migration `0003_case_pricing.sql`，给 `product_variants` 加了 `case_size`/`five_case_size`/`five_case_price_cents` 三列（`case_price_cents` 本来就有）——**已实际执行到线上 Supabase**，验证过字段可查询。
- `src/pricing.ts` 新增 `effectiveUnitPriceCents(qty, tiers)`，前端购物车（`src/cart-store.ts`/`src/cart.ts`）和后端 `create-checkout-session.ts` 共用同一个函数计价，不会出现"购物车显示一个价、实际扣款另一个价"的情况。
- **顺带修复了一个已存在的真实 bug**：`create-checkout-session.ts` 之前完全没用到 `case_price_cents`，无论买多少瓶都只按单瓶价结算——现在改成按累计数量自动判断档位。
- `script.js#buildPriceGrid`：三档价格本身现在就是点击区（不再有单独的"Add to Cart"按钮，省出卡片空间，符合用户想法）。**关键设计**：只有当某档位的"每箱瓶数"已知时，那一档才可点击；瓶数未知时保持和以前一样的纯文字展示（不会误加购、不会错报价）。
- `admin/config.yml` 加了 "Case Size (bottles)" / "5-Case Size (bottles)" 两个CMS字段，方便后续把每款酒的箱装瓶数直接录进后台。
- `products.json` 目前**没有任何产品填了箱装瓶数**（用户说会陆续提供，不同品类不一样，如干邑/威士忌/白酒等）。**在这些数字补上之前，网站行为和改动前完全一致**（只有"1 Bottle"可点击加购，"1 Case"/"5 Cases"照旧是纯文字或"询价"链接）——这是刻意的安全设计，不会因为不知道箱装数量而卖错价格。
- 已过 typecheck + 48个单测（新增 tiered pricing 相关测试）+ 浏览器实测 + 真实 Stripe/Supabase 端到端下单验证（确认无箱装数据时按单瓶价正确计价）。

**已用统一占位值激活**：用户说"先按照统一12瓶吧 1 Case的数量，后面确定了再单独说"。已把全部72个产品的 `caseSize` 设为 **12**（`products.json` + Supabase `product_variants.case_size` 都已更新，实测真实下单价格 S$510×12 前后端一致）。现在网站上所有产品的"1 Case"档位都能点击购买了；"5 Cases"因为目前没有产品填五箱价，仍是"询价"。**等用户提供每款酒实际箱装瓶数后，需要逐个覆盖这个12的占位值**（改 `products.json` 对应产品的 `caseSize` + Supabase 对应行的 `case_size`）。

**2026-08-20 修复4：购物车里已存在的商品，价格档位不会跟着新数据刷新**。用户在实测时发现：先加购的 Hennessy VSOP 攒到17瓶了，还是显示单瓶价S$85，没有变成箱价S$80（明明17>12该享受箱价）。根本原因：`CartItem.priceTiers` 是"加购那一刻"的价格快照，存进 localStorage 后不会再更新——那个17瓶的购物车项是在我给 `caseSize` 赋值*之前*就加进去的旧快照，之后哪怕数据库/products.json 更新了，已经在购物车里的商品也不会自动感知。已修复：`src/cart.ts` 新增 `reconcilePriceTiers()`，在每次**打开购物车抽屉**时，把购物车里每一项的价格档位跟当前网站商品数据重新核对一遍，不一致就刷新（`CartStore.updatePriceTiers()`，无变化时不触发多余的保存/通知）。这个只影响*展示的估算价*，不影响真实扣款——真正付款金额永远由 `create-checkout-session.ts` 在提交时用 Supabase 里的实时数据重新计算，所以此前即使显示价格是旧的，也不会真的多收/少收钱。**已用模拟旧快照数据在浏览器里验证**：17瓶从S$85/瓶自动刷新为S$80/瓶("Case price"标签同步出现)，小计从S$1445变成正确的S$1360。

**2026-08-20 功能5：购物车数量支持直接输入**。用户提出大宗客户可能要买几百瓶，不想一个个点加号。已把购物车里数量的纯展示文字换成可编辑的数字输入框（`.cart-item-qty-input`，和原有的+/-按钮并排），输入后失焦/回车才提交（避免打字过程中触发更新），仍复用 `CartStore.updateQty` 原有的"数量清零则移除"和"数量上限"逻辑。顺带把 `MAX_QTY_PER_ITEM` 从 120 提到 **999**（原先120是给点击加购用的保守上限，现在真要支持大宗直接输入，需要更高）。已浏览器实测：直接输入250瓶，小计正确变成S$20,000（按箱价250×80）；改成3瓶后正确切回单瓶价S$85且标签消失。

**2026-08-20 调整：产品卡片改回单一"Add to Cart"按钮**。用户想清楚了之后，觉得三档价格分别可点击的方式在手机端不好点（价格格子太窄），而且既然购物车里已经能手动改数量、还会自动匹配对应档位价格，产品卡片上就不需要"选箱数点击"这个交互了。已把 `script.js#buildPriceGrid` 改回纯展示（不可点击），产品卡片重新加回原来那个单独的"Add to Cart"按钮（只加1瓶）。**注意：这只是撤销了"卡片上点哪个价位加购哪个数量"这个UI交互，之前做的购物车自动分档定价、价格档位自动刷新、数量输入框这些都完整保留**——买多瓶享受箱价这件事现在完全通过"加购1瓶 → 在购物车里改数量/输入数字"来实现。已清理掉相关的、不再需要的CSS覆盖规则；typecheck、50个单测、浏览器实测（点击Add to Cart正确加购1瓶，价格档位数据完整）都过了。

以上六处改动（自提地址延迟展示+邮件补充、后端计价bug修复、整箱数据占位值、购物车过期价格自动刷新、数量输入框、产品卡片按钮改回单一Add to Cart）**已经 commit**（`c028345`，2026-08-20，在 `dev` 分支，还没 push）。

---

## 2026-08-20（第二轮）：政策页面导航 + 中英文切换框架

用户参考 paneco.com.sg 的政策页面（如 `/privacy-policy`），提出三点：
1. Footer 上的 "Contact" 链接没必要——导航栏本来就有 Contact，滚动到底部"Get in Touch"区块，是重复的
2. 政策页面左上角应该有一个类似 paneco 那种"面包屑"返回方式（房子图标 › 页面名）
3. 政策页面完全没有中英文切换

**已完成**：
- `index.html` footer 去掉了 "Contact" 链接（`nav-lang`/`policy-links` 之外的部分不受影响）
- 5个政策页面（`terms.html`/`privacy.html`/`delivery.html`/`refund.html`/`age-restriction.html`）都加了面包屑导航。**图标没有照抄paneco的房子图标**——跟用户确认后，改用了网站本来就有的 TG 圆形logo（`images/logo-transparent.png`，跟顶部导航栏用的是同一张图），逻辑是：客户已经在每个页面顶部见过这个圆形logo，用它做"返回"标识比一个通用房子图标更贴品牌、识别度更高。样式：logo + `›` + 页面名，点击直接回首页。原来顶部那条完整的logo导航条（sticky，一直吸顶）保留没动，两者不冲突（一个是持续可见的顶部条，一个是内容区域里更明确的"返回"提示）。
- 5个政策页面加上了中英文切换（"English"/"中文"按钮，右上角，和主站同一个视觉样式 `.nav-lang`）。**新建了独立文件 `policies/policy-i18n.js`**，没有直接引用主站的 `script.js`——因为 `script.js` 的启动流程（`loadProducts()`/`buildFilterTabs()`/`initFilter()` 等）里有好几处 `document.getElementById(...)` 没做空值判断，政策页面没有商品网格/搜索框这些元素，直接引用会直接报错崩掉整个页面。`policy-i18n.js` 只负责这几个页面真正需要的东西：面包屑文字、页面标题、"法律"分类标签的中英切换，语言选择存在 `localStorage`（key: `tg_lang`），5个政策页面之间跳转会记住语言选择。

  **范围说明（跟用户确认过）**：现在只是把"切换的框架/机制"搭好了，**政策正文（条款细则、隐私条款、配送细则等法律文字本身）现在还是纯英文，没有跟着切换变化**。因为这些正文目前还是法律审阅前的英文草稿，贸然机翻容易出错，而且审阅通过后原文本身还会改。所以正文没有接 `data-i18n`，切成中文时只会变化标题/面包屑这些"外壳"文字，正文保持英文，同时页面顶部会出现一行小字提示"本页面内容目前仅提供英文版本，中文翻译稍后补充"，避免客户以为是页面坏了。**等法律审阅通过、正文定稿后，只需要给对应的段落加 `data-i18n` 属性 + 在 `policy-i18n.js` 里补上对应中文文案就行，不需要改动其他任何东西。**

浏览器实测：面包屑点击返回首页正常；语言按钮切换后标题/面包屑/提示文案正确变中文，正文保持英文；切换到另一个政策页面语言选择保持不变。

以上（footer去Contact、5个政策页面面包屑、政策页面中英文切换框架）还没 commit。
- [x] 切片6 订单后台 `admin-app/`（登录页已验证渲染正常，OrdersList/OrderDetail 已写但未接入真实管理员账号测试）
- [x] 切片7 测试：42个 Vitest 单测全过；Playwright e2e 骨架已写，因需真实密钥暂未跑

**关键正确性设计**：库存预留模式（reserve → confirm/release），避免"最后一瓶被两人同时买成功"。已用 Docker Postgres 验证过原子性/并发安全。

**这次session修复的bug**：`netlify.toml` 缺少 `[dev] framework = "#static"`，导致 `netlify dev` 误判成 Vite 项目、卡住等待不存在的 dev server。加上这行后 local 环境（`netlify dev` + `npm run dev`）跑通。

---

## 三方账号进度

### Stripe —— 阻塞中，等 Wang Lei 完成身份验证
- 账户：`acct_1U66mYBAev1issbv`，商户类目已选"含酒精饮品"零售
- 状态：审核中有 2 个逾期任务，**需要 Wang Lei 本人**（占股30%、实际操作人，非 Bizfile 登记董事）通过 Singpass 或人工上传证件完成身份核验 + 补充授权文件
- 已在 `.env` 配了 test mode 的 `STRIPE_SECRET_KEY`（sk_test_），代码已验证可用
- **下一步**：确认 Wang Lei 是否已通过已打开的 Singpash tab 完成验证 → 去 `https://dashboard.stripe.com/acct_1U66mYBAev1issbv/account/status` 确认"支付"状态从"即将暂停"变回"活跃"

### Supabase —— 已完成
- 项目已建，`SUPABASE_URL=https://zmnkzopqwfawkctrbgfd.supabase.co`
- 两个migration都已跑到真实库，10张表确认存在
- 本地 `.env` 和 `admin-app/.env` 都已配好 URL/anon key/service role key（legacy JWT格式，兼容当前装的 `@supabase/supabase-js@^2.45.4`）

### Resend —— 已完成
- 域名 `trinityglobe.sg` DNS 验证通过，发信测试成功
- `RESEND_FROM_EMAIL=orders@trinityglobe.sg`
- `STAFF_NOTIFICATION_EMAILS=2537175447@qq.com`（临时用自己的邮箱测试，**后续要换成老板真实邮箱**）

### Airwallex —— 正在注册中，进行到 KYC 流程
- **重要：这不是替换 Stripe，只是先注册占位**，因为 Airwallex 更适合大宗跨境批发场景，跟 Trinity Globe 现阶段"个人零售"模式不完全匹配，已跟同事说明两次
- 已确认信息：
  - 主体名称：TRINITY GLOBE TRADING PTE. LTD.（UEN 202509360N）—— 已在系统里确认锁定
  - 计划：选了 Explore（免费档）
  - Main Industry：Retail: Food and beverage
  - Additional industry：留空（没有超过40%营收的其他行业）
  - Monthly revenue：待选 **50,000–100,000 SGD**（年流水刚超S$1M，月均约83k）
- **当前卡住的点：List of business owners 页面**
  - Bizfile 记录的股权结构：
    - WANG LEI（个人）持股 **30%**（150,000股）
    - **SC PRIME HOLDINGS PTE. LTD.**（公司股东，非自然人）持股 **70%**（350,000股）
  - 官方登记的 Officer(s)：MA XIANGQIAN（Secretary，中国籍），SHEN CHUAN（Director，新加坡籍）
  - Airwallex 自动识别出 "Lei Wang = Beneficial owner"、"Chuan Shen = Director" 这两行，但**没有自动穿透 SC Prime Holdings 背后的自然人**——这是监管要求（受益所有人=直接或间接持股25%+的自然人），系统不会自动补全，需要人工确认再手动添加
  - 用户说 SC Prime Holdings 背后"其实就是 Wang Lei 和 Sean（Shen Chuan）两个人"，**但具体两人在 SC Prime Holdings 里的持股比例还未确认**
  - **下一步（待用户提供）**：Wang Lei 和 Shen Chuan 在 SC Prime Holdings Pte. Ltd. 里各自的持股比例，据此计算：
    - Shen Chuan 间接持股 = 70% × (他在SC Prime的比例)，若 ≥25% 则要在Airwallex表单里把他改成 "Beneficial owner & Director"
    - Wang Lei 总受益权益 = 直接30% + 70%×(他在SC Prime的比例)
  - Supporting document 那一栏：需要 SC Prime Holdings 自己的股东名册/股权结构文件（如果没有，Airwallex 提供模板可以自己填）
  - "Do any business owners hold shares or act on behalf of a third party?" 这题也要确认 SC Prime Holdings 是不是代持性质，还是正常控股公司（正常情况选 No）

---

## 尚未开始（部署相关）

- [ ] 把已写好的购物车/结账代码**部署到真正的生产 Netlify 站点**（目前只在本地 `netlify dev` 测试过）
- [ ] Stripe webhook 指向生产环境公网 URL，拿到 `STRIPE_WEBHOOK_SECRET`，本地和 Netlify 后台都要配
- [ ] Netlify 后台生产环境变量：`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`STRIPE_SECRET_KEY`（届时切换成 sk_live_）/`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`STAFF_NOTIFICATION_EMAILS`/`SITE_URL`/`ADMIN_APP_ORIGIN`
- [ ] `admin-app/` 部署上线，配好 `ADMIN_APP_ORIGIN` 让 `admin-refund-order.ts` 的 CORS 认得它
- [ ] 在 Supabase Auth 建第一个真实管理员账号 + 插入对应 `admin_profiles` 行
- [ ] 库存：目前所有72个SKU都是**占位库存20**（用户已明确说"先放着，后续再调整"），真实上线前要换成真实库存数
- [ ] 政策页面（`policies/*.html`）法律审阅：目前 UEN、运费(S$15)、免运费门槛(S$120)、自提地址（11-03 The Suites Central, 57A Devonshire Road, S239897）、自提时间（24小时）已确认写死；配送时效/配送范围/派送失败处理流程仍是占位符，等业务决定；用户说"后续会找人过"法律
- [ ] GST：数据库 `store_settings.gst_registered` 目前是 **false（占位）**。**这次对话发现一个重要合规提醒**：公司年营收已超S$1M，按新加坡IRAS规定这已经触发强制注册GST的义务（超门槛后30天内需注册），**需要尽快跟老板/会计确认公司是否已经注册GST**，这直接影响网站价格是否要显示含税、以及是否已经存在合规风险

---

## 重要的操作纪律（继续遵守）

- **账号隔离**：Stripe/Supabase/Resend/Airwallex 全部用全新专属账号，不复用用户其他项目（如"Owo99" Stripe、"collabify"等Supabase项目、"miaotie.fun" Resend域名）的账号/密钥
- **密钥不落入我的可见输出**：拿到密钥后用剪贴板（`navigator.clipboard`）+ `pbpaste` 管道直接写入本地 `.env`，不在对话里回显
- **不擅自commit**：只有用户明确说"commit一下"才创建 git commit/push，不主动做
- **不替用户填身份/财务信息**：账号注册里的法定姓名、身份证件、KYC材料等必须用户/Wang Lei本人填，我只负责核对信息是否和Bizfile一致、给出该填什么建议
- **如实申报优先**：所有营收/行业/股权类申报字段，建议如实按实际情况填，不建议为了"好看"或"怕麻烦"少报/多报——过往在Stripe那边的经验是，申报和实际不符容易在后续审核触发风控冻结

---

## 下次打开新session，最该先做的事

1. 问用户：Wang Lei 和 Shen Chuan 在 SC Prime Holdings Pte. Ltd. 里的持股比例，把 Airwallex 的 beneficial owner 列表补完整再继续
2. 追问：Wang Lei 的 Stripe 身份验证走到哪了，能不能确认支付功能状态恢复"活跃"
3. 提醒老板确认公司是否已注册 GST（年营收已超S$1M）
