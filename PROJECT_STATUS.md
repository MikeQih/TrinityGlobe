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

**这次改动（Netlify 分支预览、`netlify.toml` 密钥扫描修复、Facebook 资料、Resend SMTP + OTP 模板、`customer_profiles` 迁移、完整注册/登录/验证码 UI、订单关联账号 + 我的订单页面 + 导航栏登录状态）还没 commit**——按惯例等用户确认后再提交。`supabase/migrations/0004_customer_profiles.sql`、`0005_orders_customer_link.sql`、Resend SMTP 配置、Supabase 邮件模板、Facebook 后台设置这几项是**线上配置改动，不在 git 里**，但已经在真实项目里生效了，不需要额外部署步骤。

**接下来（没做的部分）**：
- **Facebook 应用图标还没传**——需要用户自己把 `/tmp/fb-icon/app-icon-1024.png` 拖进 Facebook 后台的应用图标框（这台机器上的临时文件，可能已经不在了，需要的话可以重新生成）。
- **Facebook App Review 正式提交还没做**——图标传完之后才能提交，且提交本身可能还需要写权限用途说明、录屏等材料。
- **Facebook Business Portfolio（公司验证）状态未知**——用户点开的验证页面要求先有一个 Meta Business Portfolio，用户不确定公司是否已经注册过，需要自己去 business.facebook.com 查一下，我不该替用户猜/填这种企业身份信息。
- Netlify 后台（`trinity-globe` 生产站点）的环境变量列表里**还没加** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`——本地能跑，但如果现在把 `dev` 合并上线，正式站点上 Google/Facebook/邮箱登录会因为读不到这两个变量而静默不可用（访客结账不受影响，只是登录选项会消失）。
- 邮箱注册验证码的**实际位数还没最终确认**——用 `admin.generateLink` 测试时观察到返回的是 8 位数字，但 UI 输入框目前限制的是 6 位（`maxlength="6"`）。真实 Resend 邮件里发的验证码之前只测过"输错会被拒绝"，没有专门数过位数。如果真实发信也是 8 位，现在的输入框会截断用户输入导致永远验证失败——**这个需要找时间用真实邮箱注册走一遍，数清楚验证码实际有几位**。
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
1. **订单关联账号 + "我的订单"页面 + 导航栏登录状态——已完成**（`orders.user_id`、`get-my-orders.ts`、`orders.html`、`#navAccount`，已用真实端到端测试验证过），老板反馈2的核心诉求已经打通
2. 老板反馈1：产品后台和订单后台加跳转入口（轻量方案，用户已选定）
3. 数清楚邮箱注册验证码到底是 6 位还是 8 位（见上面"接下来"那条），确认后视情况调整 `maxlength`
4. 问用户：这次新加的代码（Netlify 分支预览、Facebook 资料、Resend SMTP、`customer_profiles`、注册/登录/验证码 UI、订单关联账号 + 我的订单页面）要不要 commit

**要等用户这边的**：
5. **Facebook 应用图标需要用户自己上传**（文件在 `/tmp/fb-icon/app-icon-1024.png`，机器重启/清理后可能已经不在，需要的话让我重新生成），传完才能提交 App Review
6. 问用户：查完 Meta Business Portfolio 状态后，Facebook App Review 要不要现在就正式提交申请
7. 问用户：Wang Lei 和 Shen Chuan 在 SC Prime Holdings Pte. Ltd. 里的持股比例，把 Airwallex 的 beneficial owner 列表补完整再继续
8. 追问：Wang Lei 的 Stripe 身份验证走到哪了，能不能确认支付功能状态恢复"活跃"
9. 提醒老板确认公司是否已注册 GST（年营收已超S$1M）
10. 如果用户想正式上线购物车功能，需要用户明确决定"要不要把 dev 分支合并到 main"——这个不要自己主动做（合并前记得把 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 也加进 Netlify 生产环境变量）
