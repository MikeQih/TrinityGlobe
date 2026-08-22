# Trinity Globe 商城项目 — 当前状态清单

> 用途：新开 session 时把这份文件读一遍就能接着做。会随进展更新，别当成一次性交接文档。
> 最后更新：2026-08-22

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

### Stripe —— 阻塞中，等 Wang Lei 完成身份验证
- 账户：`acct_1U66mYBAev1issbv`，商户类目已选"含酒精饮品"零售
- 状态：审核中有 2 个逾期任务，**需要 Wang Lei 本人**（占股30%、实际操作人，非 Bizfile 登记董事）通过 Singpass 或人工上传证件完成身份核验 + 补充授权文件
- 已在 `.env` 配了 test mode 的 `STRIPE_SECRET_KEY`（sk_test_），代码已验证可用
- **下一步**：确认 Wang Lei 是否已通过已打开的 Singpash tab 完成验证 → 去 `https://dashboard.stripe.com/acct_1U66mYBAev1issbv/account/status` 确认"支付"状态从"即将暂停"变回"活跃"
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

## 尚未开始（部署相关）

- [ ] 把已写好的购物车/结账代码**部署到真正的生产 Netlify 站点**（目前只在本地 `netlify dev` 测试过）——需要合并 `dev` 到 `main`，或先给 `dev` 建分支预览
- [ ] Stripe webhook 指向生产环境公网 URL，拿到 `STRIPE_WEBHOOK_SECRET`，本地和 Netlify 后台都要配
- [x] Netlify（storefront `trinity-globe` 站点）生产环境变量已配置（`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`STRIPE_SECRET_KEY`(还是sk_test_)/`RESEND_API_KEY`/`RESEND_FROM_EMAIL`/`STAFF_NOTIFICATION_EMAILS`/`FREE_SHIPPING_THRESHOLD_CENTS`/`STANDARD_SHIPPING_FEE_CENTS`/`SITE_URL`），`STRIPE_WEBHOOK_SECRET`/`ADMIN_APP_ORIGIN` 还是空的
- [x] `admin-app/` **已部署上线**：`https://trinity-globe-admin.netlify.app`（独立 Netlify 站点，见上面第四轮记录）。`ADMIN_APP_ORIGIN` 也已经配到 storefront（`trinity-globe`）项目的环境变量里了，值就是这个正式地址
- [x] 在 Supabase Auth 建了第一个管理员账号（`qihengchang1014@gmail.com`，role: admin），密码还没设置，等用户自己点链接设置
- [ ] 库存：目前所有72个SKU都是**占位库存20**（用户已明确说"先放着，后续再调整"），真实上线前要换成真实库存数
- [ ] 政策页面（`policies/*.html`）法律审阅：目前 UEN、运费(S$15)、免运费门槛(S$120)、自提地址（11-03 The Suites Central, 57A Devonshire Road, S239897）、自提时间（24小时）已确认写死；配送时效/配送范围/派送失败处理流程仍是占位符，等业务决定；用户说"后续会找人过"法律
- [ ] GST：数据库 `store_settings.gst_registered` 目前是 **false（占位）**。**这次对话发现一个重要合规提醒**：公司年营收已超S$1M，按新加坡IRAS规定这已经触发强制注册GST的义务（超门槛后30天内需注册），**需要尽快跟老板/会计确认公司是否已经注册GST**，这直接影响网站价格是否要显示含税、以及是否已经存在合规风险

---

## 2026-08-20（第五轮）：登录页"点了没反应"的真实bug

用户设置完密码、第一次通过邀请链接能正常进后台看到订单列表（订单数据也确认是真实的，跟这次session之前创建的测试订单对得上）。但 Sign out 之后再用邮箱+密码在普通登录页登录，点 Sign in 没反应。

用户截图里的浏览器 Network 面板帮了大忙：`token?grant_type=password` 和 `admin_profiles?select=role...` 都返回 200，说明**账号密码是对的、登录请求本身成功了**。真正的问题是**代码bug**：`Login.tsx` 里 `signInWithPassword` 成功后，没有任何代码告诉页面"该跳转去订单页了"——`AuthContext` 内部状态确实更新了，但 `/login` 这个路由本身没有监听这个状态变化去跳转，所以停在原地，看起来像卡死。（第一次能进去是因为走的是"设置密码"页面，那个页面代码里专门写了`navigate("/orders")`，普通登录页少了这一步。）

