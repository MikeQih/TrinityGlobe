# Trinity Globe 商城项目 — 当前状态清单

> 用途：新开 session 时把这份文件读一遍就能接着做。会随进展更新，别当成一次性交接文档。
> 最后更新：2026-08-26
> **上线前还差什么，直接看"上线前检查清单"这一节**（在"三方账号进度"后面）。当前状态：功能开发已完成，用户明确说"现在还没准备好"，先不合并 `dev` 到 `main`——不要主动催。

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

以上（footer去Contact、5个政策页面面包屑、政策页面中英文切换框架）**已经 commit**（`16ccaa3`，2026-08-20，在 `dev` 分支，还没 push）。

---

## 2026-08-20（第三轮）：Netlify 生产环境变量 + 第一个管理员账号

用户确认"不依赖外部信息的部署准备工作"可以先做，做了两件事：

**Netlify 生产环境变量已配置**：登录 `app.netlify.com`（trinity-globe 项目，浏览器一直保持登录状态），通过"Import from .env file"一次性导入了10个变量：`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`STRIPE_SECRET_KEY`（还是测试用的 `sk_test_`）/`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`STAFF_NOTIFICATION_EMAILS`/`FREE_SHIPPING_THRESHOLD_CENTS`/`STANDARD_SHIPPING_FEE_CENTS`/`SITE_URL`（设成了正式域名 `https://trinityglobe.sg`，跟本地 `.env` 里的 `localhost:8888` 不一样）。全部标记为 secret，作用域 Builds/Functions/Runtime，覆盖 Production 在内的5个部署环境。**`STRIPE_WEBHOOK_SECRET` 和 `ADMIN_APP_ORIGIN` 还是空的**，要等真正部署、有公网URL后才能配。

确认了 Netlify 项目的生产部署分支是 **`main`**（当前 `main@3c4e996`），跟之前的判断一致——dev分支的改动要合并到main才会真正上线。

**`admin-app` 是什么，为什么需要登录**：这是给内部员工（老板/客服）用的订单管理后台，不是给客户用的——类似 Shopee 卖家后台，用来看订单列表/详情、流转订单状态（待付款→已付款→备货中→自提/配送中→完成）、处理退款。因为涉及客户姓名/电话/地址/金额这类内部数据，所以要登录才能进，不能谁都能看。开通一个员工账号的流程是：在 Supabase 后台建一条记录（选好权限：admin/ops/finance_readonly）→ 系统发邀请邮件到员工邮箱 → 员工点链接自己设置密码 → 以后用"邮箱+密码"登录。

**创建了第一个管理员账号**：用 Supabase Auth 的 `inviteUserByEmail` 给 `qihengchang1014@gmail.com` 发了邀请邮件（用户自己选的），并在 `admin_profiles` 表插入了对应行（`role: 'admin'`）。**密码由收件人自己在邀请邮件里设置，没有经过我手上**。

**发现一个待办缺口，已经修复**：`admin-app/src/pages/Login.tsx` 当时只有邮箱+密码登录表单，完全没有处理 Supabase 邀请邮件里那个"设置密码"跳转链接（`#access_token=...&type=invite`）的逻辑。已修复：
- 新增 `admin-app/src/pages/SetPassword.tsx`，一个"设置新密码"表单页
- `App.tsx` 新增 `isInviteFlow` 检测（在模块加载时同步读取 `window.location.hash` 里的 `type=invite`/`type=recovery`，抢在 Supabase 客户端自动清掉这个hash之前拿到），检测到就路由到 `/set-password`，而不是直接放行进 `/orders`（`Protected` 组件和兜底路由都加了这个判断，双重保险）
- **顺带发现第一次发的邀请邮件本身也配错了**：`redirectTo` 当时写成了 `http://localhost:8888`（storefront 的端口），而 `admin-app` 本地实际跑在 `5173`。已改正并重新发送邀请邮件到 `qihengchang1014@gmail.com`
- 用 Supabase API 单独生成了一个测试用邀请链接（没有实际发邮件），在浏览器里走了一遍，确认能正确跳转到新建的"设置密码"页面。**没有替用户设置密码**——这一步应该由账号所有者自己完成，我只验证了跳转链接对不对。

**⚠️ 注意**：因为测试时生成了一个新的邀请令牌，**之前发到 `qihengchang1014@gmail.com` 的邀请邮件（包括重发的那封）大概率已经失效**。用户要用的时候需要再触发一次全新的邀请邮件（我可以随时重新发）。

---

## 2026-08-20（第四轮）：admin-app 正式部署上线

用户确认要处理"重发邀请邮件"和"admin-app部署上线"这两件事。

**过程中发现**：`inviteUserByEmail` 对已经确认过邮箱（哪怕没设密码）的账号会报错"already registered"——原因是之前测试邀请链接时，访问那个链接本身就把邮箱标记成"已确认"了，即使没有真正设置密码。改用 `resetPasswordForEmail`（更准确的说是"设置/重置密码"这条路，跟前端逻辑复用同一套 `isInviteFlow` 检测）来解决，但 Supabase 自带邮件服务的默认速率限制很低，连续测试后触发了"email rate limit exceeded"。**后续都改用「生成链接但不发邮件 + 直接写入本机剪贴板」的方式**给用户，不再依赖 Supabase 自带的邮件发送。

**admin-app 已经正式部署上线**：`https://trinity-globe-admin.netlify.app`（Netlify 新建了一个独立站点 `trinity-globe-admin`，部署源是同一个 GitHub 仓库、`dev` 分支、`admin-app/` 子目录）。

**部署过程踩了一个坑，已经修复并 push**：Netlify 后台的"Publish directory"设置显示是对的（`admin-app/dist`），但实际发布出来的却是没构建过的源代码（浏览器打开是空白页，`index.html` 里引用的是 `/src/main.tsx` 而不是构建后的 `assets/xxx.js`）。排查发现是**仓库根目录那个 `netlify.toml`（storefront 项目用的）被 Netlify 误当成了 admin-app 这个新站点的配置在用**，它的 `publish = "."` 覆盖了后台界面上填的值。修复：新增了 `admin-app/netlify.toml`（只属于这个站点自己的配置，不影响根目录那份），里面除了正确的 `publish = "dist"`，还加了 React Router 需要的 SPA fallback 重定向规则（不然邀请邮件链接跳到 `/set-password` 这种非首页路径会直接 404）。**这个改动已经 commit + push 到 `dev` 分支**（连同之前两次未推送的 commit 一起推了上去，用户已确认）。

重新生成了一个指向正式网址（而不是本地 `localhost:5173`）的"设置密码"链接，直接写进了本机剪贴板，用户可以自己粘贴到浏览器打开、设置密码、正式登录测试。

**当前 admin-app 部署配的环境变量**：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_STOREFRONT_FUNCTIONS_URL`（设成了 `https://trinityglobe.sg`，这个要等 dev 合并进 main、storefront 的 Functions 真正上线才会生效，现在配着算是提前占位）。

**又发现并修复一个坑：Supabase Auth 的 Site URL 还是初始建项目时的默认值**。用户第一次点"设置密码"链接时报错"localhost refused to connect"——查了 Supabase 后台 Authentication → URL Configuration，发现 `Site URL` 还停留在项目刚建好时的默认值 `http://localhost:3000`，`Redirect URLs` 允许列表是空的。Supabase 的规则是：如果 `generateLink`/`inviteUserByEmail` 传的 `redirectTo` 不在允许列表里，会被直接忽略、退回到 `Site URL`——这就是之前生成的链接为什么跳去了 localhost。**已修复**：`Site URL` 改成了 `https://trinity-globe-admin.netlify.app`，`Redirect URLs` 加了这个正式地址和本地 `localhost:5173`（方便以后本地调试）两条，都带 `/**` 通配符。已重新生成一个新链接（旧的、之前生成的两个都已作废），生成后打印确认了 `redirect_to` 参数确实指向正式网址，再放进用户剪贴板。

**用户还没有完成设置密码这一步**——如果下次还遇到登录问题，先确认这一步有没有走完。

- [x] 切片6 订单后台 `admin-app/`（登录页已验证渲染正常，OrdersList/OrderDetail 已写但未接入真实管理员账号测试）
- [x] 切片7 测试：42个 Vitest 单测全过；Playwright e2e 骨架已写，因需真实密钥暂未跑

**关键正确性设计**：库存预留模式（reserve → confirm/release），避免"最后一瓶被两人同时买成功"。已用 Docker Postgres 验证过原子性/并发安全。

**这次session修复的bug**：`netlify.toml` 缺少 `[dev] framework = "#static"`，导致 `netlify dev` 误判成 Vite 项目、卡住等待不存在的 dev server。加上这行后 local 环境（`netlify dev` + `npm run dev`）跑通。

---

## 三方账号进度

### Stripe —— 身份验证已完成（2026-08-26 确认）
- 账户：`acct_1U66mYBAev1issbv`，商户类目已选"含酒精饮品"零售
- **Wang Lei 的身份验证 + 账户代表信息/补充文件已全部审核通过**：Stripe 后台"账户状态→任务"的"已完成"标签下，"验证 Wang Lei 的身份"（2026-08-22）、两次"提供账户代表信息"（2026-08-22、2026-08-26）、"提供账户代表补充文件"（2026-08-26）都标注了完成日期；"已激活"（待处理）标签下已经没有任何任务，用户亲自截图确认过。之前"审核中有逾期任务、需要 Wang Lei 补充材料"这个阻塞状态已经解除。
- 已在 `.env` 配了 test mode 的 `STRIPE_SECRET_KEY`（sk_test_），代码已验证可用
- 未逐项核对过的细节（不算阻塞，只是没专门去看）：账户详情页里"Charges enabled / Payouts enabled"这类整体收款状态没有单独截图确认，但"已激活"任务清空 + 身份验证任务标完成，基本可以认为账户已经正常可用
- **2026-08-22 品牌装饰**：用户看到结账页默认是通用骰子图标，问能不能装饰。传了网站自己的金色 TG 圆形logo（`images/logo-transparent.png`，压缩到512KB以内），品牌色/强调色都改成了网站的金色 `#c9a84c`（跟 `style.css` 里的 `--gold` 一致）。

  **踩坑记录**：第一次改的是 `acct_1U66mYBAev1issbv`（live/正式账号）的品牌设置，改完用户反馈"没有变化"——排查发现 Stripe 新出了「沙盒」（Sandbox）功能，是**完全独立的账号**（`acct_1U66mfB3ybi6Kwed`，注意是 `mf` 不是 `mY`），有自己独立的一套品牌/设置，跟正式账号不共享。日常测试用的 `create-checkout-session.ts`（配的是 `sk_test_`）走的就是这个沙盒环境。**已经在沙盒账号里重新设置了一遍**，图标/Logo/品牌色/强调色都配好并保存了，这次预览里能看到金色横幅+金色支付按钮生效。

  **以后要记住**：这个项目的 Stripe 有两套完全独立的品牌/部分设置——`acct_1U66mYBAev1issbv`（正式账号，Wang Lei身份验证走的是这个）和 `acct_1U66mfB3ybi6Kwed`（沙盒，日常本地测试走的是这个）。以后任何"结账页长什么样"相关的设置改动，只要是给测试环境看的，都要在沙盒账号那边改，不是正式账号。

### Supabase —— 已完成
- 项目已建，`SUPABASE_URL=https://zmnkzopqwfawkctrbgfd.supabase.co`
- 两个migration都已跑到真实库，10张表确认存在
- 本地 `.env` 和 `admin-app/.env` 都已配好 URL/anon key/service role key（legacy JWT格式，兼容当前装的 `@supabase/supabase-js@^2.45.4`）

### Resend —— 已完成
- 域名 `trinityglobe.sg` DNS 验证通过，发信测试成功
- `RESEND_FROM_EMAIL=orders@trinityglobe.sg`
- `STAFF_NOTIFICATION_EMAILS=2537175447@qq.com`（临时用自己的邮箱测试，**后续要换成老板真实邮箱**，目前还没换）
- 订单确认邮件（`netlify/functions/_lib/email.ts`）已支持按配送方式动态调整内容：自提订单会自动附上完整地址/时间/联系方式，详见上面"修复2"

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

## 上线前检查清单（2026-08-26 整理，按阻塞程度分类）

**用户已明确表示现在还没准备好上线，先不把 `dev` 合并到 `main`**——不要主动提起或推动合并，等用户自己说要上线再做。下面这份清单是"等用户决定要上线时"要过一遍的东西。

### 必须做（不做会直接出问题）

- [ ] **库存统一为 50 只是临时测试基线，不是真实可售库存，上线前必须重新录入**——数据库 `inventory.website_stock` 目前 72 行统一是 50（最近一次是 2026-08-26 admin-app 回归测试后重新拉平的，测试过程中一度有 SKU 因脚本清理疏漏偏离过基线）。**在运营明确确认每款酒实际分配给官网的可售数量之前，绝不能把这个 50 当成真实库存直接开放付款**——客户付了钱却缺货，只能事后退款，既影响体验也会给 Stripe 的风控数据留下坏记录。正式开放付款前二选一：(a) 如果确认每款酒实际至少有 50 瓶，可以继续沿用 50；(b) 实际数量不确定的话，建议先保守设成每款 1–5 瓶，老板盘点后再在 admin-app 里逐个调高。**这一条不需要写代码，是纯运营确认项。**
- [ ] **Stripe 还在 test mode**——`.env`/Netlify 后台配的是 `STRIPE_SECRET_KEY=sk_test_`，上线收真钱前要换成 live key（`sk_live_`）；换 key 的同时要把 Stripe webhook 指向生产环境公网 URL，重新拿一次 `STRIPE_WEBHOOK_SECRET`，本地和 Netlify 后台都要配（目前是空的）。
  **2026-08-26 已核实（用户明确只要求先做这一步确认，还没要求切 live key）**：登录 Stripe 正式账号（`acct_1U66mYBAev1issbv`）→ 设置 → 商家 →"账户状态"，右侧"功能"栏确认 **支付（Charges）和 Payouts 都是"活跃"状态**（唯一"已暂停"的是 Cartes Bancaires，法国本地卡组织，跟新加坡业务无关，不影响）；"银行账户和货币"页确认已经关联了默认 SGD 收款账户（DBS Bank/POSB）。**结论：账户已经具备实际收款+提现能力，不是只过了身份验证。** 真正切 live key 时还有个真实风险要注意：现在 Netlify 的环境变量是"All scopes / 全部5个部署环境同一个值"，包括公开的 `dev--trinity-globe.netlify.app` 预览站——直接把 `STRIPE_SECRET_KEY` 全局换成 live 会让那个公开预览站也开始跑真实扣款。更安全的做法是用 Netlify"按部署环境设不同值"这个功能（不需要升级付费版），只给 Production 配 `sk_live_`，其余环境继续留 `sk_test_`。
- [x] ~~前端环境变量 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 还没加进 Netlify 生产站点~~——**2026-08-26 已完成**：登录 Netlify 后台（`trinity-globe` 项目 → Project configuration → Environment variables），两个变量都已添加（All scopes，Same value in all deploy contexts，跟其他现有变量的配置方式一致），值取自本地 `.env`。这两个是客户端匿名key，本身就会被打进浏览器构建产物，不算敏感信息。
- [ ] **GST 注册信息确认**——2026-08-26 已把数据库设计从一个手动 boolean 改成基于生效日期（详见下面"GST 生效日期设计"一节），代码已经按"未注册期间绝不显示/收取 GST"的规则实现并上线，**但目前 `store_settings.gst_registration_effective_at` 仍是 `null`（即当前网站对所有订单都不收 GST）**。公司年营收已超 S$1M，按 IRAS 规定这已经触发强制注册 GST 的义务（超门槛后 30 天内需注册）。需要向老板/会计确认的不是简单的"是否注册"，而是两个具体信息：**(1) 公司的 GST Registration Number；(2) IRAS 批准信上注明的 GST Registration Effective Date**。拿到这两项后，只需要在 `store_settings` 表里填入这两个字段，新订单会从生效日期当天起自动开始按 9/109 计算并显示 GST，不需要再改代码。
- [x] ~~邮件发送失败追踪账本~~——**2026-08-27 已完成并在 Deploy Preview 上真实端到端验证通过**，详见下面"第十一轮"和"第十三轮"。真实 Resend webhook（不是自签模拟）已经确认能推到 `https://deploy-preview-1--trinity-globe.netlify.app/.netlify/functions/resend-webhook`，签名验证通过，`email_logs` 状态正确从 `accepted` 推进到 `delivered`/`bounced`。**合并 main、切到生产 Resend webhook 之前还要做**：去 Resend 后台给正式生产域名再注册一个 webhook endpoint（现在这个是专门指向 Deploy Preview 的，域名不一样），拿到那一份的签名密钥配到 Netlify 的 Production 环境。
- [ ] **Node 版本：仓库 `.nvmrc` 之前一直写死 `20`，已经不满足现在的依赖要求，2026-08-27 才发现并修复**——`@supabase/supabase-js`（`realtime-js` 子依赖）和 `svix` 现在都要求 Node 22 原生 WebSocket；Deploy Preview 上真实调用任何一个用到 `getSupabaseAdmin()` 的 Function（也就是几乎全部 Function）都会报 `Node.js detected but native WebSocket not found` 直接崩溃。已经把 `.nvmrc` 改成 `22`（commit `befb13c`）并在 Netlify 的 **Deploy Previews** 环境额外加了 `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`，在 Deploy Preview 上真实验证过修复生效。**合并 main 之前必须单独确认 Production 环境的 Functions 也运行在 Node 22**——Production 目前没有配 `AWS_LAMBDA_JS_RUNTIME`（这个变量目前只加在 Deploy Previews 一个环境），虽然 `.nvmrc` 现在是 22 理论上 Production 构建也会用这个版本，但没有像 Deploy Preview 那样真实验证过，不能想当然地认为一定没问题。
- [ ] 把已写好的购物车/结账代码**部署到真正的生产 Netlify 站点**（目前只在本地 `netlify dev` 测试过）——需要合并 `dev` 到 `main`
- [ ] **确认 `release-expired-reservations` 这个定时释放库存的 Function 真的在 Netlify 生产环境跑着**——2026-08-26 admin-app 回归测试时发现好几条库存预留早就过了 `expires_at` 但状态还停在 `pending`，说明这个任务大概率从来没在生产环境真正成功执行过。Netlify Scheduled Functions **只在正式 Published Deploy 上运行，Deploy Preview/branch deploy 不会自动跑**，所以本地 `netlify dev` 测试正常不代表生产环境真的在跑。上线前必须手动确认：(1) Netlify 后台 Functions 列表里能看到这个函数、cron 时间对；(2) 它需要的环境变量对 Functions 可用，且改动环境变量后已经重新部署过；(3) 手动点一次"Run now"；(4) 建一笔到期时间很短的测试预留，等它到期后确认订单状态/预留状态/库存三者都正确变化；(5) 再跑一次，确认不会对同一笔预留重复加库存。代码这边已经加了心跳记录（见下面 2026-08-26 admin-app 回归那一轮）：admin-app 订单列表页顶部会在这个任务超过15分钟没成功执行时显示醒目警告，可以直接用它来判断生产环境是否正常。

