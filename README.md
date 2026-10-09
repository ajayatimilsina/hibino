# あじまる屋 QR注文 / POS システム

Node.js + Express + WebSocket + JSON ファイル保存。HTML5 / Bootstrap 5 / Vanilla JS (ES modules)。

**構成の選択理由**: Firebase はアカウント・課金・ネット接続が必須。店内LAN上の1台のPCで動くNode.jsなら、
外部サービス不要・ネイティブビルド不要（SQLiteを使わずJSONファイル）・ESC/POS直接印刷も同じサーバーで可能。

## フォルダ構成

```
hihinoji/
├─ package.json
├─ server/
│  ├─ index.js     API / WebSocket / 認証 / 在庫 / 会計
│  ├─ store.js     data/db.json の読み書き
│  ├─ seed.js      初期メニュー（ID 80-98）と設定
│  └─ escpos.js    ESC/POS (TCP 9100) 印刷
├─ data/db.json    初回起動で自動生成
└─ public/
   ├─ index.html   お客様画面  (?table=3)
   ├─ kds.html     キッチン
   ├─ pos.html     レジ / 日次集計
   ├─ menu.html    メニュー管理
   ├─ inventory.html 棚卸
   ├─ finance.html 収支
   ├─ qr.html      テーブルQR生成
   ├─ css/ common.css, print.css
   └─ js/  api.js util.js print.js customer.js kds.js pos.js menu.js inventory.js finance.js
```

## DBスキーマ (data/db.json)

```json
{
  "settings": { "shopName": "あじまる屋", "pin": "1234", "tableCount": 10, "lowStockThreshold": 5,
                "taxRate": 10, "categoryOrder": ["ナンセット","ナン単品","サブメニュー","ドリンク"],
                "printers": { "kitchen": "192.168.1.50:9100", "receipt": "192.168.1.51:9100" } },
  "menu": [ { "id": 81, "name": "バターチキンセット", "category": "ナンセット", "price": 990,
              "soldOut": false, "stock": 30, "options": [ { "name": "チーズナンに変更", "price": 330 } ] } ],
  "tables": { "3": { "call": 1760000000000,
                     "notice": { "type": "pickup", "orderId": 12, "timestamp": 1760000000000 },
                     "receipt": { "needed": true, "name": "株式会社サンプル" } } },
  "orders": [ { "id": 12, "table": 3, "createdAt": 1760000000000, "note": "辛さ控えめ", "printed": true, "paid": false,
                "receipt": { "needed": true, "name": "株式会社サンプル" },
                "items": [ { "lineId": 30, "itemId": 81, "name": "バターチキンセット", "qty": 1, "unitPrice": 990,
                             "options": [ { "name": "チーズナンに変更", "price": 330 } ],
                             "status": "new | cooking | ready | served" } ] } ],
  "sales": [ { "id": 1, "closedAt": 1760000000000, "date": "2026-10-09", "table": 3, "orderIds": [12],
               "lines": [ { "name": "...", "qty": 1, "unit": 990, "options": [], "amount": 1320 } ],
               "subtotal": 1320, "discountType": "percent", "discountValue": 10, "discountAmount": 132,
               "total": 1188, "method": "cash | card | paypay", "receipt": { "needed": true, "name": "..." } } ],
  "stockLog": [ { "id": 1, "ts": 0, "itemId": 81, "type": "order | stocktake | adjust", "before": 30, "after": 29 } ],
  "stocktakes": [ { "id": 1, "ts": 0, "itemId": 81, "system": 29, "actual": 27, "diff": -2 } ],
  "finance": [ { "id": 1, "date": "2026-10-09", "type": "expense | labor | other", "category": "仕入れ", "amount": 12000, "memo": "" } ]
}
```

通知は `tables[n].notice`（`pickup` = 取りに来てください / `thanks` = 会計完了）。お客様画面が監視し、「受け取りました」でクリアします。

## セットアップ