**已修复**：
- `Login.tsx`：登录成功后显式调用 `navigate("/orders", { replace: true })`
- `App.tsx`：新增 `LoginRoute` 包装组件，如果已经有session了还停在 `/login`（比如浏览器后退），也会自动跳到 `/orders`，双重保险

已过 typecheck。**这个改动还没 commit/push**——需要推送到 `dev` 分支、Netlify 重新构建后，`https://trinity-globe-admin.netlify.app` 上才会生效。

---

## 2026-08-22：Google 登录接入（老板反馈2的第一步）

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

**这次改动还没 commit**——按惯例等用户确认后再提交。

**接下来（没做的部分，按之前的范围讨论，这次先只做"登录接入"这一步）**：
- Netlify 后台（`trinity-globe` 生产站点）的环境变量列表里**还没加** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`——本地能跑，但如果现在把 `dev` 合并上线，正式站点上 Google 登录按钮会因为读不到这两个变量而静默不可用（访客结账不受影响，只是登录选项会消失）。等要正式部署这块功能时记得把这两个变量也导进去。
- 导航栏目前**没有**加"已登录/账号"入口——只有在结账流程里才会看到登录状态。因为"我的订单"页面、订单跟账号关联的数据库改动都还没做，先不加一个没有实际去处的导航按钮。
- 数据库层面 `orders` 表**还没有**关联到 Supabase Auth 的 `user_id`——现在即使用 Google 登录了，下单时订单也不会自动跟这个账号绑定，老板反馈里"想回头能查看订单"这个核心诉求还没真正解决，只是登录本身能用了。这是下一步的核心工作。
- 还没建"我的订单"这个客户可见的页面。
- 老板反馈1（"上产品的后台和订单的后台能结合"）—— 用户选的是"两边互相加个跳转入口"这个轻量方案，还没做。

## 重要的操作纪律（继续遵守）

- **账号隔离**：Stripe/Supabase/Resend/Airwallex 全部用全新专属账号，不复用用户其他项目（如"Owo99" Stripe、"collabify"等Supabase项目、"miaotie.fun" Resend域名）的账号/密钥
- **密钥不落入我的可见输出**：拿到密钥后用剪贴板（`navigator.clipboard`）+ `pbpaste` 管道直接写入本地 `.env`，不在对话里回显
- **不擅自commit**：只有用户明确说"commit一下"才创建 git commit/push，不主动做
- **不替用户填身份/财务信息**：账号注册里的法定姓名、身份证件、KYC材料等必须用户/Wang Lei本人填，我只负责核对信息是否和Bizfile一致、给出该填什么建议
- **如实申报优先**：所有营收/行业/股权类申报字段，建议如实按实际情况填，不建议为了"好看"或"怕麻烦"少报/多报——过往在Stripe那边的经验是，申报和实际不符容易在后续审核触发风控冻结

---

## 下次打开新session，最该先做的事

**不依赖外部信息、现在就能继续做的**：
1. Google 登录接入的后续步骤（见上面 2026-08-22 那节"接下来"）——订单关联账号的数据库改动 + "我的订单"页面，是老板反馈2真正落地的核心，登录本身只是第一步
2. 老板反馈1：产品后台和订单后台加跳转入口（轻量方案，用户已选定）
3. 问用户：这次新加的 Google 登录代码要不要 commit

**要等用户这边的**：
4. 问用户：Wang Lei 和 Shen Chuan 在 SC Prime Holdings Pte. Ltd. 里的持股比例，把 Airwallex 的 beneficial owner 列表补完整再继续
5. 追问：Wang Lei 的 Stripe 身份验证走到哪了，能不能确认支付功能状态恢复"活跃"
6. 提醒老板确认公司是否已注册 GST（年营收已超S$1M）
7. 如果用户想正式上线购物车功能，需要用户明确决定"要不要把 dev 分支合并到 main"——这个不要自己主动做（合并前记得把 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 也加进 Netlify 生产环境变量）