### 建议做但不是技术阻塞

- [ ] 政策页面（`policies/*.html`）法律审阅：UEN、运费(S$15)、免运费门槛(S$120)、自提地址（11-03 The Suites Central, 57A Devonshire Road, S239897）、自提时间（24小时）已确认写死；配送时效/配送范围/派送失败处理流程仍是占位符，等业务决定；用户说"后续会找人过"法律
- [ ] Facebook 登录：应用图标没传、App Review 没提交，不提交的话正式环境的 Facebook 登录选项对非测试用户不可用（Google 登录、邮箱注册不受影响）

### 跟支付/上线无关，不阻塞

- [ ] 老板反馈1（产品后台/订单后台加跳转入口）——纯体验优化
- [ ] Airwallex 的 KYC（持股比例）——跟 Trinity Globe 网站上线无关，是另一条独立的账户注册进度

### 已完成（部署相关，之前做过的）

- [x] Netlify（storefront `trinity-globe` 站点）生产环境变量已配置（`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`STRIPE_SECRET_KEY`(还是sk_test_)/`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`STAFF_NOTIFICATION_EMAILS`/`FREE_SHIPPING_THRESHOLD_CENTS`/`STANDARD_SHIPPING_FEE_CENTS`/`SITE_URL`）
- [x] `admin-app/` **已部署上线**：`https://trinity-globe-admin.netlify.app`（独立 Netlify 站点，见上面第四轮记录）。`ADMIN_APP_ORIGIN` 也已经配到 storefront（`trinity-globe`）项目的环境变量里了，值就是这个正式地址
- [x] 在 Supabase Auth 建了第一个管理员账号（`qihengchang1014@gmail.com`，role: admin），密码还没设置，等用户自己点链接设置
- [x] Wang Lei 的 Stripe 身份验证已完成（见上面 Stripe 账号进度那段）

---

## 2026-08-20（第五轮）：登录页"点了没反应"的真实bug

用户设置完密码、第一次通过邀请链接能正常进后台看到订单列表（订单数据也确认是真实的，跟这次session之前创建的测试订单对得上）。但 Sign out 之后再用邮箱+密码在普通登录页登录，点 Sign in 没反应。

用户截图里的浏览器 Network 面板帮了大忙：`token?grant_type=password` 和 `admin_profiles?select=role...` 都返回 200，说明**账号密码是对的、登录请求本身成功了**。真正的问题是**代码bug**：`Login.tsx` 里 `signInWithPassword` 成功后，没有任何代码告诉页面"该跳转去订单页了"——`AuthContext` 内部状态确实更新了，但 `/login` 这个路由本身没有监听这个状态变化去跳转，所以停在原地，看起来像卡死。（第一次能进去是因为走的是"设置密码"页面，那个页面代码里专门写了`navigate("/orders")`，普通登录页少了这一步。）

**已修复**：
- `Login.tsx`：登录成功后显式调用 `navigate("/orders", { replace: true })`
- `App.tsx`：新增 `LoginRoute` 包装组件，如果已经有session了还停在 `/login`（比如浏览器后退），也会自动跳到 `/orders`，双重保险

已过 typecheck。**这个改动还没 commit/push**——需要推送到 `dev` 分支、Netlify 重新构建后，`https://trinity-globe-admin.netlify.app` 上才会生效。

---

## 2026-08-22：Google + Facebook 登录接入（老板反馈2的第一步）

背景：老板反馈"未登录选完订单之后需要先登录才能进入付款页面，用 Google 登录"。跟用户反复确认后（参考了 paneco.com.sg 实际的结账页——它是 guest checkout 和 create account 并列的选项，不是强制登录），最终方案定为：**保留访客结账，加一个可选的"用 Google 登录"入口**，不强制登录。用户说"现在就开始（先从 Google 登录接入入手）"。

**Google Cloud + Supabase 基础设施已搭好**：
- 新建了一个独立的 Google Cloud 项目 `trinity-globe`（跟这个项目其他账号一样，不复用用户别的项目的凭证）
- 配置了 OAuth 同意屏幕（External 受众，因为是面向公众的零售网站，不是内部 Workspace 应用）
- 建了一个 Web application 类型的 OAuth 2.0 Client ID（名字 "Trinity Globe Storefront"），Authorized JavaScript origins 填了 `https://trinityglobe.sg` 和 `http://localhost:8888`，Authorized redirect URI 填了 Supabase 的回调地址 `https://zmnkzopqwfawkctrbgfd.supabase.co/auth/v1/callback`
- Client ID / Client Secret 已经存进本地 `.env`（剪贴板方式写入，没有在对话里回显）
- 在 Supabase 后台（`Authentication → Sign In / Providers → Google`）启用了 Google provider，填入了上面的 Client ID/Secret，保存成功

**storefront 前端代码已实现并浏览器实测通过**：
- 新增 `src/lib/supabase.ts`：浏览器端 Supabase client，读 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`。**关键设计**：跟 `admin-app` 那份不一样，这份**不会**在缺少环境变量时直接抛错——因为这个 client 是跟购物车逻辑打包在同一个 `assets/storefront.js` 里的，抛错会把整个购物车带崩掉。缺环境变量时 `supabase` 导出为 `null`，Google 登录功能静默关闭，访客结账完全不受影响。
- 新增 `src/auth.ts`：封装 `getSession()`/`onAuthChange()`/`signInWithGoogle()`/`signOut()`/`initAuth()`。
- `src/cart.ts` 改造了结账流程，加了一个新的 `checkoutStage`（`"account"` / `"form"`）：
  - 未登录、且 Google 登录已配置、且这次打开还没选过的情况下，点"Checkout"先看到一个选择页（仿 paneco）：**"Sign in with Google"** 和 **"Continue as Guest"** 两个按钮
  - 选 Guest 或已登录，直接跳过这一页进原来的收货表单
  - 已登录时，表单顶部会显示一条"已登录：xxx@gmail.com · 退出登录"的提示条，并自动把邮箱预填进表单
  - **Google 登录走的是完整页面跳转**（`supabase.auth.signInWithOAuth`），跳去 Google 再跳回来会丢失购物车抽屉当时的状态——用 `localStorage`（key `tg_reopen_checkout`）记了个"跳回来要重新打开结账"的标记，`initCart()` 启动时检测到这个标记就自动重新打开抽屉、回到结账页
- 新增 `src/vite-env.d.ts`（跟 `admin-app` 那份一样的写法），给 `import.meta.env.VITE_SUPABASE_*` 提供类型
- `.env`/`.env.example` 补充了 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`（Vite 只会把 `VITE_` 前缀的变量打进浏览器包，跟 `SUPABASE_URL`/`SUPABASE_ANON_KEY` 那两个纯后端用的变量分开）。**顺便清理了 `.env` 文件里一段之前剪贴板误粘贴进去的垃圾文字**（"应用部署：Heroku..."几行，跟这个项目无关，应该是之前从别处复制东西时手滑粘进去的）。
- `script.js`/`style.css` 加了对应的中英文案和样式（`.checkout-account-choice`/`.checkout-account-bar` 等）

**已过 typecheck + build + 浏览器实测**：
- Guest 流程：加购 → Checkout → 看到选择页 → 点 "Continue as Guest" → 正常进入原有收货表单，运费/小计计算不受影响
- Google 流程：点 "Sign in with Google" → **真实跳转到了 Google 的账号选择页**，URL 参数确认了 `client_id`/`redirect_uri`（指向 Supabase 回调）/`redirect_to`（指向 `localhost:8888/`）全部正确匹配——说明 storefront → Supabase → Google 这条链路完全打通了。**没有替用户完成实际登录**（浏览器自动化工具本身也不允许在 Google 登录页操作，这是符合"不替用户输入账号密码"这条纪律的），真正点哪个 Google 账号登录、授权，需要用户自己在浏览器里走一遍。

**修复：登录成功后跳错地方**。用户实测点了 "Sign in with Google" 选好账号后，发现跳去了 `https://trinity-globe-admin.netlify.app/orders`（员工后台的订单页），而不是回到 storefront 的结账页。**根本原因**：Supabase 项目的 Auth `Redirect URLs` 白名单里，当时只有 admin-app 用到的两个地址（`https://trinity-globe-admin.netlify.app/**`、`http://localhost:5173/**`），没有 storefront 本地开发用的 `http://localhost:8888`。Supabase 的规则是：如果登录时传的 `redirectTo` 不在这个白名单里，会被**静默忽略**，退回用 `Site URL`（当时设的正是 admin-app 的地址）——所以才跳错了地方。**已修复**：在 Supabase 后台（`Authentication → URL Configuration → Redirect URLs`）加了 `http://localhost:8888/**` 和 `https://trinityglobe.sg/**`（后者是提前为将来正式上线占位）。修复后用之前登录过的账号重新测试，"已登录"状态条正确显示在 storefront 结账表单顶部，不再跳去 admin-app。**这是一个值得记住的坑**：这个 Supabase 项目同时给 storefront 和 admin-app 两个前端用，Redirect URLs 白名单必须把两边所有会用到的地址都加全，漏一个就会退回 Site URL、跳到"另一个"应用去。

**顺带发现并解释：Google 登录页显示的是 `zmnkzopqwfawkctrbgfd.supabase.co` 而不是 Trinity Globe 相关域名**。去 Google Cloud Console 核实过，OAuth 同意屏幕的"应用名称"确实已经填的是 "Trinity Globe"，不是配置错误。这是 **Supabase 默认 Auth 架构的固有限制**：真正接收 Google 授权码、完成登录的服务器是 Supabase 的回调地址（`zmnkzopqwfawkctrbgfd.supabase.co`），不是 trinityglobe.sg；Google 出于防钓鱼考虑，登录页显示的是这个"真正会拿到用户 Google 数据"的域名，不是开发者自报的应用名称。**要改成显示自己的域名（如 `auth.trinityglobe.sg`），需要开通 Supabase 的付费 Custom Domain 功能**（Pro 套餐 + 额外费用）——问过用户，**决定先不处理，后续再看要不要配**。

### Facebook 登录接入

用户在 Google 跑通之后追加需求："目前只有google登录，再加一个facebook登录吧"。做法和 Google 完全对称：

**Meta 开发者应用已创建**：`https://developers.facebook.com/apps/1424101232919631/`，应用名 "Trinity Globe"，用例选的是"用 Facebook 登录来验证用户身份并请求访问其数据"（Facebook Login），业务资产组合选择了"暂时不绑定"（不需要 Meta 企业验证就能先跑通开发模式测试）。Facebook Login 设置里的"有效 OAuth 跳转 URI"已经填了 Supabase 的回调地址 `https://zmnkzopqwfawkctrbgfd.supabase.co/auth/v1/callback`，和 Google 那边用的是同一个回调（同一个 Supabase 项目）。App ID（`1424101232919631`）和 App Secret 已经存进本地 `.env`（App Secret 用剪贴板方式写入，没有在对话里回显），并在 Supabase 后台启用了 Facebook provider、填入这两个值、保存成功。

**创建应用的过程中有两次 Facebook 自己弹出"请重新输入密码"的二次确认**（创建应用前、查看 App Secret 前各一次）——这两次都是用户自己在浏览器里输入密码完成的，我没有接触密码本身。

**storefront 代码改动**（跟 Google 的实现完全对称，复用同一套账号选择页/状态管理）：
- `src/auth.ts`：把原来专门针对 Google 的内部逻辑抽成通用的 `signInWithOAuth(provider, redirectPath)`，`signInWithGoogle`/`signInWithFacebook` 都是它的薄包装
- `src/cart.ts`：账号选择页（`accountChoiceHtml`）新增了 "Sign in with Facebook" 按钮，跟 Google 按钮并排；新增 `signin-facebook` 的 action 分支，逻辑跟 `signin-google` 一致（记 `tg_reopen_checkout` 标记后跳转）
- `script.js`/`style.css`：新增中英文案 `checkout-signin-facebook`，Facebook 按钮复用跟 Google 按钮同一套 `.checkout-google-btn`/`.checkout-facebook-btn` 样式（没有用 Facebook 品牌蓝色，保持跟网站金色/暗色调一致，两个登录按钮视觉统一，只靠文字区分）

**已过 typecheck + build + 浏览器实测**：账号选择页正确显示"Sign in with Google"和"Sign in with Facebook"两个按钮；点击 Facebook 按钮后**真实跳转到了 `facebook.com/dialog/oauth`**，URL 参数确认 `client_id`/`redirect_uri`（Supabase 回调）/`redirect_to`（`localhost:8888/`）全部正确——storefront → Supabase → Facebook 这条链路也打通了。同样没有替用户完成实际登录。

**⚠️ 重要限制：这个 Facebook 应用目前是"开发模式"**。Meta 开发者面板明确提示"Currently ineligible for submission"，缺应用图标(1024×1024)、隐私政策网址、用户数据删除说明、类别这几项——这些是**将来要让所有客户都能用 Facebook 登录（而不只是开发者自己）时**必须补齐、然后提交 App Review 审核的东西，比 Google 那边的流程更重的（Google 只要基础信息就能给非测试用户用，Facebook 要求先过审核）。**现在只有这个应用的开发者/管理员/测试员账号能实际登录成功**，其他访客点了会失败或看不到登录页。这是下一步要跟用户确认的事项：是否要现在就补齐这些资料去申请 App Review，还是先只保留 Google 登录给真实客户用、Facebook 按钮等审核过了再说。

**这次改动（Google 的 redirect 白名单修复 + Facebook 登录）已经 commit + push**（`24a0150`，`dev` 分支，用户确认过"提交并 push"）。

## 2026-08-22（第二轮）：普通邮箱注册（paneco 风格）+ Facebook App Review 准备

用户看完 Google/Facebook 登录后，参考 paneco.com 的注册页面截图，提出还要有"普通账号注册"——姓名、性别、生日、邮箱、密码，注册时发验证码到邮箱（用户确认要"验证码"这种形式，不要邮件链接）。同时提出"我现在就要填写 Facebook 的资料申请 App Review"。这一轮把这两件事都做了，外加为了给 Facebook App Review 一个真实可访问的网址，顺带把 storefront 的 Netlify 分支预览也开通了。

### Netlify 分支预览（`dev--trinity-globe.netlify.app`）

Facebook App Review 需要真实的隐私政策/数据删除说明网址，但这些页面当时只在 `dev` 分支/本地，还没合并到 `main`（production 用的还是没有购物车/登录功能的旧版静态站）。跟用户确认后（在"现在合并 dev 到 main"和"单独给 dev 开一个预览网址"之间选了后者），在 Netlify 后台（`trinity-globe` 项目 → Project configuration → Build & deploy → Branches and deploy contexts）把 Branch deploys 从"None"改成"Let me add individual branches"，只加了 `dev` 这一个分支（没有开放给所有分支，控制影响范围）。推了一个空 commit 触发首次分支部署，得到了公开预览地址 `https://dev--trinity-globe.netlify.app`。