```powershell
cd hihinoji
npm install
$env:STAFF_PIN = "好きなPIN"     # 未設定なら 1234（必ず変更）
npm start                         # http://localhost:3000
```

- スタッフ画面（`kds / pos / menu / inventory / finance`）は初回にPIN入力（API側でも検証）。お客様画面は公開。
- データをリセット: `data/db.json` を削除して再起動。
- PINの試行は1分間に5回まで。

### ホスティング
- **店内LAN（推奨）**: 店のPCでサーバーを起動し、固定IP（例 `192.168.1.10`）を割り当て。客のスマホは店内Wi-Fi接続が必要。
- **外部公開（客が自分の回線で注文）**: VPS等で動かし、Caddy / nginx でHTTPS化（WebSocketの `/ws` も転送）。
  公開時はPIN変更、`/api/s` 以外の公開APIへの追加の不正対策（Cloudflare等）を推奨。
- Bootstrap / QR ライブラリはCDN読込。完全オフラインにする場合は `public/vendor/` に配置して `<link>/<script>` を差し替え。

### テーブルQRコード
`http://サーバー/qr.html` を開き、店舗URL（例 `http://192.168.1.10:3000`）とテーブル数を入力 → 印刷。
各QRは `…/index.html?table=番号` を指します。

### プリンタ設定
**A. ブラウザ印刷（標準）** — キッチン端末とレジ端末のChromeを「サイレント印刷」で起動:
```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://192.168.1.10:3000/kds.html
```
1. Windowsの既定プリンタを、その端末で使う感熱プリンタ（キッチン用 / レシート用）に設定。
2. 画面右上の紙幅（80mm / 58mm）を選択。`@media print` と `@page` が自動で切り替わります。
3. KDSは新規注文ごとに自動印刷（**1品1枚**、価格なし）。複数のKDSがあっても注文ごとに1回だけ印刷されます。
4. 余白は「なし」、拡大縮小100%のドライバ設定を推奨。

**B. ESC/POS 直接印刷（任意）** — ネットワーク対応の感熱プリンタ（Epson互換、ポート9100）:
1. `data/db.json` の `settings.printers.kitchen / receipt` に `"IP:9100"` を設定して再起動。
2. KDS / レジ画面の印刷方式を「ESC/POS」に切り替え。
3. 漢字モードはEpson互換（`FS &`, Shift_JIS）。Star等は `server/escpos.js` の初期化コマンドを調整。

## 画面の使い方（要点）
- **お客様**: カテゴリタブ → 商品タップ → オプション選択 → 追加 → 注文。欠品はグレーで注文不可。
  「店員を呼ぶ」でレジに通知。キッチンが「📣 カウンターへ取りに来てください」を押すと大きな緑のバナー（振動・音）。
  ページ末尾の「領収書が必要ですか？」で宛名を保存（レジ画面・領収書に反映）。
- **KDS**: 初回に「🔊 音声を有効にする」を押す（ブラウザ制限）。新規注文で効果音・点滅・音声。
  上部「いらっしゃいませ / ありがとうございました」で店内アナウンス（チェックでお客様画面にも表示）。
- **レジ**: テーブル一覧と合計、呼び出しアラート、会計（現金 / PayPay / クレジット、割引 ¥/%）、レシート自動印刷
  （領収書希望なら宛名入り領収書も）。「日次集計」「会計履歴」タブあり。
- **在庫**: 注文ごとに自動減算、0で自動欠品、5未満で「残りわずか」。棚卸で実数入力→差異表示→確定。
- **収支**: 売上は会計から自動集計。経費・人件費・その他を入力し、日次/月次の損益グラフとCSV出力。

## 前提・補足
- シード全品目に `stock: 30` を設定。バターチキン/ほうれん草セットには元サイトと同じ「ナン変更」オプションを追加（他は `options: []`）。
- 83〜98など同名の「タンドリーチキン」(ID 95/96) はシードのまま。必要ならメニュー管理で名称を変更してください。
- 「PACHIKO」は日次集計と解釈。

# hibino
