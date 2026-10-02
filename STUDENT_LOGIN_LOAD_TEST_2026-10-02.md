# 300 位學生登入及查詢負載測試 — 2026-10-02

目前版本尚不適合讓 300 位學生在同一瞬間首次登入。四種本機情境均只有 40/300 人首次登入成功；只對明確 503 忙碌回應等待 2 秒重試一次後，各再成功 40 人。成功登入者皆能查詢自己的結果，未發現跨學生資料或重複 Session Cookie。

## 測試範圍

- 受測應用程式版本：849f5cc。未調整正式程式的佇列、限流或密碼驗證參數。
- 300 個不同的合成學號、300 件已抽完的專題、同一共用密碼；每位學生各自登入並立即查詢。
- 每位學生先建立獨立 keep-alive 連線，然後一次送出 300 筆登入。這避免本機瞬間建立 300 條連線的 SYN backlog 干擾；模擬的是學生已開啟頁面後一起按登入，未模擬頁面下載或瀏覽器渲染。
- Node 的所有請求來自同一 loopback IP；Workers 所有請求使用相同來源，並傳送相同 CF-Connecting-IP。
- 共用密碼驗證快取起始為空；使用真正的 scrypt、API、Session 簽章及限流程式。
- Supabase 由本機 HTTP 模擬服務取代，每次資料庫請求分別注入 30 或 100 ms 延遲。資料在記憶體內依學號／專題 ID 查找；沒有 PostgreSQL 執行成本或真正 Supabase 網路延遲。
- Workers 使用本機 Wrangler 4.145.0（256 個 API Durable Object 分片），Node v24.19.0。相同主機上的隔離環境，並非校園網路或正式雲端環境。

## 首次登入

| 環境 | 每次模擬資料庫延遲 | 成功 | 503 忙碌 | 非 JSON 500 | 成功登入 P95 | 結果查詢 P95（含一次重試的成功者） |
|---|---|---|---|---|---|---|
| Node | 30 ms | 40/300（13.3%） | 260 | 0 | 674 ms | 37 ms |
| Node | 100 ms | 40/300（13.3%） | 260 | 0 | 1773 ms | 115 ms |
| Workers | 30 ms | 40/300（13.3%） | 153 | 107 | 1286 ms | 106 ms |
| Workers | 100 ms | 40/300（13.3%） | 133 | 127 | 2141 ms | 134 ms |

P95 指 95% 的該類請求於此時間內完成。登入延遲僅計成功者；大量快速失敗不能視為效能良好。

Node 的首次失敗均為有中文 JSON 與 Retry-After 的 503。Workers 的 500 回應內容為 `Error: Network connection lost.`，本機日誌定位到 ProxyWorker 轉發失敗；本次無法證明正式環境也會出現相同錯誤，亦不能將它當成已解決。Workers 30 ms 情境的前一次重跑為成功 40、503 共 125、500 共 135，重跑仍成功 40，但 500 數量會波動。

## 明確忙碌後重試一次

只重試收到 JSON 503 的學生，依 Retry-After 等待至少 2 秒。500／連線錯誤未自動重試；沒有無限重試或避開限流。

| 環境／延遲 | 重試人數 | 新增登入成功 | 最後成功登入並查詢 | 兩輪完成時間 |
|---|---|---|---|---|
| Node／30 ms | 260 | 40 | 80/300（26.7%） | 3277 ms |
| Node／100 ms | 260 | 40 | 80/300（26.7%） | 5616 ms |
| Workers／30 ms | 153 | 40 | 80/300（26.7%） | 4223 ms |
| Workers／100 ms | 133 | 40 | 80/300（26.7%） | 6212 ms |

每個情境最後都有 80 個不同 Session Cookie、80 筆成功查詢、0 筆查到別人資料，仍有 220 人未完成登入。此結果不是 300 人壓測通過。

## 模擬資料庫請求量

每個情境合計 320 筆資料庫 HTTP 請求：學號查找 80、最新密碼版本查核 80、Session 寫入 80、結果查詢 RPC 80。最高同時處理 16 筆；30 ms 情境最高 160 請求/秒，100 ms 情境最高 112 請求/秒。沒有讀取完整名冊。

這只量測模擬 HTTP 服務的請求量、延遲與併發，不能推算正式 Supabase 的 CPU、記憶體、磁碟 I/O、連線池或方案容量。限流 Durable Object 的 I/O 不計入此資料庫統計。

## 判斷與後續

1. 共用密碼驗證合併減少重複 scrypt，但學生登入仍受每 process/isolate 8 筆處理、32 筆等待的接納限制。下一步需調整登入佇列與等待策略，依 300 人流程重測，不能只看登入後的查詢測試。
2. 避免所有失敗者固定同一時刻重試；應採有上限、含隨機間隔的重試／明確等待提示。
3. 校園共用 IP 限制目前為每 15 分鐘 600 次登入嘗試。Node 第一輪 300 次加一次重試 260 次共 560 次，本次沒有 429；若剩餘 220 人再一起重試，累計 780 次，可能因 IP 額度被擋。調整接納機制時須一起檢查這個限制，保留每學號的防猜密碼限制。
4. Cloudflare 本機 ProxyWorker 的 500 回應需另行排查。正式容量應再用隔離的 Cloudflare 測試部署與 Supabase 測試專案驗證；本次沒有使用正式名冊、正式帳號或正式資料庫，也沒有對正式站發送壓力流量。

## 重現

```sh
pnpm benchmark:student-login --db-delay-ms=30
pnpm benchmark:student-login --db-delay-ms=100
pnpm benchmark:student-login --workers --db-delay-ms=30
pnpm benchmark:student-login --workers --db-delay-ms=100
```

指令只啟動本機 API 與合成 Supabase 服務，結果寫入對應 JSON，runtime.log 留在本機且不納入 Git。完成後關閉子程序並刪除暫存 Durable Object 儲存。

原始資料：

- [STUDENT_LOGIN_LOAD_NODE_30MS.json](STUDENT_LOGIN_LOAD_NODE_30MS.json)
- [STUDENT_LOGIN_LOAD_NODE_100MS.json](STUDENT_LOGIN_LOAD_NODE_100MS.json)
- [STUDENT_LOGIN_LOAD_WORKERS_30MS.json](STUDENT_LOGIN_LOAD_WORKERS_30MS.json)
- [STUDENT_LOGIN_LOAD_WORKERS_100MS.json](STUDENT_LOGIN_LOAD_WORKERS_100MS.json)
- [STUDENT_LOGIN_LOAD_WORKERS_30MS_REPEAT1.json](STUDENT_LOGIN_LOAD_WORKERS_30MS_REPEAT1.json)
