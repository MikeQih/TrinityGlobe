// ── Product list ──
// To update prices or add products, edit this file only.
// Prices are in SGD. Set a value to null to hide that price tier.

const PRODUCTS = [

  // ── Cognac ──
  {
    name: "Hennessy VSOP",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Hennessy VSOP.png",
    prices: { bottle: 105, case: 1260, fiveCases: null }
  },
  {
    name: "Hennessy XO",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Hennessy XO.png",
    prices: { bottle: 235, case: 2820, fiveCases: null }
  },
  {
    name: "Hennessy Paradis",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Hennessy Paradis.png",
    prices: { bottle: 1350, case: 16200, fiveCases: null }
  },
  {
    name: "Martell VSOP",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Martell VSOP.png",
    prices: { bottle: 110, case: 1320, fiveCases: null }
  },
  {
    name: "Martell Cordon Bleu",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Martell Cordon Bleu.png",
    prices: { bottle: 230, case: 2760, fiveCases: null }
  },
  {
    name: "Martell XO",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Martell XO.png",
    prices: { bottle: 240, case: 2880, fiveCases: null }
  },
  {
    name: "Gaulois XO 1L",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Gaulois XO.png",
    prices: { bottle: 199, case: null, fiveCases: null }
  },
  {
    name: "GAVO XO 700ML",
    category: "cognac",
    categoryLabel: "Cognac",
    image: "干邑白兰地 - Gavo XO.png",
    prices: { bottle: 199, case: null, fiveCases: null }
  },

  // ── Whisky ──
  {
    name: "The Macallan 12",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 麦卡伦12年.png",
    prices: { bottle: 170, case: 2040, fiveCases: null }
  },
  {
    name: "The Macallan 15",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 麦卡伦15年.png",
    prices: { bottle: 235, case: null, fiveCases: null }
  },
  {
    name: "The Macallan 18",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 麦卡伦18年.png",
    prices: { bottle: 550, case: 3300, fiveCases: null }
  },
  {
    name: "The Macallan 25",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 麦卡伦25年.png",
    prices: { bottle: 3150, case: 9450, fiveCases: null }
  },
  {
    name: "The Macallan 30",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 麦卡伦30年.png",
    prices: { bottle: 7200, case: 21600, fiveCases: null }
  },
  {
    name: "Yamazaki 12",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 山崎12年.png",
    prices: { bottle: 290, case: 3480, fiveCases: null }
  },
  {
    name: "Yamazaki 18",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 山崎18年.png",
    prices: { bottle: 1500, case: 18000, fiveCases: null }
  },
  {
    name: "Hibiki Japanese Harmony",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 响和风.png",
    prices: { bottle: 240, case: 2880, fiveCases: null }
  },
  {
    name: "Hibiki 21",
    category: "whisky",
    categoryLabel: "Whisky",
    image: "威士忌 - 响21年.png",
    prices: { bottle: 1350, case: 16200, fiveCases: null }
  },

  // ── Champagne ──
  {
    name: "Dom Pérignon 2015",
    category: "champagne",
    categoryLabel: "Champagne",
    image: "香槟 - Dom Pérignon 2015.png",
    prices: { bottle: 270, case: 1620, fiveCases: null }
  },
  {
    name: "Dom Pérignon 2013",
    category: "champagne",
    categoryLabel: "Champagne",
    image: "香槟 - Dom Pérignon 2013.png",
    prices: { bottle: 285, case: null, fiveCases: null }
  },
  {
    name: "Louis Roederer Cristal 2014",
    category: "champagne",
    categoryLabel: "Champagne",
    image: "香槟 - Louis Roederer Cristal 2014.png",
    prices: { bottle: 485, case: null, fiveCases: null }
  },
  {
    name: "Perrier-Jouët",
    category: "champagne",
    categoryLabel: "Champagne",
    image: "香槟 - Perrier-Jouët.png",
    prices: { bottle: 155, case: 930, fiveCases: null }
  },

  // ── Wine ──
  {
    name: "Penfolds Bin 389",
    category: "wine",
    categoryLabel: "Red Wine",
    image: "红酒 - Penfolds Bin 389.png",
    prices: { bottle: 150, case: 900, fiveCases: null }
  },
  {
    name: "Penfolds Bin 407",
    category: "wine",
    categoryLabel: "Red Wine",
    image: "红酒 - Penfolds Bin 407.png",
    prices: { bottle: 190, case: 1140, fiveCases: null }
  },
  {
    name: "IT Extroso Appassimento Rosso",
    category: "wine",
    categoryLabel: "Red Wine",
    image: "红酒 - IT Extroso Appassimento.png",
    prices: { bottle: 60, case: null, fiveCases: null }
  },
  {
    name: "Sella & Mosca Monteoro 2020",
    category: "wine",
    categoryLabel: "White Wine",
    image: "白葡萄酒 - Sella & Mosca Monteoro 2020.png",
    prices: { bottle: 60, case: null, fiveCases: null }
  },

  // ── Sake ──
  {
    name: "Dassai 23 1.8L",
    category: "sake",
    categoryLabel: "Sake · 清酒",
    image: "清酒 - Dassai 23 1.8L.png",
    prices: { bottle: 230, case: null, fiveCases: null }
  },
  {
    name: "十四代 本丸 1.8L",
    category: "sake",
    categoryLabel: "Sake · 清酒",
    image: "清酒 - 十四代 本丸.png",
    prices: { bottle: 650, case: null, fiveCases: null }
  },
  {
    name: "十四代 中取 無濾過 純米 1.8L",
    category: "sake",
    categoryLabel: "Sake · 清酒",
    image: "清酒 - 十四代 中取 無濾過 純米.png",
    prices: { bottle: 670, case: null, fiveCases: null }
  },
  {
    name: "十四代 中取 純米吟醸 1.8L",
    category: "sake",
    categoryLabel: "Sake · 清酒",
    image: "清酒 - 十四代 中取 純米吟醸.png",
    prices: { bottle: 720, case: null, fiveCases: null }
  },
  {
    name: "十四代 中取 播州山田錦 1.8L",
    category: "sake",
    categoryLabel: "Sake · 清酒",
    image: "清酒 - 十四代 中取 播州山田錦.png",
    prices: { bottle: 770, case: null, fiveCases: null }
  },

  // ── Baijiu ──
  {
    name: "Moutai",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 飞天茅台.png",
    prices: { bottle: 380, case: 4560, fiveCases: null }
  },
  {
    name: "Wuliangye",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 五粮液.png",
    prices: { bottle: 240, case: 1440, fiveCases: null }
  },
  {
    name: "Guojiao 1573",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 国窖1573.png",
    prices: { bottle: 220, case: 1320, fiveCases: null }
  },
  {
    name: "泸州鉴藏 A8",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 泸州鉴藏A8.png",
    prices: { bottle: 129, case: null, fiveCases: null }
  },
  {
    name: "剑南春 东方红",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 剑南春东方红.png",
    prices: { bottle: 199, case: null, fiveCases: null }
  },
  {
    name: "剑南春 青铜纪",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 剑南春青铜纪.png",
    prices: { bottle: 399, case: null, fiveCases: null }
  },
  {
    name: "精品茅台",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 精品茅台.png",
    prices: { bottle: 599, case: null, fiveCases: null }
  },
  {
    name: "茅台 15年",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 茅台15年.png",
    prices: { bottle: 1399, case: null, fiveCases: null }
  },
  {
    name: "茅台 30年",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 茅台30年.png",
    prices: { bottle: 3399, case: null, fiveCases: null }
  },
  {
    name: "茅台 50年",
    category: "baijiu",
    categoryLabel: "Baijiu",
    image: "中国白酒 - 茅台50年.png",
    prices: { bottle: 5399, case: null, fiveCases: null }
  },

  // 汾酒系列
  {
    name: "汾酒 玻璃汾",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 玻璃汾.png",
    prices: { bottle: 62, case: null, fiveCases: null }
  },
  {
    name: "汾酒 10年",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 汾酒10.png",
    prices: { bottle: 90, case: null, fiveCases: null }
  },
  {
    name: "竹叶青 10年",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 竹叶青10.png",
    prices: { bottle: 130, case: null, fiveCases: null }
  },
  {
    name: "汾酒 巴拿马1915",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 巴拿马1915.png",
    prices: { bottle: 135, case: null, fiveCases: null }
  },
  {
    name: "汾酒 青花20度",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 青花20度.png",
    prices: { bottle: 145, case: null, fiveCases: null }
  },
  {
    name: "汾酒 青花30 (48% Vol)",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 青花30度.png",
    prices: { bottle: 170, case: null, fiveCases: null }
  },
  {
    name: "汾酒 陈酿30年",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 陈酿30年.png",
    prices: { bottle: 175, case: null, fiveCases: null }
  },
  {
    name: "汾酒 青花30 (53% Vol)",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 青花30度.png",
    prices: { bottle: 200, case: null, fiveCases: null }
  },
  {
    name: "汾酒 青花50度",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 青花50度.png",
    prices: { bottle: 205, case: null, fiveCases: null }
  },
  {
    name: "汾酒 复兴版青花30",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 复兴版青花30.png",
    prices: { bottle: 225, case: null, fiveCases: null }
  },
  {
    name: "玫瑰汾酒",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 玫瑰汾酒.png",
    prices: { bottle: 415, case: null, fiveCases: null }
  },
  {
    name: "竹叶青 限量版",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 竹叶青限量版.png",
    prices: { bottle: 425, case: null, fiveCases: null }
  },
  {
    name: "汾酒 丝绸之路",
    category: "baijiu",
    categoryLabel: "Baijiu · 汾酒",
    image: "中国白酒 - 汾酒 - 丝绸之路.png",
    prices: { bottle: 435, case: null, fiveCases: null }
  },

  // 洋河系列
  {
    name: "洋河 大曲新天蓝",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 大曲新天蓝.png",
    prices: { bottle: 40, case: null, fiveCases: null }
  },
  {
    name: "洋河 微分子 33.8%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 微分子 33.8度.png",
    prices: { bottle: 60, case: null, fiveCases: null }
  },
  {
    name: "洋河 天之蓝 42%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 天之蓝 42度.png",
    prices: { bottle: 77, case: null, fiveCases: null }
  },
  {
    name: "洋河 天之蓝 52%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 天之蓝 52度.png",
    prices: { bottle: 85, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝水晶版 40.8%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝水晶版 40.8度.png",
    prices: { bottle: 105, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝水晶版 52%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝水晶版 52度.png",
    prices: { bottle: 125, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝 M6+ 40.8%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝M6 40.8度.png",
    prices: { bottle: 140, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝 M6+ 52%",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝M6 52度.png",
    prices: { bottle: 160, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝 M9",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝M9.png",
    prices: { bottle: 285, case: null, fiveCases: null }
  },
  {
    name: "洋河 梦之蓝手工班",
    category: "baijiu",
    categoryLabel: "Baijiu · 洋河",
    image: "中国白酒 - 洋河 - 梦之蓝手工班.png",
    prices: { bottle: 335, case: null, fiveCases: null }
  },

  // ── Beer ──
  {
    name: "嗨啤精酿 拉格",
    category: "beer",
    categoryLabel: "Beer · 精酿",
    image: "啤酒 - Lager.png",
    prices: { bottle: 6, case: 120, fiveCases: null }
  },
  {
    name: "嗨啤精酿 小麦",
    category: "beer",
    categoryLabel: "Beer · 精酿",
    image: "啤酒 - 小麦啤.png",
    prices: { bottle: 6, case: 120, fiveCases: null }
  },

  // ── Vodka ──
  {
    name: "Blue Dash",
    category: "vodka",
    categoryLabel: "Vodka · Exclusive",
    image: "伏特加 - Blue Dash.png",
    prices: { bottle: 65, case: 780, fiveCases: null }
  },

  // ── Tequila ──
  {
    name: "Premium Tequila",
    category: "tequila",
    categoryLabel: "Tequila",
    image: "龙舌兰 - Premium Tequila.png",
    prices: { bottle: 78, case: 936, fiveCases: null }
  },
];