**顺带修复了一个真实的部署问题**：分支部署第一次失败，报"Exposed secrets detected"，列出的"secret"其实是 `FREE_SHIPPING_THRESHOLD_CENTS`/`RESEND_FROM_EMAIL`/`SITE_URL`/`STANDARD_SHIPPING_FEE_CENTS`/`SUPABASE_URL`/`STAFF_NOTIFICATION_EMAILS` 这几个本来就该公开出现在构建产物里的普通配置值，不是真正的密钥（真正的密钥比如 `STRIPE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/两个 OAuth client secret 都不在这份名单里，说明没有真的泄漏）。这是 Netlify 密钥扫描器的已知误报行为（只要一个环境变量的值原样出现在构建产物里就报警，不区分是否真的是敏感信息）。修复：在 `netlify.toml` 的 `[build.environment]` 里加了 `SECRETS_SCAN_OMIT_KEYS`，只列出这几个确认无害的 key，真正的密钥故意没加进去，扫描器对它们仍然生效。

### Facebook App Review 资料

Facebook 开发者后台的"基本"设置页已经填完：隐私政策网址、服务条款网址、数据删除说明网址都指向了上面的 `dev--trinity-globe.netlify.app` 预览站对应页面；类别选了"商家和公共主页"；应用图标（1024×1024，网站自己的金色 TG 圆标放在品牌深色背景上，文件生成在 `/tmp/fb-icon/app-icon-1024.png`，本地临时文件不在仓库里）**这一步需要用户自己上传**——浏览器自动化工具本身禁止代为点击文件上传按钮（会弹出看不到、控制不了的系统级文件选择窗口），需要用户自己把这个文件拖进 Facebook 后台"应用图标"那个框。**这一步还没确认完成**，Meta 后台的"Currently ineligible for submission"提示里，图标应该是唯一还缺的一项（隐私政策/数据删除/类别这几项在浏览器实测确认已经不再出现在缺失列表里）。

**App Review 正式提交（申请 email/public_profile 权限给所有客户用）这一步还没做**——图标传完之后，还需要走 Meta 的权限审核申请流程（大概率需要写"这个权限用来做什么"的说明，可能需要录屏演示登录流程），这个流程本身比较长，这次没有继续往下走。

### 邮箱注册：Resend 自定义 SMTP + OTP 验证码模板

**发现一个 Supabase 的限制**：Supabase 自带的邮件发送服务**不允许编辑任何邮件模板**（包括把默认的"点击链接确认"换成"输入验证码"），必须先接上自己的 SMTP 发信服务才能编辑模板。项目正好已经有验证过域名的 Resend 账号（`RESEND_API_KEY` 一直在用，之前发订单确认邮件用的就是它）。跟用户确认后（选了"接上 Resend 的 SMTP"），在 Supabase 后台（`Authentication → Emails → SMTP Settings`）打开了 Custom SMTP：

- Host: `smtp.resend.com`，Port: `465`
- Username: `resend`，Password: `RESEND_API_KEY` 的值（剪贴板方式填入，没有回显）
- 发件人：`orders@trinityglobe.sg`（复用已验证域名），显示名 "Trinity Globe"

接上之后，"Confirm sign up"这个邮件模板解锁可编辑，把正文从默认的"点击链接确认"改成了显示 `{{ .Token }}`（Supabase 内置的 6 位数字验证码占位符）的样式，标题也改成了"Your Trinity Globe verification code"。**已用真实邮箱实测**：用 `qihengchang1014+cart-test@gmail.com`（Gmail 的 + 别名，实际会投递到用户自己的收件箱，用来在不需要一次性邮箱的情况下做真实测试）走了一遍注册，Resend 后台确认邮件状态是"Delivered"，标题和内容都对——整条链路（Supabase Auth → 自定义 SMTP → Resend → 真实收件箱）真的跑通了，不是假设。测试用的账号已经从 Supabase Auth 里删除，不留在正式用户列表里。

**顺带影响**：这次把 SMTP 从"Supabase 自带（有严格发信频率限制）"换成了"自己的 Resend"，之前 session 遇到过的"邀请邮件发太快触发 rate limit"这类问题，理论上以后也不会再遇到了（Resend 没有那个限制）。

### 数据库：`customer_profiles` 表

新增 `supabase/migrations/0004_customer_profiles.sql`：`customer_profiles` 表（`user_id` 关联 `auth.users`，`first_name`/`last_name`/`gender`/`date_of_birth`/`newsletter_subscribed`/`created_at`），RLS 策略是"只能读写自己那一行"（`user_id = auth.uid()`）。**`date_of_birth` 字段在数据库层面加了 18 岁以上的 check 约束**——这不只是抄 paneco 的表单字段，对卖酒的网站来说这个字段本身就该顺便当年龄校验用，前端也会在提交前拦一次，数据库这道是兜底。已经用真实 SQL Editor 跑到线上库，用 `information_schema.columns` 查询确认了全部 7 个字段都建对了。

### storefront 前端：完整的 Sign Up / Sign In / 验证码界面

`src/auth.ts` 新增：`signUpWithPassword`/`signInWithPassword`/`verifySignupOtp`/`resendSignupOtp`/`saveCustomerProfile`（最后这个在验证码通过、拿到真实登录态之后才会调用，因为 `customer_profiles` 的 RLS 要求必须是本人登录状态才能写自己那一行）。

`src/cart.ts` 的结账流程又多了两个阶段（`checkoutStage` 现在是 `"account" | "email-auth" | "email-otp" | "form"`）：
- 账号选择页新增了第三个按钮"Continue with Email"（在 Google/Facebook 按钮和"以访客继续"之间）
- **`email-auth`**：仿 paneco 的 Sign Up / Sign In 两个标签页。Sign Up 表单字段：名/姓/性别（男/女/不愿透露，单选）/出生日期（配一行"生日会收到专属福利"提示文案，呼应 paneco 原文，同时前端也在这里做 18 岁校验）/邮箱/密码/确认密码/订阅通讯勾选框；Sign In 表单：邮箱/密码。两个表单下方都有"Or continue with" + Google/Facebook 按钮，跟 paneco 页面的布局一致。
- **`email-otp`**：注册成功后跳转到这里，显示"验证码已发送到 xxx@xxx.com"，一个 6 位验证码输入框，"验证"和"重新发送验证码"两个操作。验证成功后才会真正建立登录态，并把之前填的姓名/性别/生日/订阅偏好写进 `customer_profiles`（这一步失败不会挡住用户结账，只会弹一条 toast 提示，因为账号本身已经可用了，档案信息只是锦上添花）。
- "返回"按钮现在是分阶段返回的（`email-otp` 返回 `email-auth`，`email-auth` 返回 `account`），不再像之前那样一律直接回购物车。

**已过 typecheck + build + 大量浏览器实测**（这次为了避开浏览器自动化工具本身的点击坐标不稳定问题，改用直接在页面里执行 JS 触发 `data-action` 点击/`form.requestSubmit()` 的方式测试，更可靠）：
- 空表单提交 → 每个必填字段都正确报错，密码不足 8 位/两次密码不一致也分别报对应错误
- 真实注册（见上面 Resend 那段）→ 正确进入验证码页 → 输错验证码正确报错 → 换 Sign In 标签用同一账号密码登录，因为邮箱还没验证通过，Supabase 正确拒绝并显示"邮箱或密码不正确"（不会泄露"账号存在但没验证"这种细节）
- 分阶段返回按钮、"以访客继续"路径都验证过没有被这次改动影响到，行为和之前一致

### 订单关联账号 + "我的订单"页面 + 导航栏登录状态（老板反馈2真正落地）

新增 `supabase/migrations/0005_orders_customer_link.sql`：`orders` 表加 `user_id`（关联 `auth.users`，可为空——访客下单仍然允许），RLS 新增一条"顾客只能看自己的订单"的 select 策略，跟原有的"内部员工可看全部订单"策略并存（加法式叠加，没有动原来那条）。

**服务端信任链**：`netlify/functions/_lib/supabase.ts` 新增 `getUserIdFromRequest(req)`——不相信客户端传来的任何 user id 声明，而是拿请求头里的 `Authorization: Bearer <access_token>` 去问 Supabase Auth 本身（`auth.getUser(token)`）验真，验出来的 id 才会传给 `create_pending_order` 这个 RPC 写进订单。`src/api-client.ts` 的 `createCheckoutSession()` 在有登录态时会自动带上这个 token（访客结账不受影响，就是不带这个头）。

**"我的订单"页面**：新增 `orders.html`（独立静态页，跟 `policies/*.html` 一样的结构）+ 独立的 `orders-i18n.js`（因为 `script.js` 的启动流程假设首页那些 DOM 都在，不能直接给子页面复用，这个做法沿用了 `policies/policy-i18n.js` 的先例）。新增 `netlify/functions/get-my-orders.ts`（要求 Bearer token，没有就 401，查出该用户名下的 `orders` + `order_items` 返回）+ `src/orders-page.ts` 的 `initOrdersPage()`，处理未登录/加载中/空列表/出错/正常展示几种状态。

**导航栏登录状态**：`index.html` 新增 `#navAccount` 容器，`src/cart.ts` 里新增 `initAccountNav()`（导出，任何页面只要有这个容器就会渲染），未登录显示"Sign In"，登录后显示"My Orders / Sign Out"。点"Sign In"会打开购物车抽屉里原来那套账号选择 UI（新加了 `openAccountDrawer()`，绕开了原来"购物车得有东西才能打开"的限制，因为现在是从导航栏单独触发登录，不一定带着购物车）。

**已做真实端到端测试（非 mock）**：用 Supabase Admin API 建了一个已确认的测试账号，用真实 magic link 建立登录态，在浏览器里实际加购 → 结账 → 提交表单 → 真的跳转到了一个 Stripe Checkout 页面（金额、商品行都对），然后用 SQL 直接查 `orders` 表确认这笔订单的 `user_id` 确实写成了测试账号的 UID；又直接访问 `orders.html`，确认这笔订单能通过真实的 `get-my-orders.ts` 请求正确渲染出来（订单号、状态"待付款"、商品明细、总价全部正确）。测试完毕后已清理：`release_inventory_reservation` 释放了这笔订单占用的库存预留、订单状态改成 `cancelled`、测试账号已从 Supabase Auth 删除，不留痕迹。

### 修复：邮箱验证码实际是 8 位，不是 6 位（真 bug，已修复）

之前一直假设验证码是 6 位（UI 输入框 `maxlength="6"`），但从没拿真实收件箱验证过。这次用两个不同的 Gmail 别名（`+cart-test`、`+otp-len-test`）各走了一遍真实注册流程，直接在收件箱里看到 Resend 实际送达的验证码——`87078715`、`18904064`、`07768092`，**三次都是 8 位数字**，不是 6 位。也就是说上线前如果不修，**每一个真实用户都会在验证码这一步卡死**（输入框打不满，提交的永远是被截断的前 6 位，`verifyOtp` 一直报错）——这是这次排查前风险最高的一个尚未验证的假设，现在已经证实并修复。

修复内容：`src/cart.ts` 验证码输入框 `maxlength` 从 `6` 改成 `8`；`script.js` 里中英文两条 `checkout-otp-lead` 文案的"6 位"改成"8 位"。**修复后又用真实邮箱把整个流程重新跑了一遍**：注册 → 收到 8 位验证码 → 输入框能完整输入 8 位 → 提交 → 验证成功 → 正确进入已登录状态的结账表单。测试账号已从 Supabase Auth 删除。

**这次改动（Netlify 分支预览、`netlify.toml` 密钥扫描修复、Facebook 资料、Resend SMTP + OTP 模板、`customer_profiles` 迁移、完整注册/登录/验证码 UI、订单关联账号 + 我的订单页面 + 导航栏登录状态）已经 commit**（`575f070` 订单关联账号那批 + 验证码位数修复）。`supabase/migrations/0004_customer_profiles.sql`、`0005_orders_customer_link.sql`、Resend SMTP 配置、Supabase 邮件模板、Facebook 后台设置这几项是**线上配置改动，不在 git 里**，但已经在真实项目里生效了，不需要额外部署步骤。

**接下来（没做的部分）**：
- **Facebook 应用图标还没传**——需要用户自己把 `/tmp/fb-icon/app-icon-1024.png` 拖进 Facebook 后台的应用图标框（这台机器上的临时文件，可能已经不在了，需要的话可以重新生成）。
- **Facebook App Review 正式提交还没做**——图标传完之后才能提交，且提交本身可能还需要写权限用途说明、录屏等材料。
- **Facebook Business Portfolio（公司验证）状态未知**——用户点开的验证页面要求先有一个 Meta Business Portfolio，用户不确定公司是否已经注册过，需要自己去 business.facebook.com 查一下，我不该替用户猜/填这种企业身份信息。
- Netlify 后台（`trinity-globe` 生产站点）的环境变量列表里**还没加** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`——本地能跑，但如果现在把 `dev` 合并上线，正式站点上 Google/Facebook/邮箱登录会因为读不到这两个变量而静默不可用（访客结账不受影响，只是登录选项会消失）。
- 老板反馈1（"上产品的后台和订单的后台能结合"）—— 用户选的是"两边互相加个跳转入口"这个轻量方案，还没做。

## 2026-08-26（第二轮）：上线前检查清单前三项 + 几个小修复

**库存、前端 env 变量、Stripe Charges/Payouts 核实——见上面"上线前检查清单"对应条目，已标记完成。**

**导航栏字体大小不一致（真 bug，已修复）**：用户发现右上角 "SIGN IN" 比左边 "ENGLISH" 字体明显小。查到 `style.css` 里 `.nav-account-signin/.nav-account-link/.nav-account-signout` 用的是 `0.68rem`，跟 `.nav-lang`/`.nav-links a` 的 `0.8rem` 不一致（历史遗留，不是故意设计）。已统一改成 `0.8rem` + 相同字间距，起本地静态服务器截图确认 SIGN IN 和 ENGLISH 现在一样大。

**Sign Up 页去掉"生日福利"文案**：用户要求把出生日期字段下面的 "We'll send you perks for your birthday!"（中文版"生日当天会为您发送专属福利！"）去掉。已删除 `src/cart.ts` 里的对应 `<p>` 及 `script.js` 两语言的 `checkout-dob-hint` 词条，顺带删掉了因此变成未使用的 `.checkout-field-hint` CSS 规则。

**Sign Up 页的 Google/Facebook 按钮居中**：之前 "Create Account" 表单下面 "Or continue with" 后的 "Sign in with Google"/"Sign in with Facebook" 两个按钮是 `inline-flex` 默认宽度，靠左显示，跟上面全宽的 "Create Account" 按钮不一致。已给 `.checkout-auth-tabs ~ .checkout-google-btn/.checkout-facebook-btn` 加上 `width: 100%; justify-content: center`，跟账号选择页（`accountChoiceHtml`）的按钮风格保持一致。已过 typecheck，浏览器实测截图确认两个按钮现在跟 Create Account 一样全宽居中。

**age-restriction.html 去掉一段内部草稿备注**：用户引用了页面里"这是初稿……请根据《2015年酒类管制（供应和消费）法案》核实"这段免责声明文字，要求去掉。已删除该 `.policy-draft-notice` 区块。**注意：Terms 和 Privacy 页面各自的"内部草稿"提示块没有动**——用户当时没有明确点名要求删这两页的，考虑到这两页接下来要发给老板找律师，保留这个提示反而能提示律师具体要核对哪些点，所以先留着；如果用户后续确认也要去掉，再单独处理。

**真 bug 修复：OAuth 登录中途取消/失败会丢失已经填写的注册信息**。排查 `src/cart.ts` 的 `maybeReopenCheckoutAfterAuth()` 发现：点击 "Sign in with Google/Facebook" 时只在 localStorage 存了个 `"1"` 标记，OAuth 是整页跳转，会清空内存里的所有状态（`checkoutStage`、已经填的 `signupForm` 字段）；跳回来之后，如果登录成功（拿到 session）会跳到收货表单——这个没问题；但**如果用户在 Google 那边取消了、或者登录失败**，代码会无条件退回最外层的 "account"（Guest/Google/Facebook/Continue with Email）选择页，此前在 Sign Up 表单里填的名字/性别/生日/邮箱等全部丢失，要重填一遍。

已修复：把 localStorage 存的内容从纯 `"1"` 标记改成一个 JSON 快照（`ReopenCheckoutSnapshot`：当前 stage、`emailAuthTab`、signup 表单字段、sign-in 邮箱），点 Google/Facebook 按钮时保存快照；跳回来后如果没有 session（说明登录被取消或失败），就把 stage 和表单字段从快照里恢复回去，而不是无条件退回 account 选择页。**密码字段特意没有存进快照**——这段状态要在 localStorage 里过一次 OAuth 跳转，跟浏览器自己前进/后退时不恢复密码框是同样的道理，用户只需要重新输一次密码，不用重填整个表单。已过 typecheck + 全部 50 个单测。

这次改动（导航字体、生日文案、OAuth 按钮居中、age-restriction 草稿备注、OAuth 取消后状态保留）**还没 commit**，跟之前的规矩一样，等用户说"commit一下"再做。

## 2026-08-26（第三轮）：Sign Up 性别选项等宽、配送时效文案、导航栏账户改成图标下拉菜单

**Sign Up 表单 Gender 三个选项间距不均**：用户发现 "Prefer Not To Say" 比 "Male"/"Female" 占的空间明显更大。原因是 `.checkout-gender-options .checkout-radio` 写的是 `flex: 1 1 auto`——`auto` 基准会先按文字内容分配宽度，三个选项文字长度不同，分到的空间自然不同。改成 `flex: 1 1 0`（基准强制为0，可用空间严格三等分，不看内容长度）后三个选项等宽。

**Standard Delivery 补充大致配送时效**：参考 paneco 会显示具体到货日期（"Expected delivery: Thursday, Aug 27"），用户说暂时不想做到那么精确，先写"1–2 business days"这种粗略区间。已加进结账页 `checkout-standard-delivery-info` 文案（中英文），同时把 `delivery.html` 里对应的占位符（`[e.g. "2–3 business days" — confirm actual fulfilment capacity]`）也换成确定的"1–2 business days"，顶部的草稿提示相应更新（配送时效从"待确认"移到"已确认"那一类）。

（旁注：用户截图指出 paneco 自己的配送方式选择页有个真实的逻辑漏洞——"Express Delivery"多收 S$8，但显示的到货日期跟免费的"Free Delivery"是同一天，等于白花钱。这个我们目前用不上，因为我们只有"标准配送/自提"两档，没有 paneco 那种多档付费提速选项，如果以后要加类似的"加急配送"功能，要注意别犯同样的错——加急档必须真的比免费档更快，不然这个 UI 设计本身就是坑用户。）

**导航栏"MY ORDERS / SIGN OUT"改成图标+下拉菜单**：用户反馈登录后导航栏里 "MY ORDERS" 和 "SIGN OUT" 跟前面 HOME/ABOUT/COLLECTION/CONTACT/ENGLISH 的间距对不上。实测发现：`.nav-account` 之前特意给 "My Orders"/"Sign Out" 这一对设了更紧的 `gap: 0.9rem`（历史设计意图是让这两个读起来像"一组"，跟其他 2rem 间距的导航项区分开），但视觉上这种"紧邻的一对"跟其余等距排列的导航项放在一起反而显得节奏不对。

已经参考用户给的 paneco 截图，把登录后的状态从两个文字链接改成**一个人形图标 + 点击展开的下拉菜单**（未登录状态的 "Sign In" 文字链接没有变）：
- `src/cart.ts` 的 `initAccountNav()`：登录态渲染一个 `.nav-account-trigger` 图标按钮 + 一个默认隐藏的 `.nav-account-dropdown` 面板（含 My Orders、Sign Out 两项），点图标切换展开/收起，点面板外或按 Esc 会收起
- `style.css` 新增对应样式，图标风格跟购物车图标（同样是 `currentColor` 描边）保持一致，下拉面板用深色背景 + 金色 hover，跟站点整体视觉统一
- 图标本身跟其他导航项之间现在是统一的 2rem 间距（不再有那个特别紧的 0.9rem 分组间距），下拉菜单内部 My Orders/Sign Out 两项之间才有各自的分隔线
- 已过 typecheck + 全部 50 个单测 + 浏览器实测（图标显示、点击展开下拉、菜单项正确显示）

**待用户决定的范围问题**：用户还提到想加 "My Address" 和 "Payment Methods" 到这个下拉菜单里（参考 paneco）。**这两个目前网站完全没有对应功能**——不是加两行菜单文字那么简单：
- My Address 需要新建一张"客户地址簿"表（Supabase migration + RLS）+ 一个管理多个收货地址的页面/表单 + 结账时能选择已存地址
- Payment Methods 需要接入 Stripe 的 Customer + 已存卡片管理（SetupIntent/PaymentMethod API），涉及要不要把 Supabase 用户和 Stripe Customer 关联起来这个新的架构决策

这两项还没有开始做，需要先跟用户对一下要不要现在就投入（等同于开两个新功能），还是这次先只做 My Orders + Sign Out 这个下拉菜单外壳，Address/Payment Methods 放到以后再排期。

这次改动（gender等宽、配送时效文案、导航账户下拉菜单）**还没 commit**。

## 2026-08-26（第五轮）：Stripe 结账页 Payment Element 落地（保留 Checkout Session + webhook）

**背景**：用户想让结账页的支付界面能自定义黑金视觉（现在是 Stripe 托管页，只能改背景色/按钮色/字体这几个参数，卡号输入区域样式完全不可控）。讨论过两种方案：
1. 换成 `PaymentIntent` + 自己搭一套支付状态机——**否决**，因为会丢掉现成的 Session 过期机制（cron 只释放库存不取消 PaymentIntent，会导致库存放了但客户还能拿旧 clientSecret 继续付款）、`payment_intent.payment_failed` 不代表订单真的失败（换卡重试场景），且 webhook 全部要重写。
2. **采用（已实施）**：`ui_mode: "elements"` 让 Checkout Session 直接支持 Payment Element 前端组件，Session 的过期时间、`checkout.session.*` 系列 webhook 事件、库存预留时机全部原样保留，只有前端从"整页跳转去 Stripe"改成"页面内挂载 Payment Element"。这是 Stripe 官方现在推荐的默认组合（查证过 `docs.stripe.com/payments/payment-element` 原文："Stripe recommends using the Checkout Sessions API with the Payment Element over Payment Intents for most integrations"）。

**功能开关**：新的环境变量 `CHECKOUT_UI_MODE`（`hosted` 或 `elements`，不设/设错都按 `hosted` 处理，即现在这套已经验证过无数次的默认行为不变）。`create-checkout-session.ts` 根据这个开关决定创建 Stripe Session 时用哪种模式，返回给前端的形状也不同：
```
{ mode: "hosted", checkoutUrl, orderId }   // 旧流程，前端整页跳转
{ mode: "elements", clientSecret, orderId } // 新流程，前端挂载 Payment Element
```
两种模式共用同一套 `create_pending_order` 下单+库存预留逻辑，`stripe-webhook.ts` **完全没有改动**（还是监听 `checkout.session.completed`/`checkout.session.expired`等，Session 底层机制不变，只是 UI 呈现方式不同）。`admin-refund-order.ts` 也不用改（本来就只认 `stripe_payment_intent_id`）。

**改动的文件**：
- `netlify/functions/create-checkout-session.ts`：加了 `uiMode` 分支逻辑
- 新增 `netlify/functions/get-checkout-session-status.ts`：只读接口，给 Payment Element 支付完成跳回来的 return 页查询"这笔到底成没成功"用于展示，**明确不碰 `orders`/`inventory_reservations` 表**——订单真正的成功状态、库存扣减、邮件发送权威来源永远是 webhook，这个接口哪怕没被调用到（比如用户直接关掉标签页）也不会影响订单真实状态
- `src/types.ts`：`CreateCheckoutSessionResponse` 改成按 `mode` 区分的联合类型，新增 `CheckoutSessionStatus`
- `src/api-client.ts`：新增 `getCheckoutSessionStatus()`
- 新增 `src/lib/stripe-elements.ts`：`@stripe/stripe-js` 的 `loadStripe()` 封装，跟 `lib/supabase.ts` 一样的"缺配置就静默禁用、不报错炸整个购物车"套路
- `src/cart.ts`：新增 `checkoutStage: "payment"`，挂载 Payment Element（accordion 布局 + `radios: "always"`，跟用户要求一致），"PAY NOW"按钮走 `checkoutSdk.loadActions()` → `actions.confirm({redirect:"if_required"})`，成功/失败/需要跳转（3DS、PayNow）三种结果分别处理；`handleCheckoutRedirect()` 扩展出 `?checkout=return` 分支处理 Payment Element 跳回来的情况；**关键的一处坑**：`renderDrawer()` 会整个替换 `drawerEl.innerHTML`，如果在 Payment Element 挂载后还跑一次，会把已经挂进 DOM 的 Stripe iframe 连根拔掉——所以专门给 `onLangChange`/`onAuthChange`/`openDrawer()` 三处加了"当前在 payment 阶段就跳过重渲染"的保护，语言切换/关闭再打开抽屉都不会打断已经在填的支付表单
- 品牌视觉：`paymentElementAppearance()` 把网站的 CSS 变量（金色 `#c9a84c`、深色背景等）映射成 Stripe Appearance API 的 `variables`，浏览器实测确认卡号输入框、PayNow 二维码区、"PAY NOW"按钮都是黑金配色，不再是默认的 Stripe 紫/蓝
- 新增 `.env`/`.env.example` 的 `VITE_STRIPE_PUBLISHABLE_KEY`（公钥，可以放心暴露给浏览器）和 `CHECKOUT_UI_MODE`
- `package.json`：`stripe` 从 17.7.0 升到 22.5.0（**必须升级**——17.7.0 的 TypeScript 类型定义里 `ui_mode` 只有 `'embedded'|'hosted'`两个值，没有 `'elements'`，编译会直接报错），新增前端依赖 `@stripe/stripe-js`

**真实测试情况（用沙盒账号 Stripe test mode + 本地 `netlify dev`，不是纸上谈兵）**：
- 本机之前有个跑了6天忘记关的 `netlify dev` 残留进程占着端口，跟用户确认后重启了它（不是正在被谁盯着看的窗口）
- `create-checkout-session.ts` 在 `CHECKOUT_UI_MODE=elements` 下真实调用 Stripe 创建了 Session 并拿到 `clientSecret`；`get-checkout-session-status.ts` 真实查询确认了状态
- 浏览器里真实走通：加购 → 结账表单 → 挂载出 Payment Element（accordion，PayNow 和银行卡纵向排列，点开银行卡展开卡号/有效期/CVC，黑金配色）→ 输入 Stripe 测试卡 `4242 4242 4242 4242` → 点 PAY NOW → **真实向 Stripe test mode 确认成功**（用 `get-checkout-session-status` 查询到 `status:"complete", paymentStatus:"paid"`）→ 页面内直接显示成功、购物车清空、抽屉关闭，全程没有跳转离开网站
- 手动模拟了 `?checkout=return` 跳转（已付款的 session 和未付款的 session 各测一次），确认 return 页能正确区分"成功→清购物车"和"未成功→保留购物车"
- 验证了关闭购物车抽屉再重新打开、语言切换，正在挂载的 Payment Element 不会被打断（这是专门写的保护逻辑，实测有效）
- **唯一没有在本地测到的一环**：这台机器没装 Stripe CLI（`brew install stripe/stripe-cli/stripe` 因为 Xcode Command Line Tools 版本太旧装不上，需要系统更新，没有替用户动系统级设置），所以 Stripe 没法把 webhook 发到 localhost，本地测试里 Supabase 的 `orders.status` 没有真的从 `pending_payment` 变成 `paid`（Stripe 那边已经真实显示 paid，只是我们自己数据库不知道）。**这个不算新风险**——`stripe-webhook.ts` 这份代码本身完全没有改动，是之前 session 已经用真实部署环境（`dev--trinity-globe.netlify.app`）验证过的同一套逻辑，只是这次没条件在本地重新走一遍。真要在本地测完整链路，需要用户自己在这台机器上更新 Xcode Command Line Tools 后装 Stripe CLI，跑 `stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook`。
- 测试过程中创建的几个测试订单，已经用临时脚本把库存预留释放、订单状态改成 `cancelled`，脚本本身用完即删

**上线前还要做的**：
- **卡片报错（比如被拒绝）的内联提示没有用真实卡在浏览器里测到**——代码逻辑跟已经验证过的成功路径是同一段 `confirm()` 调用，只是走 `result.type === "error"` 分支，逻辑简单且过了 typecheck，但没有拿 Stripe 测试用的拒绝卡（`4000000000000002`）实际点一遍
- **本地 `.env` 现在是 `CHECKOUT_UI_MODE=elements`**（为了方便继续本地测试），**Netlify 生产环境变量完全没有改动**，线上现在仍然是默认的 hosted 模式，不会有任何影响
- 用户之前定的三个要求都已经落实：不删旧的 hosted Checkout 代码（`uiMode !== "elements"` 分支原样保留）；return 页查状态只做展示不影响订单真实状态；Stripe SDK 版本已经检查并升级到支持 `ui_mode: "elements"` 的版本
- 真正要上线用这个新流程之前，建议：（1）用户自己装好 Stripe CLI 补一次本地 webhook 全链路测试，或者直接在 `dev` 分支预览站上测（跟之前测 Google/Facebook 登录一样的路子）；（2）拿真实的拒绝卡测一下报错提示；（3）测一下 PayNow 这条支付方式（本地没测，因为 PayNow 本身需要跳转到银行/生成二维码，测试模式下的行为需要额外确认）

这次改动（Payment Element 全套：新迁移文件之外的所有代码改动）**已经 commit**（`ca8f69d`，`dev` 分支，用户确认过"commit this"）。

## 2026-08-26（第六轮）：导航栏改文字入口 + 5个政策页面全面重写（双语+去技术细节+暂停自提）+ 自提功能开关

**导航栏 ACCOUNT/SIGN IN 改成纯文字**：用户建议把上一轮做的人形图标改成纯文字入口，更符合导航栏的极简黑金调性——未登录显示"SIGN IN"，登录后显示"ACCOUNT"（点开下拉菜单：MY ORDERS / MY ADDRESSES / SIGN OUT）。已实现：`src/cart.ts` 去掉了图标 SVG，`style.css` 按用户给的参数配色（`#C8BEB0` 默认、`#C6A34F`/`var(--gold)` hover、字号14px、字间距0.14em、无边框无图标），浏览器实测通过 computed style 确认颜色/字号/字间距完全匹配。"My Address"下拉项文案改成复数"My Addresses"（含 addresses.html 页面标题）。

**新增全局开关：暂停自提（Self Collection）**——用户指出两个真实风险：1）之前展示的自提地址其实是老板自己家，公开完整门牌号会有陌生人上门骚扰的风险；2）新加坡警方对酒类线上销售的说明是"存放场所不代表可以在那里销售/交付酒类"，自提地点是否属于酒牌批准的场所还没确认，贸然继续用这个地址交付有牌照合规风险。已处理：
- 新增 `src/feature-flags.ts`，`SELF_COLLECTION_ENABLED = false`，前端（`src/cart.ts` 结账表单不再渲染自提选项，配送方式固定为标准配送）和后端（`create-checkout-session.ts` 即使收到 `deliveryMethod: "self_collection"` 的请求也会拒绝）共用同一个开关，两边不会不同步
- 清理了 `netlify/functions/_lib/email.ts` 里硬编码的真实地址、"24 hours"、老板姓名——即使现在这条代码路径已经走不到（后端会直接拒绝），这些敏感信息也不应该继续留在代码里
- 浏览器实测确认结账表单里配送方式选择整个消失，只剩标准配送
- 以后确认好新的自提点、且酒牌条件允许后，把 `SELF_COLLECTION_ENABLED` 改回 `true`，把真实地址填进 `policies/delivery.html` 就行，不需要改别的代码

**5个政策页面全面重写**：用户指出现在的政策页面读起来像"内部技术草稿"，主要问题不是英文写得不好，而是掺了内部备注、未确认事项和过多技术栈名称。逐条处理：
- **改成真正的双语，不是"外壳翻译+英文正文"**：重写了 `policies/policy-i18n.js` 的机制——每个页面正文现在是两个完整的 `data-policy-body="en"`/`data-policy-body="zh"` 内容块，语言切换按钮控制显示哪一个（`hidden` 属性），不是过去那种"只翻标题、正文一直是英文+一行'中文稍后补充'提示"的半成品状态。中文版结尾统一加了"如中文版本与英文版本存在不一致，以英文版本为准"的免责声明。
- **删除了所有"Internal draft"提示、`[confirm: ...]`占位符方括号**：`.policy-draft-notice`/`.policy-placeholder`/`.policy-lang-notice` 这三个 CSS 类连同用途都已经不在了（前两轮已经先去掉了大黄条通知，这轮把剩下的"Internal draft"小字行和所有方括号占位符也清理干净）。`.policy-updated` 这个类复用成了"Last updated: 26 August 2026"。
- **每页加了 Last updated 日期**，去掉了原来 h1 下面的草稿提示行。
- **Terms**：正文只写公司名 "Trinity Globe Trading Pte. Ltd."，**UEN 不放正文**，改放到全站页脚（`index.html`/`orders.html`/`addresses.html`/5个政策页 + 订单确认邮件都加了"· UEN 202509360N"）——用户查过 ACRA 的要求后自己给出的结论：UEN 是公开信息、放页脚更稳妥，正文放着显得生硬。价格条款改成"prices... inclusive of GST where applicable"这个说法（对应公司GST注册后网站价格必须显示含税最终价）。
- **Privacy**：不再点名 Supabase/Resend 这些具体技术栈，第4/5条改写成按服务类别描述（"cloud hosting and account authentication service providers"、"payment processors including Stripe"等），新增跨境数据传输条款，Cookie 条款改成更准确的表述（购物车/登录/防欺诈/支付必需，目前没有分析类cookie），Stripe隐私政策链接英文版链官方英文页、中文版链 `stripe.com/zh-sg/privacy`。
- **联系邮箱**：`orders@trinityglobe.sg` 从所有政策页面里删掉了（这个地址只是 Resend 发件用的，没人在盯着看收件箱，写成"联系方式"会误导客户），统一改成只留 WhatsApp。**这个只是暂时方案**，PDPA 要求企业提供一个公众可以方便联系的负责人渠道，长期看最好还是建一个真的有人查看的 `privacy@`/`support@` 邮箱——这个是运营层面的待办，没有写进面向客户的政策文本里（写一个还是没人看的邮箱地址等于没解决问题）。
- **Delivery**：自提整节改成"即将开放，新自提点启用后会公布详情"，删掉了地址、"24 hours"、老板姓名（配合上面的自提功能开关一起处理）。配送区域、派送失败流程这两条之前是方括号占位符，业务上还没真正拍板，这轮按"不能带占位符上线"的要求，改写成不承诺具体细节的正常语句（比如不确定配送区域就引导WhatsApp确认），没有编造一个没被确认过的具体规则。
- **Refund**：48小时窗口改成"尽快联系，建议在48小时内"这种更宽松的措辞，避免绝对化损害客户法定权利，加了"本政策不影响您依据新加坡消费者保护法律享有的权利"。Stripe 5-10个工作日退款到账保留（这是 Stripe 官方给的正常区间，不是占位符）。
- **Age restriction**：年龄条款简化成"You must be at least 18 years old to purchase or receive alcohol from us."，验证失败的处理方式改成指向配送政策（不再单独占一个方括号）。NAMS（国家成瘾管理服务）保留了一个官方链接 `nams.sg`（查证过是真实域名，会跳转到 IMH/NHG 官方页面），不放电话号码（怕以后过期没人更新）。

浏览器实测确认：语言切换能正确显示对应整段正文（不是只翻标题）、footer UEN 正确显示、NAMS 链接文本正确、Terms 正文里确实没有 UEN。

**仍然建议在正式上线前，找一个熟悉新加坡电商/PDPA/酒牌要求的人做最终审核**——这轮内容已经比之前完整很多，但终究不是律师做的正式审核。

这次改动（导航文字改版、自提功能开关、5个政策页面全面重写、邮件模板清理、全站页脚UEN）**已经 commit**（`e44457b`，用户确认过"commit this"）。

## 2026-08-26（第七轮）：支付安全审计——2个真bug + 幂等性 + 限流；Resend配额确认；admin-app确认无影响

用户发来一份很详细的支付攻防清单（重复下单、锁库存、webhook乱序、盗刷卡等），要求先核对5件事：Session过期时间是否跟库存预留同步、下单+Session创建有没有幂等、webhook有没有事件去重和状态单向流转、下单接口有没有限流、金额是否全部由后端重新计算。逐条查了代码，不是纸上谈兵：

**审计结果**：
- ✅ **Session过期时间**：`create-checkout-session.ts` 里 hosted 和 elements 两种模式的 `expires_at` 本来就用的是同一个 `RESERVATION_TTL_MINUTES`（30分钟），跟库存预留时间本来就同步，不用改。
- ✅ **金额由后端计算**：`create-checkout-session.ts` 本来就是从数据库读真实价格算的，从不信任前端传来的金额，这块本来就是对的。
- ✅ **最后一瓶两人同时买**：查了 `supabase/migrations/0001_init.sql` 的 `reserve_inventory()`，本来就用 `for update` 行锁保证原子性，跟之前记录的"已用Docker Postgres验证过"一致，没问题。
- ❌ **发现真bug1（严重）：webhook乱序会把已付款订单错误改回失败，还会把已经卖出的库存放回去**——`handlePaymentFailed()` 之前完全没检查订单当前状态，如果 Stripe 的 `checkout.session.expired` 事件比 `checkout.session.completed` 晚到（比如客户卡在过期边界那一刻刚好付款成功），就会把一个已经 `paid` 的订单改回 `payment_failed`，并且调用 `release_inventory_reservation`——这个 RPC 连*已确认*的预留也会释放并把库存加回去（代码注释里写得很清楚，是特意为"已付款订单后来被取消退款"这个场景设计的），也就是说这个bug会导致**已经卖给客户、已经收了钱的酒被系统当成没卖出去，可能被别人再买一次**。已经修复：`handlePaymentFailed()` 现在会先查订单当前状态，如果已经是 `paid` 就直接跳过，不释放库存、不改状态；`update` 语句本身也加了 `.neq("status", "paid")` 双重保险。
- ❌ **发现真bug2（无关这次审计，顺手查出来的）**：`src/cart-store.ts` 的 `MAX_QTY_PER_ITEM` 之前从120改成了999（为了支持大宗客户直接在购物车输入几百瓶），但后端 `_lib/schemas.ts` 的 Zod 校验一直没跟着改，还卡在 `max(24)`——**意味着这段时间只要有人真的下单超过24瓶同一款酒，后端会直接拒绝这个请求**，跟前端"改成999"这个功能完全对不上。已经把校验上限也改成引用同一个 `MAX_QTY_PER_ITEM` 常量，不会再出现两边不一致。补了一条对应的单测（250瓶应该成功，1000瓶应该被拒绝）。
- ⚠️ **没有幂等性**：代码注释里原来就承认"NOTE: there's no request-level idempotency key here"，这个是真的没做。
- ⚠️ **没有限流**：原来完全没有任何频率限制。

**幂等性 + 限流已经实现并用真实 Supabase 测试过**：
- 新迁移 `0007_checkout_idempotency.sql`（已跑到线上）：`orders` 表加了 `checkout_attempt_id`（唯一索引，允许为空）和 `ip_address` 两列，`create_pending_order` RPC 加了两个对应的可选参数。
- `src/cart.ts`：每次从购物车进入结账表单（`goToCheckout()`）生成一个 `checkoutAttemptId`（UUID），双击、网络重试、"返回再提交"这些场景都会带着同一个 ID 重新提交
- `create-checkout-session.ts`：收到请求后先查有没有已存在的订单用这个 attempt ID——如果有且还是 `pending_payment` 状态，直接把已有的 Stripe Session 重新取一次返回给前端，**不会创建第二个订单、不会重复锁库存**；创建 Stripe Session 时也带上了 Stripe 自己的 `idempotencyKey`，双重保险
- 限流：同一邮箱30分钟内最多3个未付款订单、同一IP（用 Netlify 的 `context.ip`，不是容易伪造的请求头）10分钟内最多5次下单请求，超过返回429，都是先查询已有数据做判断，没有引入新的外部服务
- **真实测试**：起了本地 `netlify dev`，真实调用 Supabase——同一个 attempt ID 提交两次，确认数据库里真的只有一个订单一个预留；连续用同一邮箱下4个订单，第4个被正确拒绝；同一IP（本地是127.0.0.1）下第6次请求被正确拒绝。测试产生的订单都已清理（释放预留、标记cancelled）。

**顺手加的一个防线**：webhook 收到"支付成功"事件时，现在会核对 Stripe 那边的 `amount_total`/`currency` 跟数据库里这笔订单的金额是否一致，不一致就拒绝标记为已付款并打日志，不再默认信任 Stripe 传来的金额。

**这次没做、建议先观察不用现在建的**：
- 用户提到的 CAPTCHA（Cloudflare Turnstile）——这个需要新开一个账号/site key，涉及跟用户对接注册，不是纯代码能搞定的，建议等真的观察到滥用迹象再上，不然平白无故给正常客户增加一道验证摩擦
- 卡片测试/盗刷的专门风控——Stripe Checkout/Payment Element 默认就带 Radar 风控模型和自动限流，我们也一直有把 `customer_email` 传给 Stripe（Payment Element 场景下 Stripe.js 本身也会采集浏览器指纹用于风控），没有再另外自建一套检测逻辑。建议上线后留意 Stripe 后台的 Radar 报表，真出现异常再针对性加强，而不是提前造一堆可能用不上的规则。

## Resend 邮件配额确认

登录 Resend 后台查了实际状态：**当前是免费版**，账单页面显示 "Transactional 3,000 emails $0/mo"，没有绑定支付方式。查了 Resend 官方文档确认免费版限制是 **每天100封、每月3000封**，超过每天100封之后什么行为文档没写清楚（大概率是直接发不出去，不是排队）。

因为一笔订单会触发2封邮件（客户确认+员工通知），**每天100封的免费额度撑死也就50笔订单/天**——如果真的做到"一天几百个用户下单"，会很快撞到这个墙。往上一档是 Pro 版 $20/月，5万封/月，**没有每日上限**，对"几百单/天"这个量级来说完全够用。

由于 `sendOrderConfirmationEmail`/`sendStaffNotificationEmail` 本来就是失败只打日志、不会让订单流程失败（`Promise.allSettled` + 各自 try/catch），所以即使撞到 Resend 限额，**订单本身不会出问题，客户依然能正常付款、订单依然会被正确标记为已付款**——唯一的影响是那封邮件可能发不出去，而且目前没有任何监控/告警会告诉你"这封邮件其实没发出去"。

**建议**：
1. 真要冲量之前（比如老板开始大规模推广/大促），先把 Resend 升级到 Pro，成本很低（$20/月），能一次性解决每日上限问题
2. 不要让客户/员工完全依赖邮件——现在客户有"My Orders"页面、老板/员工有 admin-app 后台，两边都是直接查 Supabase 数据库、不经过邮件，**订单状态本身不会因为邮件发不出去而丢失或不准确**，只是"收到通知"这个体验会打折扣。这个属于运营提醒，不是这次改代码能解决的事。

## admin-app 是否受影响

**确认没有受影响**。今天这几轮改动（Payment Element、自提暂停、政策页面重写、幂等性/限流）都没有碰 `admin-app/` 目录本身，也没有改 `orders`/`order_items` 表的既有字段结构（新增的 `checkout_attempt_id`/`ip_address` 是全新列，admin-app 不读取这两列，不受影响）。唯一沾边的地方是 `admin-app/src/pages/OrderDetail.tsx` 和 `admin-app/src/lib/types.ts` 里有 `self_collection` 这个枚举值的展示逻辑——这个只是显示用的分支判断，不会报错，只是以后新订单基本不会再出现这个值（历史上如果有自提订单，展示依然正常）。`admin-refund-order.ts`（老板/你在后台点退款走的这个函数）也完全没有改动。你和老板现在通过 admin-app 收订单、看后台，跟今天的改动没有任何冲突。

这次改动（webhook乱序bug修复、qty上限不一致bug修复、幂等性、限流、金额核对）**还没 commit**。

## 2026-08-26（第四轮）：My Address 功能上线 + Terms/Privacy 内容补完 + 政策页脚统一

**决定：Payment Methods 先不做，My Address 现在就做**。用户确认账户下的"已保存地址"是需要的功能，"已保存支付方式"暂时不做。

**新建 `customer_addresses` 表并已跑到线上 Supabase**：`supabase/migrations/0006_customer_addresses.sql`——`id`（主键，一个用户可以有多条地址，不像 `customer_profiles` 一对一）、`user_id`、`label`（可选，如"家"/"公司"）、`recipient_name`、`phone`、`address`、`postal_code`、`is_default`。RLS 单条"customers manage own addresses"策略（`user_id = auth.uid()`覆盖增删改查）。跟之前一样走 SQL Editor + 剪贴板粘贴执行，跑完用临时 `.mjs` 脚本确认字段可查询，脚本已删除。

**新增 `addresses.html` 页面（"My Address"）**，结构照抄 `orders.html`/`orders-page.ts` 的先例：
- `src/addresses-page.ts` 直接用 `supabase-js` 读写 `customer_addresses`（跟 `auth.ts#saveCustomerProfile` 一个套路，不走 Netlify Function，安全性由 RLS 兜底），支持：列表展示（默认地址置顶+徽章）、新增地址表单、删除、设为默认（设默认时会先把其他行的 `is_default` 清掉，保证同一时间只有一条默认地址）
- 新增 `addresses-i18n.js`（跟 `orders-i18n.js` 同款独立中英文桥接，不共用 `script.js`）
- `main.ts` 的 `boot()` 里加了 `initAddressesPage()`
- 导航栏账户下拉菜单（上一轮刚做的图标+下拉）里，"My Orders"和"Sign Out"中间加了"My Address"一项，链接到 `/addresses.html`
- **顺带修复一个遗漏**：上一轮把 `nav-account-menu`（下拉图标的 aria-label 文案）这个 key 只加进了 `script.js`，没同步加进 `orders-i18n.js`——导致 `orders.html` 上这个 aria-label 会显示成裸的 key 名而不是真正的文案。这次一起把 `nav-account-menu` 和新加的 `nav-my-address` 补全到 `script.js`/`orders-i18n.js`/`addresses-i18n.js` 三处。
- 已过 typecheck + 全部 50 单测 + 浏览器实测（未登录态正确显示"Sign In"提示、页面标题/面包屑中英文正确、页脚 5 个政策链接可点击）。**登录态下的增删改地址流程没有用真实账号走一遍**（需要真实登录态，这次没有另外建测试账号），逻辑本身经过 typecheck，模式跟已经端到端验证过的 `customer_profiles` 写入完全一致。

**Terms & Conditions / Privacy Policy 内容补完**：用户提出"内容可以先参考 paneco 的来，因为大致的酒类隐私内容是一致的"。**核对 paneco 实际线上页面后发现一个问题**：paneco 的隐私政策其实是没怎么改过的通用电商模板，里面还留着"加拿大""US Patriot Act"这类跟新加坡公司完全不沾边的措辞，条款页也完全没有酒类牌照相关条文——照抄不可取。所以采取的做法是：**保留我们自己已经写好的框架和结构，把里面明确标记"待确认"的占位符，用这个项目里已经确认过的真实事实去填上**，而不是照搬 paneco 的文字：
- Terms 第1条：UEN 填成 `202509360N`（Airwallex 那边早就核实过的真实UEN），去掉占位符标记
- Terms/Privacy 的联系邮箱 `orders@trinityglobe.sg`：这个邮箱通过 Resend 发送真实订单邮件已经验证过是活的，去掉"待确认是否活跃"的标记
- Privacy 第2条"是否有营销邮件计划"：代码里 signup 表单本来就有"订阅 Trinity Globe 通讯"这个勾选框、`customer_profiles.newsletter_subscribed` 字段也真实存在——直接按现状写清楚，不用再问
- Privacy 第6条留存期限：按 IRAS 对报税记录"至少保留5年"的通用要求确认下来
- Privacy 第8条 cookie 声明：查了代码库确认目前没有接入任何 Google Analytics/Facebook Pixel 之类的第三方追踪，如实写"目前不使用分析或营销类cookie"
- Privacy 第5条"配送快递公司名称待确认"：这个是真不知道的业务事实（用的是哪家快递还没定），没法编，改成不点名的"our delivery courier"这种泛化表述，去掉一个明显的"TODO"占位符，但没有编造一个假名字
- **顺带把 Privacy 正文补全了这次新加的功能**：第1/2/4/5条都加了"如果注册账号"对应会收集 Google/Facebook 登录信息、生日性别（用于年龄校验）、已保存地址这几项，跟实际代码收集的数据保持同步

**Terms/Privacy/Delivery/Refund 四个页面的"内部草稿"大黄条通知都去掉了**（`age-restriction.html` 上一轮已经去掉），跟用户要求一致。**注意**：只去掉了显眼的黄条大通知，页面标题下方那行小字"Internal draft — prepared for review, not yet published to customers."还留着——这份文件毕竟还没真的过律师，这行小字提醒仍然属实，没有跟着一起删。Delivery/Refund 两页正文里剩下的占位符（配送范围、派送失败流程、退款窗口天数）**没有动**——这些是纯业务决策，不是"参考paneco"能解决的（paneka自己都没做全，比如它压根没有派送失败流程说明），需要用户自己定。

**5个政策页面（Terms/Privacy/Delivery/Refund/Age Restriction）页脚统一加上了政策链接导航**：用户截图指出打开 Privacy 页面后，页脚只有"TRINITY GLOBE TRADING"和版权文字，没有 Terms & Conditions/Privacy Policy/Delivery Policy/Refund & Returns/Responsible Drinking 这五个链接——而首页 `index.html` 的页脚是有的（`.footer-links`）。已经给这5个政策页面的页脚都补上了跟首页一模一样的这组链接（用相对路径互相指向，因为都在 `policies/` 目录下），5个页面现在页脚完全一致。浏览器截图确认 Privacy 页面页脚 5 个链接正确显示。

这次改动（`customer_addresses` 迁移已跑到线上、`addresses.html`/`addresses-i18n.js`/`src/addresses-page.ts`、导航下拉菜单加 My Address、Terms/Privacy 内容补完、四个政策页去掉草稿大通知、五个政策页页脚统一）**还没 commit**。

---

## 2026-08-26（第八轮）：admin-app 完整回归 + 4 个后续修正

用户要求对 admin-app 做一次完整回归（订单列表/详情、新状态、地址快照、GST/配送费金额、状态操作、退款、库存变化），并实际用 Stripe test-mode 走一遍付款流程。**这轮发现的最关键问题**：`order_status_history` 只有 SELECT 的 RLS 策略，记录状态变更的触发器以调用者身份运行——admin-app 用自己的员工 JWT（而非 Netlify Function 的 service_role）直接改状态时，触发器插入历史记录会被 RLS 拒绝，导致**整个状态更新静默回滚**（"Mark as Preparing"点了看起来没反应，数据库其实压根没变）。这个 bug 在这轮之前从来没被发现过，因为之前从来没有人真正点开运行中的 admin-app 测试过这些按钮。

修了这个之后，用户又指出这轮的初版修复还不够严谨，追加了 4 点必须做到才能算过关：

1. **退款幂等要用持久化记录，不能只在前端生成一次性 key**——已重写：新增 `refund_requests` 表（`0014_refund_request_ledger.sql`），`claim_refund_request`/`settle_refund_request` 两个 RPC。每次退款意图对应一条持久记录，用它自己的 `id` 当 Stripe 幂等键；网络超时/页面刷新/两个后台标签页/两个管理员同时操作，都会命中同一条 `pending` 记录、复用同一个幂等键重试，不会生成新 key——完全对齐 Stripe 官方"结果不确定时用同一个幂等键重试"的建议。只有 Stripe 明确拒绝（`StripeInvalidRequestError`，比如金额不对）才会把记录标记 `failed`、允许下次用新记录重试；任何其他错误（网络/超时/5xx）保持 `pending`，明确告诉后台"请稍后重试，重试是安全的"。
2. **定时释放库存任务的运行状态需要能被看见**——`release-expired-reservations.ts` 现在每次执行（不论成功失败）都会往新增的 `scheduled_job_runs` 表（`0015_scheduled_job_health.sql`）写 `last_run_at`/`last_success_at`/`last_error`；admin-app 订单列表页顶部新增了 `StaleJobWarning`，超过15分钟没有成功记录就会显示醒目黄色警告。**这只解决了"能不能被发现"，实际部署状态（Netlify 后台 Functions 列表是否真的有这个函数、cron 有没有跑、Run now 手动测试）仍需要用户自己去 Netlify 后台确认**——这台机器没有登录 Netlify CLI，够不到。
3. **库存恢复规则不是一条，是三条不同的规则，之前的总结把它们混在一起了**——已经用真实数据分别验证：
   - 待付款订单取消（`cancel_pending_order_as_staff`/`cancel_own_pending_order`）：`inventory.website_stock` 全程不变（因为 `pending` 预留本来就没扣过这个字段），但 `get_available_stock()`（给可售数量算法用的"可用库存"）会立刻恢复——实测 50→49（预留）→50（取消）。
   - 待付款订单过期（`expire_stale_reservations` + `mark_order_failed_from_webhook`）：跟取消完全一样的机制，实测同样 50→49→50。
   - 已付款订单退款：`website_stock` 在确认付款时已经真的扣减过，退款**不会**自动加回来——实测 49→48（付款扣减）→48（退款后不变），是刻意设计，是否补库存需要老板自己确认商品是否退回且能再卖。
   三个场景的 SQL 脚本跑完都已清理，`inventory.website_stock` 确认恢复到统一基线 50。
4. **`SECURITY DEFINER` 函数需要防住 search_path 劫持**——`0013` 里加了 `search_path = public, pg_temp`，但这还不够：Postgres 解析未加schema前缀的表名时，会话自己的临时表（`pg_temp`）**永远优先被查**，跟 search_path 里写没写 `pg_temp`、写在哪个位置都无关——这正是 CVE-2018-1058 那类 SECURITY DEFINER 权限提升手法的原理。已经在 `0016_harden_status_history_functions.sql` 里把函数体内的表引用改成完整限定名 `public.order_status_history`，从根本上排除被临时表偷换的可能。用 `pg_proc` 直接查询确认了 `prosecdef=true`、`proconfig=["search_path=public, pg_temp"]` 都生效，且函数体内只有这一处、别无其他表引用或动态SQL，不存在被利用去做别的事的空间。

**上线前检查清单也做了两处对应更新**：库存=50 那条改成了明确的"临时测试基线，运营确认前不得当真实库存"措辞；新增了"确认 `release-expired-reservations` 真的在生产环境跑着"这一条完整的验证步骤清单。

全部改动已过 storefront + admin-app 的 typecheck/test/build，用真实 Stripe test-mode 付款（不是 mock）在 admin-app 真实界面走完了 付款→处理中→配送中→已完成、全额退款、部分退款三条路径，库存三种场景分别验证，`SECURITY DEFINER` 加固后重新跑过一次状态变更确认功能没坏。测试产生的订单/预留/历史记录全部清理，`inventory.website_stock` 确认回到统一基线 50。

## 2026-08-26（第九轮）：GST 生效日期设计 + 客户端展示

用户否决了"无论是否注册都保存 `gst_cents`"这个初版方案，理由是 IRAS 规定 GST 只能从注册生效日期起收取，未注册期间显示或保存一个非零 GST 金额会造成税务含义错误。改成了基于生效日期的设计：

- `store_settings` 表：去掉了原来的 `gst_registered` boolean，改成 `gst_registration_effective_at`（timestamptz，来自 IRAS 批准信）+ `gst_registration_number`（正式注册后填）。是否收 GST 由"当前时间是否已过生效日期"决定，不再是一个人工手动切换的开关。
- `orders` 表新增两个下单时刻的快照字段：`gst_registered_at_checkout`（bool）、`gst_rate`（下单时的税率，未生效时为0）。`gst_cents` 本身也是快照——未注册/未生效时永远是 0，绝不会保存一个"算出来但没实际收取"的金额。这样历史订单的税务含义不会因为后来打开开关或修改生效日期而被重新解释。
- 迁移：`supabase/migrations/0017_gst_registration_effective_date.sql`（已上线执行），同时把 `create_pending_order` RPC 改成接收并存储这两个新快照参数。
- 计算逻辑本身（`src/pricing.ts#computeInclusiveGstCents`，未生效返回0，生效则按 `金额 - 金额/1.09` 算出含税价里的GST部分）在更早的回合就已经写对了，这轮真正做的是把它接上 `create-checkout-session.ts` 的生效日期判断，并且**把它第一次真正展示给客户**——此前 `gst_cents` 虽然一直在存，但结账页、我的订单、确认邮件里从来没有一个地方显示过它，只有 admin-app 有。这轮补上了：我的订单详情页（`orders-page.ts`，仅在 `gstRegisteredAtCheckout` 为真时才出现的一行）、订单确认邮件（`_lib/email.ts`，同样条件展示，灰色小字"Includes GST: S$X.XX"）、`get-my-orders.ts`/`src/types.ts`/`orders-i18n.js`（新增中英文 "GST"/"消费税(GST)" 词条）全部打通。admin-app 那边的展示行也同步改成读新字段，未生效时显示"Not applicable — not GST-registered at checkout"而不是显示一个 S$0.00。
- **实测验证**（真实 Supabase 写入，不是 mock）：(1) 当前真实状态（未注册）下单一笔 S$170 的订单，确认存了 `gst_cents=0, gst_registered_at_checkout=false, gst_rate=0`；(2) 临时把 `gst_registration_effective_at` 改到过去的日期模拟"已生效"，同样金额下单，确认存了 `gst_cents=1404, gst_registered_at_checkout=true, gst_rate=0.09`——手工验证 `1404 = round(17000 - 17000/1.09)`，跟 9/109 公式精确吻合。验证完成后**已经把 `gst_registration_effective_at` 改回 `null`**（真实状态就是还没注册，不能让模拟状态留在生产数据库里），两笔测试订单也已删除干净，`typecheck`/`test`/`build` 两个项目都重新跑过一遍全部通过。
- **浏览器像素级 UI 检查这轮没做**：需要一个真实登录态的顾客账号在 `orders.html` 上打开一笔含 GST 的订单详情才能肉眼确认样式，而这轮尝试用脚本刷新一个测试账号的 session token 被 Claude Code 自身的权限分类器拦截（把"程序化操作认证 token"归类为高风险操作，合理拒绝）。逻辑本身很简单（一个三元表达式，`orders-page.ts`/`OrderDetail.tsx`/`email.ts` 三处写法一致），且已经在 DB 和 API 字段层面完整验证过，风险不高，但严格来说这一步应该并入用户自己在 Deploy Preview 阶段做真实手机测试时顺带看一眼订单详情页的 GST 那一行是否正确显示/隐藏。
- 顺带确认：配送费政策的中文版（`policies/delivery.html`）其实早就正确写着 S$15/S$120（跟英文版一致），之前某一轮里我曾经错误地告诉用户"中文版没写数字"，这轮翻回原文确认是我看错了，已经当面纠正，没有做多余的改动。

这轮改动尚未 commit：`supabase/migrations/0017_gst_registration_effective_date.sql` + `netlify/functions/create-checkout-session.ts`/`get-my-orders.ts`/`stripe-webhook.ts`/`admin-resend-order-email.ts`/`_lib/email.ts` + `src/types.ts`/`src/orders-page.ts`/`orders-i18n.js` + `admin-app/src/lib/types.ts`/`admin-app/src/pages/OrderDetail.tsx` + 本文件本身。

---

## 2026-08-26（第十轮）：Supabase RLS + admin-app 权限完整审计

用户要求专门做一轮"只做权限审计"（不碰邮件失败追踪、不push、不merge main、不动Stripe live配置），盘点所有表/RPC的RLS和EXECUTE授权，并用真实测试账号（不是猜测）验证。

**方法**：没有走"读代码猜测"的路线，而是直接读线上Supabase的真实状态——`pg_policies`、`pg_proc.prosecdef/proconfig`、`information_schema.routine_privileges`、`pg_proc.proacl`——逐张表、逐个函数核对，再用两个全新创建的真实Supabase Auth测试账号（用户A/B，通过`service_role`的`auth.admin.createUser`创建，测试用密码，事后连账号一起删除）+ 一个匿名client + 真实登录session，跑了一套`.from()`/`.rpc()`权限测试脚本，前后共47项断言，而不是只看代码是否"看起来对"。

**结论先说**：**没有发现可被利用的跨用户数据泄露或伪造**——22项"A能不能读/改B的订单、地址、库存、退款记录"的测试全部通过，RLS本身的策略设计是对的（`orders`/`inventory`/`inventory_reservations`/`refund_requests`这些表压根没有给普通用户任何INSERT/UPDATE策略，所以就算被利用也写不进去）。真正的问题是**权限分层不够**——只靠RLS一层挡，本该只让Netlify Function（`service_role`）调用的RPC，实际上任何登录用户甚至匿名用户都能直接从浏览器调用。

**发现的真实问题（已修复，见`supabase/migrations/0018_lock_down_rpc_execute_grants.sql`）**：

1. **几乎所有业务RPC对`anon`/`authenticated`都开着EXECUTE权限**——`cancel_own_pending_order`、`cancel_pending_order_as_staff`、`claim_refund_request`、`settle_refund_request`、`reserve_inventory`、`confirm_inventory_reservation`、`release_inventory_reservation`、`expire_stale_reservations`、`get_available_stock`、`mark_order_paid_from_webhook`、`mark_order_failed_from_webhook`、`create_pending_order`——这些函数从写下的第一天起就没有人手动收回过默认权限，而Supabase对新建函数的默认行为就是"谁都能调"。目前恰好被RLS挡住没出事，但这是运气，不是设计：`cancel_pending_order_as_staff`/`claim_refund_request`/`settle_refund_request`这三个函数内部完全没有自己的角色/所有权校验，注释里写得很清楚——"权限判断交给调用它的Netlify Function负责"，也就是说这三个函数唯一的防线本来就该是"只有service_role能调用它"，而不是碰巧生效的RLS。已通过迁移把EXECUTE收回到只剩`service_role`。
   - **修复过程中一次真实的踩坑**：第一次尝试用`revoke execute ... from anon, authenticated`，测试脚本却显示完全没生效（直接调用这些RPC仍然"成功"跑到RLS那层才被挡下，而不是在权限检查这层就被拒绝）。查`pg_proc.proacl`才发现：Supabase对新函数的默认授权其实是`grant execute to PUBLIC`（不是分别对`anon`/`authenticated`各发一次），`information_schema.routine_privileges`会把PUBLIC的授权"解析展示"成好像每个角色都单独有一样，容易误判已经收回。改成`revoke ... from public`后重新测试，全部12个函数直接调用都变成了`42501 permission denied`，不再是绕到函数内部才报错。
   - **修复中的另一次真实回退**：第一版把`current_admin_role()`对`anon`的EXECUTE也一并收回，心想"匿名用户没道理直接调这个"——结果立刻把所有匿名用户对`orders`/`inventory`等表的正常只读查询全部搞坏（从"干净的空结果"变成`permission denied for function current_admin_role`）。原因是Postgres对同一张表的多条permissive策略是逐条求值的，哪怕最终是另一条策略（"customers can view own orders"）在起作用，"staff can view orders"里调用的`current_admin_role()`也照样会被求值一次——`anon`必须保留这个函数的EXECUTE权限，只是对匿名用户它永远返回null，不构成风险。测试脚本立刻抓到了这个回归（`anon still cannot read any orders` 从PASS变FAIL），马上改了回来。这两次"以为收紧了、其实没收紧"和"收紧过头、搞坏了正常功能"，都是靠真实测试脚本抓出来的，不是靠读代码推理出来的。
2. **`create_pending_order`遗留4个历史版本重载**——0002/0005/0007/0008每次改签名都是新增参数而不是完全对齐上一版的参数列表，Postgres的`create or replace function`只有签名完全一致才会真正替换，签名一变就变成了新增一个重载，旧版本从未被清理。结果是数据库里同时存在5个版本的`create_pending_order`，其中4个缺少后来才加上的GST计算、结账限流等校验逻辑，而且同样对外开放EXECUTE。已在0018里动态识别并`drop`掉所有不含GST字段的旧版本，只保留当前版本。
3. **admin-app两处直接UPDATE存在"静默假成功"**——`OrderDetail.tsx`的`handleStatusChange`（改订单状态）和`handleSaveNotes`（存内部备注）都是裸的`supabase.from("orders").update(...)`，没有`.select()`。真实复现：给测试账号A临时挂上`finance_readonly`角色（一个真实存在、只读性质的员工角色），直接调用同一段代码——`error`是`null`，`data`也是`null`（因为没有.select()），前端代码原样判断"没报错→刷新页面"，用户会看到"点了按钮，页面刷新了，但状态其实根本没变"，却得不到任何提示。已修复：两处都加上`.select("id")`，返回数组为空时显式报错"Update was not applied — you may not have permission..."，修复后重新用同一个`finance_readonly`账号复现，确认现在能拿到明确的报错文案。

**验证过、确认没问题、不需要改的**：
- `current_admin_role`/`log_order_status_initial`/`log_order_status_change`——目前schema里*仅有*的3个`SECURITY DEFINER`函数，此前0013/0016已经加固过`search_path`（含`pg_temp`防临时表劫持），本轮确认加固范围完整、没有遗漏别的`SECURITY DEFINER`函数。其余业务RPC全部是`SECURITY INVOKER`（以调用者身份运行，不受同一类临时表劫持手法影响，不需要同样的`search_path`加固）。
- admin-app（管理员前端）自身**没有任何直接的`.rpc()`调用**，也没有在打包产物里嵌入`service_role`密钥（只用`VITE_SUPABASE_ANON_KEY`）——所有需要绕过RLS的操作（取消订单、退款、重发邮件）都老老实实走各自的Netlify Function，Function内部逐一检查`admin_profiles.role`。唯一的直接表操作是订单状态更新和备注保存这两处，靠的是`orders`表"ops and admin can update orders"这条RLS策略本身把关，不是靠前端判断——即使有人拿开发者工具直接调用同样的Supabase请求，没有admin/ops角色的账号一样会被数据库拒绝（本轮加了`.select()`之后，这次拒绝会明确显示出来，而不是静默失败）。
- `cancel_own_pending_order`/`set_default_customer_address`虽然靠传入的`p_user_id`参数做归属校验（不是从`auth.uid()`现取），单独看是脆弱设计，但结合RLS——攻击者哪怕在参数里冒充别人的`user_id`，函数内部第一步`select ... for update`本身就会被RLS按攻击者的真实`auth.uid()`过滤掉，压根走不到归属校验那一步。这个结论专门用真实跨用户请求验证过（A尝试对B的地址/订单直接调用两个函数，均在真正修改数据前就被拦下）。

**最终权限矩阵**（`anon`=未登录访客，`authenticated`=普通登录客户，`staff`=在`admin_profiles`里有对应角色的员工，`service_role`=Netlify Functions专用）：

| 资源 | anon | 普通登录客户 | staff: finance_readonly | staff: ops/admin | service_role |
|---|---|---|---|---|---|
| orders（读） | 无 | 仅自己的 | 全部只读 | 全部只读 | 全部 |
| orders（改状态/备注） | 无 | 无 | 无（本轮验证会被拒绝，且现在有明确报错） | 可以（受状态流转trigger限制） | 全部 |
| orders（建单/取消/退款/标记已付） | 无 | 无（走对应Netlify Function） | 无 | 无（走Netlify Function） | 全部（经对应RPC） |
| order_items / order_status_history | 无 | 仅自己订单关联的 | 全部只读 | 全部只读 | 全部 |
| customer_addresses / customer_profiles | 无 | 仅自己的（含"设为默认地址"这一直连RPC） | 无 | 无 | 全部 |
| inventory / inventory_movements / inventory_reservations / product_variants / store_settings / scheduled_job_runs | 无 | 无 | 只读 | 只读 | 全部（写入均只能通过RPC） |
| refund_requests | 无 | 无 | 只读 | 只读（写入仍必须走`admin-refund-order.ts`） | 全部 |
| admin_profiles | 无 | 无 | 仅自己那一行 | admin角色可管理全部（含新增/改角色） | 全部 |
| checkout_rate_limits / stripe_events | 无（无任何策略，纯内部记账表） | 无 | 无 | 无 | 全部 |
| 全部业务RPC（除下两条） | 拒绝（42501） | 拒绝（42501） | 拒绝（42501，须走对应Netlify Function） | 拒绝（42501，须走对应Netlify Function） | 全部 |
| `set_default_customer_address` | 拒绝 | 可调用（仅影响自己数据） | 同左 | 同左 | 全部 |
| `current_admin_role` | 可调用（对匿名恒返回null，RLS策略内部要用） | 可调用 | 同左 | 同左 | 全部 |

**测试与清理**：47项断言（22项跨用户RLS读写、13项EXECUTE收回后的直接RPC调用应被拒绝、5项收回权限前后的匿名/普通用户只读回归对比、7项其余）全部通过；测试用的两个Supabase Auth账号、订单、地址、临时`finance_readonly`角色，测试结束后全部清理，`inventory.website_stock`确认全程未被真实测试触碰（回到基线50）；storefront与admin-app的`typecheck`/`test`/`build`本轮结束前重新跑过一遍，全部通过。

**仍需人工确认的事项**：
1. ~~`admin_profiles`表"admins manage admin profiles"这条策略允许`admin`角色通过前端直接对`admin_profiles`做增删改~~——**用户已决定**：暂不做专门的管理员管理界面，第一个/后续管理员继续由技术人员在数据库后台手动设置，但操作方法必须写清楚（见下面"管理员账号的创建/修改/撤销"）。**不提供公开的"申请管理员"入口。**
2. ~~`checkout_rate_limits`/`stripe_events`两张纯内部记账表对任何角色都没有读权限~~——**用户已确认**：这是正确的，这两张属于安全与系统内部表，只应该让`service_role`访问，admin-app不需要展示，无需改动。
3. ~~`finance_readonly`角色登录admin-app后界面上仍能看到"改状态"、"保存备注"等按钮~~——**用户要求UI层也隐藏/禁用**这些按钮（更新订单状态、编辑备注、取消订单、发起退款、重新发送邮件），保留查看订单/金额/GST/退款记录的权限。**核实后发现这一条其实早在更早的一轮（`0ba2d9d`，本次RLS审计之前）就已经实现**：`OrderDetail.tsx`里的`canWrite = role === "admin" || role === "ops"`已经把这5个操作入口全部包在`canWrite &&`条件里（状态变更按钮、备注文本框和保存按钮、整个Refund区块、整个Email区块）。本轮用一个真实创建的`finance_readonly`测试账号在真实浏览器里登录、打开一个已付款订单验证：页面上**只有"Sign out"一个按钮**，备注文本框是禁用状态，"Refund"和"Email"两个区块整个不渲染，Fulfilment区块显示"Read-only access"文字提示；Customer/Items/Payment（含GST行）/History这些只读区块正常显示。验证完毕后测试账号、测试订单已清理。**没有需要新增的代码。**

### 管理员账号的创建/修改/撤销（运营文档，替代"专门管理界面"）

`admin_profiles`表结构：`user_id`（主键，关联`auth.users`）+ `role`（`admin`/`ops`/`finance_readonly`三选一）+ `display_name`（可选）。目前**没有、也不打算做**前端管理界面，全部操作走Supabase Dashboard的SQL Editor（用的是`postgres`身份，天然绕过RLS，不需要先有一个admin账号才能设置第一个admin）：

- **新增管理员**：先确认这个人已经用Google/Facebook/邮箱在**网站前台**（不是admin-app）注册过一次，拿到其`auth.users.id`（可以在Supabase Dashboard的Authentication页面按邮箱搜索），然后执行：
  ```sql
  insert into admin_profiles (user_id, role, display_name) values ('<user_id>', 'admin', '<姓名，可选>');
  ```
- **修改角色**：`update admin_profiles set role = 'ops' where user_id = '<user_id>';`
- **撤销管理员权限**（不再是任何员工角色）：`delete from admin_profiles where user_id = '<user_id>';`——删除后这个账号仍然是一个普通登录用户，只是不再能看到任何后台数据，跟从未当过管理员的账号完全一样。
- 这三个操作都是**立即生效**的（下次这个账号的请求会重新算出新的`current_admin_role()`），不需要重启任何服务，也不需要这个员工重新登录。

本轮改动（`supabase/migrations/0018_lock_down_rpc_execute_grants.sql`、`admin-app/src/pages/OrderDetail.tsx`两处`.select()`修复、本文件）已经commit到本地`dev`分支，没有push、没有merge main、没有碰Stripe任何配置。

## 2026-08-26（第十轮·收尾）：收权后的真实端到端回归

用户认可第十轮的审计质量后，要求在正式关闭这一步之前，针对migration 0018收回EXECUTE权限这件事本身，专门做一次回归——确认真正合法的调用路径（匿名浏览、登录客户下单/改地址/取消订单、员工履约/退款、Netlify Functions内部调用）一个都没被误伤。同样坚持"真实测试账号+真实HTTP请求"，不满足于读代码。

**测试方式**：不是又调一次RPC了事，而是真正打到本地`netlify dev`跑着的Function（`localhost:8888`），用真实创建的Supabase测试账号（客户1个、员工admin角色1个，测试完都删除）走完整HTTP请求链路，其中退款那一步用了真实的Stripe test-mode API创建了一笔货真价实的PaymentIntent（`pm_card_visa`）并让`admin-refund-order.ts`把它真退掉，不是造假数据。13项断言：

- 匿名：`products-live.ts`正常返回真实库存（`availableStock: 50`）——确认`get_available_stock`收回EXECUTE后，前台库存查询完全不受影响，因为它本来就是通过`service_role`的后端接口查的，从来没有让浏览器直接调用过这个RPC。
- 登录客户：`set_default_customer_address`直接调用仍然成功（这是唯一保留给`authenticated`的RPC），地址在数据库里确认被设为默认。
- 登录客户：`create-checkout-session.ts`正常创建订单（内部调用`create_pending_order`）、`resume-checkout-session.ts`正常续上同一个订单、`cancel-my-order.ts`正常取消（内部调用`cancel_own_pending_order`），三步全部通过真实HTTP请求验证，且数据库里的订单状态确认真的变了，不是接口"看起来成功"。
- Admin账号：直接对`orders`表更新状态和备注（走的是admin-app实际使用的同一种直接更新方式，靠RLS的"ops and admin can update orders"策略把关）都成功；`admin-cancel-order.ts`和`admin-refund-order.ts`（真实Stripe退款）都端到端跑通，数据库里订单状态、`refunded_cents`都确认正确落地。

**13/13全部通过，没有发现任何回归**。测试产生的订单、地址、Supabase测试账号全部清理，`inventory.website_stock`确认全程未受影响（回到基线50，因为唯一一笔真实预留在同一轮测试内被取消释放了）。收尾时`storefront`和`admin-app`的`typecheck`/`test`/`build`未再变动（上一轮已经跑过，本轮没有改动业务代码，只改了`PROJECT_STATUS.md`）。

**这一步（Supabase RLS + admin-app权限审计）到此正式关闭。** 下一步按原计划开始邮件失败追踪账本（见"必须做"清单里的"邮件发送失败追踪账本"一条）。

## 2026-08-27（第十一轮）：邮件发送追踪账本

用户要求单独实施邮件发送追踪账本（客户确认邮件 + 员工通知邮件分别记录状态、幂等、接入 Resend Webhook、admin-app 展示、订单独立性），不 push、不 merge main。

**数据库设计**（`supabase/migrations/0019_email_delivery_tracking.sql`）：新增 `email_logs` 表，每一行代表"一次发送尝试"，`id` 本身就是发给 Resend 的 `Idempotency-Key`（跟 `refund_requests` 用自己的 `id` 当 Stripe 幂等键是完全一样的思路）。状态机：`pending`（已认领，Resend 调用结果未知）→ `accepted`（Resend API 调用成功，**不代表已送达**）→ 后续由 webhook 事件推进到 `delivered`/`delayed`/`failed`/`bounced`/`suppressed`。三个 RPC：
- `claim_email_send`——发起一次发送前先认领一条记录；如果同一笔订单同一种邮件类型已经有一条 `pending` 记录，直接复用（网络超时/结果不明时安全重试，不产生新幂等键），除非调用方明确要求 `p_force_new`（员工点"重新发送"时用，哪怕上一次已经 `delivered` 也必须开一条全新记录，绝不会复用旧的）。
- `settle_email_send`——记录 Resend API 调用的即时结果：只有能确定"这个请求永远不会成功"的错误（如收件地址格式不合法）才会落成 `failed`；网络错误、限流、Resend 5xx 等一律保持 `pending`，交给下一次重试复用同一个幂等键，完全对应 Resend 官方文档说的"结果不明时用同一个 key 重试"。
- `apply_email_webhook_event`——webhook 事件落库前先按状态"能量等级"（pending<accepted<delayed<delivered<failed<bounced<suppressed）判断新事件是否比当前状态更"确定"，只允许状态前进、不允许被一个迟到的旧事件（比如 `delivered` 之后又收到一条迟到的 `delayed`）打回去。

三个函数都不给 `anon`/`authenticated` 开 EXECUTE（只有 `service_role`），另建了一张 `resend_webhook_events` 去重表（跟 `stripe_events` 一模一样的写法，同样没有任何角色的 RLS 策略，纯内部记账表）。

**这一轮发现并当场修正的一个真问题**：`0018` 收尾时加的 `alter default privileges in schema public revoke execute on functions from public`，本意是让以后每个新建的函数自动就没有 `PUBLIC` 的 EXECUTE 权限，不用每次都手动收权——**这轮新建 3 个函数后直接查 `pg_proc.proacl` 验证，发现这三个函数依然带着 `=X`（PUBLIC）授权，跟 `0018` 之前的行为一模一样，说明那条"改默认权限"的语句根本没起作用**（大概率是 Supabase 项目自己的初始化脚本用另一个角色设置了这条默认权限规则，我们用 `postgres` 身份跑的 `alter default privileges` 覆盖不到）。已经在 `0019` 里对这三个函数补了明确的 `revoke execute ... from public`，当场重新验证 `proacl` 确认干净，并把这个发现写进了迁移文件的注释里：**以后每一个新建函数必须自己显式 `revoke`，不能再指望那条全局默认权限设置生效**。

**代码改动**：
- `netlify/functions/_lib/email.ts` 重写，新增内部 `sendTrackedEmail()` 封装了"认领→发送→结算"整个流程，`sendOrderConfirmationEmail`/`sendStaffNotificationEmail`（自动触发，webhook 里调用）和新增的 `resendOrderConfirmationEmail`/`resendStaffNotificationEmail`（员工手动重发，`forceNew=true`）都复用同一套逻辑。**所有分支都不会往外抛异常**——数据库调用失败、Resend 调用失败、网络错误全部 `console.error` 后原样返回，延续了这个文件一直以来的纪律（一次改动都没有破坏 `stripe-webhook.ts` 里 `Promise.allSettled` 的既有用法）。
- `netlify/functions/resend-webhook.ts`（新）：用官方 `svix` 包验证签名（Resend 的 webhook 就是用 Svix 签的），验证失败直接 400，不会跑到任何业务逻辑；处理 `email.sent/delivered/delivery_delayed/failed/bounced/suppressed` 六种事件；成功处理后才把 `svix-id` 记入去重表（跟 `stripe-webhook.ts` 的"先处理成功再记录"是同一套纪律，处理失败时不落库，让 Resend 的自动重试有机会再来一次）。
- `netlify/functions/admin-resend-order-email.ts` 重写：现在接受 `emailType` 参数，客户确认信/员工通知信都能重发；角色检查沿用 `admin-refund-order.ts` 的写法（只认 `admin_profiles.role`，只有 `admin`/`ops` 能调，`finance_readonly` 会被拒绝）。
- admin-app：`OrderDetail.tsx` 的 Email 区块重写为分别显示两种邮件的状态徽章 + 失败原因文字 + 独立的重发按钮；**查看邮件状态对所有员工角色可见（含 `finance_readonly`），只有"重发"按钮受 `canWrite` 门槛限制**——这跟用户"财务只读账号能看不能发"的要求精确对应。已送达（`delivered`）状态默认不显示重发按钮（避免误点重复发送），其余状态都保留按钮。`OrdersList.tsx` 新增按订单聚合"最新一次尝试状态"的逻辑，任何订单只要有一种邮件类型的最新状态是 `failed`/`bounced`/`suppressed`，订单号旁边就会出现一个醒目的"⚠ Email"标记。

**订单独立性**：整套改动没有一行代码写 `orders`/`inventory`/`inventory_reservations` 表，也没有任何邮件相关的调用出现在 `mark_order_paid_from_webhook`/`mark_order_failed_from_webhook`/`cancel_own_pending_order` 等状态流转 RPC 内部——`stripe-webhook.ts` 里发邮件仍然是 RPC 执行、`return jsonResponse(200,...)` 之后才触发的 `Promise.allSettled`，邮件那边无论成功失败都不会让这个 Function 的 HTTP 响应变成非 200，Stripe 端不会因为邮件问题重试整个 webhook。

**真实测试（16/16 全部通过，不是 mock）**：
- 真发信到 Resend 官方测试地址 `delivered@resend.dev`：`email_logs` 正确记录 `status=accepted` + 拿到真实的 `resend_email_id`。
- 真发信到 `bounced@resend.dev`：同样先落 `accepted`（bounce 是异步事件，API 调用本身确实成功）。
- 故意用一个格式非法的收件地址（`not-a-valid-email-address`）：Resend 同步返回 `validation_error`，正确落成 `failed` 并记录了 Resend 原话作为失败原因。
- `finance_readonly` 测试账号真实调用 `admin-resend-order-email.ts`：返回 403，符合权限要求。
- 幂等：模拟"网络超时未结算"（认领后不调用 `settle_email_send`），第二次认领确认复用同一个 `id`；员工强制重发（`force_new=true`）确认总是拿到一个全新 `id`，不会误用旧的。
- Webhook：用 `svix` 包自己签发的合法测试事件（本机自签，见下方"仍需人工确认"）真实推给本地跑着的 `resend-webhook.ts`——`email.delivered` 正确把状态推进到 `delivered`；`email.bounced` 正确推进到 `bounced` 并提取出 `Permanent: Mailbox does not exist` 这样的失败原因；故意在 `delivered` 之后再推一条 `email.delivery_delayed`，确认状态没有被打回 `delayed`（"能量等级"逻辑生效）；篡改签名的请求被正确拒绝（400）；同一个 `svix-id` 重复投递第二次被正确去重（`deduped:true`），没有重复处理。
- 全程用真实浏览器登录一个真实创建的 admin 测试账号，打开刚才那两笔测试订单，肉眼确认 `Delivered`/`Bounced` 状态、失败原因文字、按钮显隐（`delivered` 那笔没有重发按钮，`bounced` 那笔有）、`OrdersList` 页面的"⚠ Email"标记都跟数据库状态一致。
- 最后确认测试期间 `orders.status`/`refunded_cents` 全程没有被这些邮件操作动过。

测试产生的订单、`email_logs`、Supabase 测试账号（客户 1 个、admin 1 个、finance_readonly 1 个、单独做浏览器核对又建了 1 个）、`resend_webhook_events` 里的自测行全部清理干净，`inventory.website_stock` 确认全程未受影响（回到基线 50）。`storefront`/`admin-app` 的 `typecheck`/`test`/`build` 全部通过。

**仍需人工确认的事项**：
1. **`RESEND_WEBHOOK_SECRET` 目前是本机生成的测试值，不是 Resend 真实签发的**——因为 Resend 后台注册 webhook 需要一个公网可达的 URL，本地 `netlify dev` 做不到，只能等这个分支 push 出 Deploy Preview 后，去 Resend 后台 Webhooks 页面注册真实 endpoint、拿到真实密钥后替换。这也是本轮所有 webhook 测试都用"自己签发测试事件直接 POST 给本地端点"而不是等 Resend 真的推送过来的原因——验证的是签名校验、去重、状态机这些**代码逻辑本身**，不是"Resend 真的会把事件送到我们这儿"这件事，后者要等 Deploy Preview 阶段才能真正验证。
2. Resend webhook payload 里 bounce/failed/suppressed 各自的失败原因具体嵌在 `data.bounce.message`/`data.failed.reason`/`data.suppression.reason` 的判断，是按 Resend 公开文档的字段命名推断写的，本轮没有拿到一条 Resend 真实推送的原始 payload 核对过——建议在 Deploy Preview 阶段用真实 webhook 命中一次 `bounced@resend.dev` 之后，顺手确认一下 admin-app 里显示的失败原因文字是否真的有意义（如果字段路径猜错了，最坏情况只是失败原因显示为空，不影响状态本身的正确性，因为状态是从 `event.type` 直接映射来的，跟这几个可选字段无关）。
3. 邮件追踪目前只覆盖"客户订单确认邮件"和"员工订单通知邮件"这两种——`sendPaymentReviewAlertEmail`（付款异常需要人工核实时发给员工的警报邮件）**刻意没有纳入这套账本**，因为它不是每笔订单都会触发的常规邮件，而且它对应的异常状态本身已经在 admin-app 里可见（订单会停在 `payment_review`），如果用户觉得这个警报邮件本身的送达情况也需要追踪，需要另外说一声。

本轮改动（`supabase/migrations/0019_email_delivery_tracking.sql`、`netlify/functions/_lib/email.ts`、`netlify/functions/resend-webhook.ts`、`netlify/functions/admin-resend-order-email.ts`、`admin-app/src/lib/types.ts`、`admin-app/src/pages/OrderDetail.tsx`、`admin-app/src/pages/OrdersList.tsx`、`admin-app/src/admin.css`、`package.json`/`package-lock.json`新增 `svix` 依赖、`.env` 新增 `RESEND_WEBHOOK_SECRET`、本文件）已经commit到本地`dev`分支，没有push、没有merge main。

## 2026-08-27（第十二轮）：推送前完整回归

用户要求在 push `dev` 分支、生成 Deploy Preview 之前，先在本地对目前累积的所有 commit（含RLS收权、GST、邮件账本三轮）做一次完整回归，并专门补测两个此前一直没真正执行过的场景：定时任务"从未产生心跳记录"时的告警、以及 Stripe 退款成功但进程在 `settle_refund_request` 之前中断后重试的恢复行为。

**方法**：一条脚本走完整个客户生命周期，全程真实调用（真实 HTTP 打本地 `netlify dev`、真实 Stripe test-mode API、真实 Resend 发信），不用任何 mock。共 34 项断言，全部通过；过程中还真实踩到并纠正了两个测试脚本自身的问题（不是产品代码问题，但记录下来避免下次重复踩坑）：

**踩坑记录**：
1. 直接 `curl`/`fetch` 打 `release-expired-reservations` 这个 `config.schedule` 函数在本地会被 `netlify dev` 拦截，返回一句提示"这是定时函数，本地这样调用/生产环境都不会真的触发"——必须改用 `netlify functions:invoke <name> --port 8888`，这才是 CLI 官方提供的"本地模拟一次定时触发"方式。
2. 短时间内反复用同一台机器发起多次真实结账，触发了 `0008_checkout_hardening.sql` 自带的"每个 IP 10 分钟内最多 5 次结账"限流——这是限流功能本身工作正常的证据，不是 bug，测试时手动清空 `checkout_rate_limits` 表即可继续（生产环境这张表本来就靠 `release-expired-reservations.ts` 每次运行顺手清理一天前的旧记录，不需要人工干预）。

**场景一：从未产生心跳记录时的告警**——`scheduled_job_runs` 表当前确实是 `last_success_at = null`（这本来就是事实：这个函数至今没有在任何真正的生产环境跑过），验证 admin-app 里 `StaleJobWarning` 组件的判断逻辑 `!lastSuccessAt || 距今超过15分钟` 在 `lastSuccessAt` 为 `null` 时正确判定为"需要告警"。随后真实调用 `netlify functions:invoke release-expired-reservations` 触发一次真实执行，确认心跳被正确写入（`last_success_at` 变成刚才的真实时间戳，`last_error` 为空），告警条件正确解除。测试结束后已经把 `scheduled_job_runs` **重新改回 `null`**——这次是本地测试触发的，不是生产环境真的在跑，留一个"看起来正常"的假时间戳在共享的 Supabase 项目里会误导之后任何人看这张表的判断。

**场景二：Stripe 退款成功但结算前中断，重试恢复**——完整复现了 `admin-refund-order.ts` 自己的前两步（`claim_refund_request` 拿到一条持久记录、用这条记录自己的 `id` 当 Stripe 幂等键真实调用 `stripe.refunds.create`，这一步 Stripe 那边已经真实退款成功），然后**故意不调用 `settle_refund_request`**，模拟"进程在这一步之前就挂了"。此时数据库里 `refund_requests` 还停在 `pending`，订单 `status` 还是 `paid`、`refunded_cents` 还是 0——这就是崩溃后的真实状态。随后对**未经任何修改的真实 `admin-refund-order.ts` 端点**发起"重试"请求（模拟员工再点一次退款按钮）：确认它复用了同一条 `refund_requests` 记录（同一个 `id`），用同一个幂等键再次调用 Stripe，Stripe 因为幂等键匹配直接返回了**第一次那笔真实退款**（而不是创建第二笔）——`stripe.refunds.list()` 直接查 Stripe 自己的记录确认这个 PaymentIntent 上始终只有一笔退款，不是只有我们数据库这边"看起来"没重复。最终 `refund_requests` 正确结算为 `succeeded`，`stripe_refund_id` 正确补写为崩溃前那次真实生成的退款 ID，订单 `refunded_cents` 精确等于 `total_cents`（没有退多也没有退少），全程只退了一次。

**其余端到端场景**（同一条脚本、同一批真实订单里顺带验证，确认互相之间没有污染）：
- 匿名浏览 `products-live.ts` 正常拿到真实库存（`get_available_stock` 收权后前台查询依然畅通，呼应上一轮"仍需人工确认"里的第2条）。
- 客户注册、设默认地址、下单（`create-checkout-session.ts`）、续单（`resume-checkout-session.ts`）全部走通；用真实签名的 `checkout.session.completed` Stripe事件（本地自签，跟测 Resend webhook时的方法论一致：验证的是代码逻辑本身，不是"Stripe真的把事件送到本地"这件事）真实打 `stripe-webhook.ts`，确认订单转 `paid`、库存正确扣减、**客户确认信和员工通知信两条 `email_logs` 记录都被自动创建并且 Resend 真实接收**——这是邮件账本第一次在"自动触发"（而不是 admin-app 手动重发）路径上被验证，补上了上一轮遗留的一个真实覆盖缺口。
- 客户取消自己的待付款订单（`cancel-my-order.ts`）、一笔预留到期后用真实 `release-expired-reservations` 定时函数处理（预留状态、Stripe Checkout Session 都真实过期）、再用真实签名的 `checkout.session.expired` 事件打通订单状态转 `expired`（这一步同样发现了"订单状态转 `expired`依赖 Stripe 真的把 webhook 送回本地"这个跟 Resend 完全同类的本地测试局限，处理方式也完全一致：自签事件验证代码逻辑，真正的"Stripe 主动送达"要等 Deploy Preview 才能验证）。
- `finance_readonly` 再次确认无法直接改订单、无法调用邮件重发接口——跟 RLS 审计轮的结论一致，没有因为后续两轮改动而回归。
- 三笔订单（付款退款 / 取消 / 过期）各自停在正确的终态，互不影响；最终库存账目对得上（付款后退款的那一单按政策不自动回库存，其余两单净变化为零）。

测试产生的所有订单、地址、`email_logs`、`refund_requests`、Supabase 测试账号（客户、admin、finance_readonly 各一个）全部清理，库存确认回到基线 50，`checkout_rate_limits` 测试噪音清空，心跳记录复位为 `null`。`storefront`/`admin-app` 的 `typecheck`/`test`/`build` 全部通过。

**结论：34/34 全部通过，没有发现回归。** 按用户的要求，本轮只做验证，不push、不改动任何产品代码，等待用户确认后再推送 `dev` 并生成 Deploy Preview。

## 2026-08-27（第十三轮）：push dev、创建 PR #1、Deploy Preview 验证、发现并修复 Node 版本致命问题、Resend Webhook 真实端到端验证

**PR 与 Deploy Preview**：`dev` 已推送到 GitHub（`https://github.com/MikeQih/TrinityGlobe`），创建了 `dev → main` 的 [PR #1](https://github.com/MikeQih/TrinityGlobe/pull/1)（标题"Pre-launch hardening: payments, GST, RLS and email tracking"），**没有合并、没有开自动合并**。PR 本身因为 `products.json` 有冲突显示"不能自动合并"——这个冲突**没有处理**，按用户要求留到真正准备合并的时候再说。Netlify 自动为这个 PR 生成了 Deploy Preview：`https://deploy-preview-1--trinity-globe.netlify.app`。

**这一轮发现的严重问题（不是邮件功能本身的问题，是能让整个后端瘫痪的部署阻塞项）**：用部署好的 Function 真实调用 `admin-resend-order-email` 时，返回的不是邮件相关错误，而是 `Error: Node.js detected but native WebSocket not found... Ensure you are running Node.js 22+`，报错栈精确指向 `getSupabaseAdmin()` 内部创建 Supabase 客户端时初始化 Realtime 客户端的那一步。**这不是这一轮新写代码的问题——`getSupabaseAdmin()` 是几乎每个 Netlify Function 的第一行代码**，所以真正部署后，`create-checkout-session`、`stripe-webhook`、`cancel-my-order`、`admin-refund-order` 等等全部会用同样的方式崩溃。之所以这么多轮本地测试完全没发现，是因为本地一直用 `netlify dev`，跑的是这台电脑自己装的 Node（22.22.1），从来没真正用过 Netlify 自己构建镜像里的 Node 版本。

按用户要求，没有直接在 `netlify.toml` 里笼统加 `NODE_VERSION` 了事，而是先核实了真实原因：查看这次 Deploy Preview 的完整构建日志，看到 `Attempting Node.js version '20' from .nvmrc`——**仓库根目录一直有一个 `.nvmrc` 文件写死了 `20`**，是最早那次"Add Phase 1 e-commerce scaffold"（`09f4936`）留下的，早于 `@supabase/supabase-js`（的 `realtime-js` 子依赖）和 `svix` 开始要求 Node 22 原生 WebSocket 之前。同一份构建日志里一大串 `npm warn EBADENGINE` 也印证了这一点：`@netlify/build`、`svix`、`netlify-cli` 等好几个包都写着 `required: {node: '>=22...'}` 但 `current: {node: 'v20.20.2'}`。查过 Netlify 后台的环境变量列表，确认之前**没有**任何 `NODE_VERSION`/`AWS_LAMBDA_JS_RUNTIME` 覆盖项——问题的唯一来源就是这个过时的 `.nvmrc`。

修复分两部分，都验证过真实生效，不是只看"构建成功"：
1. 把 `.nvmrc` 内容从 `20` 改成 `22`（commit `befb13c`，已 push），构建日志确认新一次构建变成 `Attempting Node.js version '22' from .nvmrc` → `Now using node v22.23.2`，之前那一长串 EBADENGINE 警告全部消失。
2. 额外在 Netlify 后台新增了 `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`，专门用"每个部署环境不同值"只设到 **Deploy Previews** 一个环境，Production 那一栏留空没有动。
3. 用真实调用重新验证：`.nvmrc` 改完后 Netlify 自动重新构建了一次 Deploy Preview，再手动 "Retry without cache" 了一次让新加的 `AWS_LAMBDA_JS_RUNTIME` 也生效，然后真实调用 `admin-resend-order-email`——WebSocket 报错完全消失，返回正常的 `{ok:true, outcome:"accepted"}`。

**这条留给上线前必须做的清单**：现在只确认了 Deploy Preview 环境正常，**合并 main 之前必须确认 Production 站点的 Functions 同样运行在 Node 22**——Production 目前既没有配 `.nvmrc`（会用仓库根目录那份，现在已经是 22 了，理论上没问题）也没有配 `AWS_LAMBDA_JS_RUNTIME`（目前只加在 Deploy Previews 一个环境），如果 Production 环境的 Lambda 运行时解析逻辑跟 Deploy Preview 不完全一样，需要单独用 Production 真实验证一次，不能想当然。

**Resend Webhook 真实端到端验证（不是自签模拟，是 Resend 真的把事件推过来）**：
- 在 Resend 后台创建了一个真实的 webhook endpoint，地址 `https://deploy-preview-1--trinity-globe.netlify.app/.netlify/functions/resend-webhook`，订阅了代码实际处理的全部六个事件。**Resend 后台这个功能本身没有"命名"这一栏**——webhook 只以 URL 标识，没法叫"Trinity Globe Deploy Preview #1"这样的自定义名字，这点如实告知，没有勉强凑一个。
- 真实 Signing Secret 复制后直接写入 Netlify 的 `RESEND_WEBHOOK_SECRET`，同样用"每个部署环境不同值"只设到 Deploy Previews，Production 的这一项保持不存在（没有覆盖，因为之前也不存在）。**密钥本身没有出现在本轮任何一次对话文本、截图描述或 commit 里**——唯一一次意外用截图工具截到了明文（Netlify 表单默认原样显示这个字段），当场发现后立刻点了隐藏按钮把这个字段切回 `type="password"` 掩码显示，后续所有操作都基于 JS 读取前缀/长度而不是完整值来做验证。
- 修完 Node 版本问题后，用真实 admin 测试账号通过部署好的 `admin-resend-order-email` 触发了 4 次真实发送（`delivered@resend.dev`/`bounced@resend.dev` 各自的客户确认信和员工通知信），Resend 后台的 Events 列表显示全部 8 个真实事件（4 个 `email.sent` + 3 个 `email.delivered` + 1 个 `email.bounced`）都标着 "Success"——**这是 Resend 真的把 webhook 推到了 `resend-webhook.ts`，签名验证真的通过了**。查数据库确认：投给 `delivered@resend.dev` 的客户确认信和员工通知信都自动从 `accepted` 推进到了 `delivered`；投给 `bounced@resend.dev` 的客户确认信自动推进到了 `bounced`，并且**真实提取出了 Resend 原话的退信原因**（"Permanent: The recipient's email provider sent a hard bounce message..."）——上一轮报告里"没拿到真实 payload 核对过 `data.bounce.message` 这个字段路径猜得对不对"这个疑问，这一轮用真实数据确认猜对了。同一笔订单的两种邮件类型（`customer_confirmation`/`staff_notification`）全程各自独立成行，`resend_email_id` 各不相同，互相没有覆盖。
- `finance_readonly` 测试账号对**部署好的**（不是本地）`admin-resend-order-email` 发起请求，确认依然被拒绝（403）。
- 全程确认订单的 `status`/`refunded_cents` 没有被这些邮件操作动过。
- 用真实浏览器登录一个真实创建的 admin 账号，打开退信那笔订单：客户确认信显示"Bounced"+完整退信原因+"Resend"按钮，员工通知信显示"Delivered"且**没有**重发按钮；订单列表页正确显示"⚠ Email"标记，且只标了这一笔（已送达的那笔没有被误标）。
- 去重（Svix `svix-id` 幂等）：在预先用自签事件重复投递的直接代码测试里已经确凿验证过（第一次正常处理、第二次返回 `deduped:true`，状态不重复不回退）。这一轮额外尝试了 Resend 后台自带的"Replay"按钮，点击后台面板上的 Attempts 计数和响应内容都没有变化，数据库里对应的去重记录、`email_logs.updated_at` 也都没有变化——不能百分之百确定 Resend 的 Replay 按钮这次是否真的重新发起了一次 HTTP 投递（这个 UI 交互本身没有给出明确的"已重放"反馈），但底层去重机制本身已经用更直接、无歧义的方式验证过，不依赖这个按钮的结果。

**测试数据清理**：本轮涉及的 2 个测试订单（含各自的 `email_logs`）、3 个测试账号（1 个 admin、1 个 finance_readonly、1 个专门用来看 admin-app 界面的）全部删除，`resend_webhook_events` 里本轮产生的记录清空，`inventory.website_stock` 确认回到基线 50（这几笔测试订单都是直接插入的 `paid` 状态，没有走真实预留流程，所以本来就不影响库存，之前顺手检查过一遍确认没有意外改动）。

**没有做的事，如实记录**：没有 merge PR，没有碰 `products.json` 的冲突，没有改任何 Stripe 相关配置（key、webhook 等一律没碰），没有把任何完整密钥写进代码、commit 或本文件。

**仍需人工确认的事项**：
1. **合并 main 之前必须单独验证 Production 环境的 Functions 也运行在 Node 22**——上面已经解释过原因，这一轮的验证范围只覆盖了 Deploy Preview。
2. Resend 后台这个 webhook endpoint **暂时保留着**（按用户要求没有删除），等这一轮 Deploy Preview 的其余回归项都做完、确认不再需要之后再决定是否清理；`RESEND_WEBHOOK_SECRET`/`AWS_LAMBDA_JS_RUNTIME` 这两个环境变量目前也还留在 Netlify 的 Deploy Preview 作用域里。
3. Resend 后台的 Webhooks 功能本身不支持自定义名称，如果确实需要用名字管理多个 endpoint，只能自己在别处（比如这份文档）另外记录 URL 对应关系。

## 2026-08-27（第十四轮）：安全解决 `products.json` 冲突，合并 main 进 dev

**冲突真正的原因**：`main` 上有一条自动化流水线（"Update Products 'product_list'" 这类 commit，从分叉点起一共 24 次）一直在同步真实商品资料，但这条流水线完全不知道 `dev` 这边给 `products.json` 加过 `sku`（结账/库存系统靠这个字段跟 Supabase 的 `product_variants`/`inventory` 关联）和 `caseSize`（阶梯定价用）这两个字段——`main` 上的 76 件商品**一个 `sku` 都没有**。逐字段比较（不是看 git 原始 diff，行级 diff 对 JSON 数组重排序的情况会误导，比如一度看起来"Gaulois XO 1L 被删了"，实际上只是数组顺序变了，商品还在）后确认：

- 72 件商品在两边都存在，`main` 对其中 18 件做了真实调价，其余字段没变——这部分直接采用 `main` 的新数据，同时把 `dev` 的 `sku`/`caseSize` 接回去，没有歧义。
- 4 件商品是 `main` 新增、`dev` 完全没有的：LOUIS XIII、Martell Noblige、HAKUSHU DISTILLER'S RESERVE 700ML 43%、Domaine Anne et Hervé Sigaut 2022 Chambolle-Musigny 1er Cru Les Sentiers Vieilles Vignes——这几个在 `products.json` 里加了字段并不会让结账系统认识它们，需要真的建 SKU。
- 1 件商品有歧义："Martell VSOP" 在 `main` 上变成小写的"Martell vsop"，换了新图、价格从 S$90/S$85 改成 S$100/S$95——已经跟用户确认过，这是同一款酒的资料更新，不是新商品。

**用户的决定**（已完整执行）：
- 新增 4 个 SKU：`WINE-SIGAUT-CHAMBOLLE-SENTIERS-2022`、`WHISKY-HAKUSHU-DISTILLERS-RESERVE-700ML`、`COGNAC-LOUIS-XIII`、`COGNAC-MARTELL-NOBLIGE`——先查过线上 `product_variants` 确认没有冲突，再通过新迁移 `supabase/migrations/0020_merge_main_catalog_updates.sql`（不是手动在 Supabase 后台加）建了对应的 `product_variants` 和 `inventory` 行，库存统一设成临时基线 50，跟其余所有 SKU 保持一致的"上线前必须重新盘点"警示。
- Martell VSOP：沿用原 SKU `COGNAC-MARTELL-VSOP`，数据库身份不变（历史订单不受影响），名称统一规范回`Martell VSOP`（改正大小写），采用 `main` 的新图片，价格更新为 S$100/S$95——同一条迁移里做的，不是新建商品。
- 同一条迁移里顺手把另外 18 件商品的真实调价也同步进了 `product_variants`——这一步不做的话会出现真正的价格事故：`products.json` 显示 `main` 的新价格，但 `create-checkout-session.ts` 实际收款用的 `product_variants.unit_price_cents` 还是旧价格，客户看到的价格和实际扣款的价格会对不上。

**合并结果**：`git merge origin/main` 到 `dev`，只有 `products.json` 一个文件冲突（其余都是 `main` 独有的新文件，自动合并），手动用上面确认好的内容解决冲突，`main` 新增的 4 张真实商品图片文件（`img_1918.webp`/`img_1920.jpeg`/`img_1910.jpeg`/`febedcf7-eda6-4c68-b276-d9b205b8654b.jpeg`）随合并自动带入——这几张图之前只存在于 `main`，`dev` 的 `images/` 目录里没有，如果不特意确认这一步，新商品的图片会直接 404。合并完成后确认：`git log dev..origin/main` 为空（`main` 的全部历史已经完整进了 `dev`），`products.json` 是合法 JSON，76 件商品全部有唯一 SKU、必填字段齐全、价格合理、图片文件真实存在，`categoryLabel` 只有两处大小写不一致（都是 `main` 新商品带进来的，`whisky`→`Whisky`、`Red wine`→`Red Wine`），已手动改正；`wine`/`baijiu` 品类原本就有多个 `categoryLabel`（红酒/白酒细分、汾酒/洋河子品牌），确认是 `dev` 本来就有的设计，不是这轮引入的问题。

`storefront`/`admin-app` 的 `typecheck`/`test`/`build` 合并后全部重新跑过，通过。

---

## 重要的操作纪律（继续遵守）

- **账号隔离**：Stripe/Supabase/Resend/Airwallex 全部用全新专属账号，不复用用户其他项目（如"Owo99" Stripe、"collabify"等Supabase项目、"miaotie.fun" Resend域名）的账号/密钥
- **密钥不落入我的可见输出**：拿到密钥后用剪贴板（`navigator.clipboard`）+ `pbpaste` 管道直接写入本地 `.env`，不在对话里回显
- **不擅自commit**：只有用户明确说"commit一下"才创建 git commit/push，不主动做
- **不替用户填身份/财务信息**：账号注册里的法定姓名、身份证件、KYC材料等必须用户/Wang Lei本人填，我只负责核对信息是否和Bizfile一致、给出该填什么建议
- **如实申报优先**：所有营收/行业/股权类申报字段，建议如实按实际情况填，不建议为了"好看"或"怕麻烦"少报/多报——过往在Stripe那边的经验是，申报和实际不符容易在后续审核触发风控冻结

---

## 下次打开新session，最该先做的事

**不依赖外部信息、现在就能继续做的**：
1. 老板反馈1：产品后台和订单后台加跳转入口（轻量方案，用户已选定）
2. **政策页面法律分工已经和用户对齐**（2026-08-26）：Terms & Conditions、Privacy Policy 这两份要发给老板找律师看（合同责任限制条款 + PDPA 都是真实法律/监管风险）；Delivery Policy、Refund Policy 剩下的占位符是业务事实（配送时效/范围/派送失败流程、退款窗口天数），用户自己填数字就行，不需要律师；Age Restriction 页建议搭 Terms 的顺风车让律师扫一眼年龄核实流程是否符合《酒类管制法》，不用单独立项。**这几份文件本身目前还没人去发给老板/律师**，只是分好了类。

**要等用户这边的**：
3. **Facebook 应用图标需要用户自己上传**（文件在 `/tmp/fb-icon/app-icon-1024.png`，机器重启/清理后可能已经不在，需要的话让我重新生成），传完才能提交 App Review
4. 问用户：查完 Meta Business Portfolio 状态后，Facebook App Review 要不要现在就正式提交申请
5. 问用户：Wang Lei 和 Shen Chuan 在 SC Prime Holdings Pte. Ltd. 里的持股比例，把 Airwallex 的 beneficial owner 列表补完整再继续
6. 请老板/会计确认公司的 **GST Registration Number**，以及 **IRAS 批准信中注明的 GST Registration Effective Date**（不是简单的"是否注册"——年营收已超S$1M，按 IRAS 规定已触发强制注册义务；拿到这两项后填进 `store_settings` 表即可，见下面 GST 章节，不需要再改代码）
7. 问用户：Terms/Privacy 页面各自的"内部草稿，还没过律师"提示块要不要也去掉（age-restriction 那条已经按要求删了，这两份目前还留着，见上面第二轮记录）
8. **用户已明确表示现在还没准备好，先不把 `dev` 合并到 `main`**——不要主动提起或推动这件事，等用户自己说要上线再做（合并前记得：a. 把 `dev` 分支上还没 commit 的这批改动先 commit；b. 决定 Stripe live key 要怎么切——见上面"Stripe 还在 test mode"条目里"按部署环境设不同值"的方案）

**已解决，不用再问**：
- ~~Wang Lei 的 Stripe 身份验证~~——2026-08-26 用户截图确认"已完成"任务里身份验证+账户代表信息/文件全部通过，"已激活"（待处理）已清空，阻塞解除
- ~~订单关联账号 + "我的订单"页面 + 导航栏登录状态~~——已完成并端到端测试验证过，老板反馈2的核心诉求已经打通
- ~~邮箱验证码 6 位 vs 8 位的疑问~~——已排查清楚并修复，真实 Resend 发信实测是 8 位
