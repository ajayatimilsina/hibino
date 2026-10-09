// Initial database content. Created once when data/db.json does not exist.
const M = (id, name, category, price, options = []) => ({
  id, name, category, price, soldOut: false, stock: 30, options,
});

// Nan swap options (same as the original shop menu).
const NAN_SWAP = [
  { name: 'チーズナンに変更', price: 330 },
  { name: 'ガーリックナンに変更', price: 110 },
  { name: 'ごまナンに変更', price: 110 },
  { name: 'チョコナンに変更', price: 220 },
  { name: 'ハニーナンに変更', price: 110 },
  { name: 'ハニーチーズナンに変更', price: 440 },
];

export function seedDb() {
  return {
    settings: {
      shopName: 'あじまる屋',
      pin: '1234', // override with env STAFF_PIN
      tableCount: 10,
      lowStockThreshold: 5,
      taxRate: 10,
      categoryOrder: ['ナンセット', 'ナン単品', 'サブメニュー', 'ドリンク'],
      // ESC/POS network printers, "host:port" (empty = disabled)
      printers: { kitchen: '', receipt: '' },
    },
    menu: [
      M(80, 'チーズナンセット', 'ナンセット', 1045),
      M(81, 'バターチキンセット', 'ナンセット', 990, NAN_SWAP),
      M(82, 'ほうれん草セット', 'ナンセット', 990, NAN_SWAP),
      M(83, 'サントリー生ビールとチキンティッカ（2個）', 'サブメニュー', 800),
      M(84, 'プレーンナン', 'ナン単品', 300),
      M(85, 'チーズナン', 'ナン単品', 660),
      M(86, 'ガーリックナン', 'ナン単品', 440),
      M(87, 'ごまナン', 'ナン単品', 440),
      M(88, 'チョコナン', 'ナン単品', 550),
      M(89, 'ハニーナン', 'ナン単品', 440),
      M(90, 'ハニーチーズナン', 'ナン単品', 770),
      M(91, '味まる屋スペシャルセット', 'ナンセット', 1980),
      M(92, 'チキンティッカ 2個', 'サブメニュー', 330),
      M(93, 'チキンティッカ 5個', 'サブメニュー', 660),
      M(94, 'チキンチリ', 'サブメニュー', 990),
      M(95, 'タンドリーチキン', 'サブメニュー', 450),
      M(96, 'タンドリーチキン', 'サブメニュー', 800),
      M(97, 'ラッシー', 'ドリンク', 330),
      M(98, 'マンゴーラッシー', 'ドリンク', 440),
    ],
    // tables[n] = { call: ts|null, notice: {type, orderId, timestamp}|null, receipt: {needed, name} }
    tables: {},
    orders: [],
    sales: [],
    stockLog: [],
    stocktakes: [],
    finance: [
      { id: 1, date: new Date().toISOString().slice(0, 10), type: 'expense', category: '仕入れ', amount: 12000, memo: 'サンプル: 小麦粉・鶏肉' },
      { id: 2, date: new Date().toISOString().slice(0, 10), type: 'labor', category: 'アルバイト', amount: 9000, memo: 'サンプル' },
    ],
    counters: { order: 1, line: 1, sale: 1, log: 1, take: 1, fin: 3 },
  };
}
