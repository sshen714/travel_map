# 東京慢遊 · TOKYO FIELD NOTES

東京＋鎌倉五天四夜獨旅行程地圖。Vue 3、TypeScript、Pinia、MapLibre GL JS，純前端靜態網站。

## 本機啟動

需要 Node.js 22.12 以上。

```sh
npm ci
npm run dev
```

開啟終端機顯示的 localhost 網址。旅程日期為 2027/1/8–1/12，往返星宇航空航班與 APA Hotel Ueno Inaricho Ekikita 住宿位置已確認；部分餐廳分店與其餘行程仍保留為暫定或可選。

## 第一版功能

- 五日總覽、每日時間軸、全螢幕地圖，使用 Hash 路由支援重新整理。
- 切換每日行程、淡化其他日期、地圖自動聚焦。
- 道路／自製簡化底圖，保留視角與選取狀態。
- 景點、餐廳、住宿、機場、車站、購物、街區與交通圖層篩選。
- 地圖右側提供地鐵路線快速按鈕，可直接顯示或隱藏本次行程使用的東京地鐵路線。
- 時間軸與地圖雙向選取，重複造訪同一地點以 Stop ID 區分。
- 手機底部行程抽屜、可收合圖層、地點詳細資訊與 Google Maps 參考位置連結。
- 已確認的住宿會顯示在地圖上；尚無座標的候選餐廳仍保留在行程中。
- 網路／WebGL 錯誤提示，不影響閱讀行程清單。

## 調整行程

資料統一經過 `src/services/tripRepository.ts` 載入，不需要編輯 Vue 元件。

| 檔案                           | 內容                                   |
| ------------------------------ | -------------------------------------- |
| `src/data/trip.json`           | 旅程標題、日期、預設視角與提醒         |
| `src/data/days.json`           | 日期顏色、摘要、停留點與交通引用       |
| `src/data/places.json`         | 唯一地點、分類、經緯度、狀態、備註     |
| `src/data/stops.json`          | 每日造訪順序、選填時間、停留時間與狀態 |
| `src/data/route-segments.json` | 交通方式、線名、圖層、起終點、幾何引用 |
| `src/data/lodgings.json`       | 已確認住宿、入住與退房日期             |
| `src/data/geo/*.geojson`       | 各日交通示意線                         |

新增停留點：新增或重用 Place → 建立 Stop → 加入該 Day 的 `stopIds` → 更新 Place 的 `dayIds`。同一地點可以一天造訪多次，請建立不同 Stop ID。時間軸依 `order` 排序。

狀態：`confirmed` 已確定、`tentative` 暫定、`optional` 可選、`cancelled` 已取消。取消項目在時間軸保留記錄，地圖隱藏。Place 狀態控制地點標記；Stop 狀態描述單次造訪。確認地點需有座標，座標順序為 `[經度, 緯度]`。填入住宿座標後，同步更新對應 Place 和 Lodging 的狀態。

`RouteSegment.geometryId` 對應 GeoJSON 的 `properties.id`。新增或修改交通線時，保持幾何起終點與 Place 座標一致。`npm run validate` 會檢查引用、ID、日期、順序與座標。

## 資料界線

目前根據 `architecture.md` 和根目錄的 `東京獨旅.pdf` 建立（架構提及的 DOCX 並未存在）。住宿地址與座標已依飯店官方資料更新；其他景點座標為近似規劃位置。交通 GeoJSON 是起終點示意線，**不是實際鐵路軌跡、步行路線或即時導航**。時間若有填寫亦為參考，不含班次、票價、營業時間保證。

去程為 2027/1/8 星宇航空 JX802（TPE 10:10 → NRT 14:20）；回程為 2027/1/12 星宇航空 JX803（NRT 15:40 → TPE 18:45）。往返機場已確定為成田，住宿為 APA Hotel Ueno Inaricho Ekikita。餐廳店名／分店不一致時以 null 座標與備註呈現，不猜測地址。Day 5 先到成田市區，使用京成本線方案；Skyliner 不停靠京成成田站。請依實際航廈和航空公司要求預留報到時間。

## 底圖

預設使用 [OpenFreeMap](https://openfreemap.org/) 的 Liberty / Positron 樣式。簡化模式使用白色系底圖、淡藍水域，並移除次要 POI／建築，與道路模式共用真實經緯度及行程資料。來源與歸屬標示保留於地圖右下角。

此服務提供免 Key 公共底圖；目前沒有 SLA，需連網。可以複製 `.env.example` 為 `.env` 並替換樣式 URL。所有 `VITE_*` 變數都會公開於瀏覽器，不能放入私人金鑰。字型使用系統中文字型，無須向外部字型服務發出請求。離線快取、網頁編輯器與即時導航不在第一版範圍。

## 驗證與建置

```sh
npm run validate
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run preview
```

單元測試驗證錯誤資料會被拒絕；Playwright 測試桌面與手機尺寸，含日期切換、重新整理、地點同步、候選過濾與底圖失敗。自動化測試使用固定空白底圖以排除外部網路波動，實際底圖另以 `LIVE_MAP=1 npm run test:e2e -- live-map.spec.ts` 檢查；預設測試略過這兩項需外網的測試。若使用本機已安裝的 Chrome，可加上 `PLAYWRIGHT_CHANNEL=chrome`。

## GitHub Pages

已附 `.github/workflows/deploy.yml`，在 `main` 推送時執行資料驗證、型別檢查、單元與瀏覽器測試，然後建置部署；PR 僅驗證和建置。

1. 將程式碼推送到 GitHub。
2. Repository Settings → Pages → Source 選擇 **GitHub Actions**。
3. 執行工作流程，網址預期為 `https://sshen714.github.io/travel_map/`。

本機模擬子路徑：

```sh
VITE_BASE_PATH=/travel_map/ npm run build
VITE_BASE_PATH=/travel_map/ npm run preview
```

開啟 `/travel_map/#/day/3`。工作流程會根據 repository 名稱設定 base；若使用自訂網域或 `<user>.github.io` 根目錄網站，請改成 `/`。
