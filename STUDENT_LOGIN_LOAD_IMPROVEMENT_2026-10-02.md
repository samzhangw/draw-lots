# 300 位學生首次登入改善驗證 — 2026-10-02

同一來源 IP、300 個不同學生帳號、使用共用密碼且驗證快取起始為空的本機 API 測試，首次登入與結果查詢從 40/300 提升到 300/300。每次模擬資料庫請求延遲 30 ms 或 100 ms 的 Node 與 Workers 情境皆不需重試。

## 程式調整

- 學生登入同時處理維持 8 筆；等待容量由 32 提升到 384 筆，佇列等待上限由 8 秒提升到 20 秒。一個 process/isolate 最多接納 392 筆未完成登入，超過容量或等待逾時仍回 503。
- scrypt 一次一筆、共用密碼成功快取 30 秒、Session 資料庫工作最多 16 筆並行、帳號與 IP 限流皆維持原設定。工作人員登入保留獨立的 2 筆處理、8 筆等待、3 秒。
- 每個學生仍查核自己的學號與最新密碼版本，建立獨立 Session。等待不會讓請求直接跳過密碼或權限驗證。

## 結果

所有情境首次登入均為 HTTP 200 共 300 筆，503／429／500／傳輸錯誤皆為 0。300 筆後續查詢全部成功，Cookie 共 300 個不同值，查到別人資料共 0 筆。

| 環境 | 每次模擬資料庫延遲 | 首次成功 | 登入 P50 | 登入 P95 | 登入最慢 | 查詢 P95 |
|---|---|---|---|---|---|---|
| Node | 30 ms | 300/300 | 2139 ms | 3891 ms | 4093 ms | 42 ms |
| Node | 100 ms | 300/300 | 6204 ms | 11582 ms | 12221 ms | 116 ms |
| Workers | 30 ms | 300/300 | 2887 ms | 4592 ms | 4796 ms | 48 ms |
| Workers | 100 ms | 300/300 | 6891 ms | 12285 ms | 12899 ms | 126 ms |

每個情境有 1200 筆模擬資料庫請求：學號查找、最新密碼版本查核、Session 寫入、結果查詢各 300 筆，未讀取完整名冊。最高併發維持 16 筆；成功率提升的代價是部分學生需要等待數秒，而非同時增加密碼驗證或資料庫工作。

## 同條件的舊設定對照

在相同的 Workers 本機代理連線暖機條件下，暫時回測舊佇列（8 處理、32 等待、8 秒）與 30 ms 模擬資料庫延遲：300 筆首次登入只有 40 筆成功，其餘 260 筆均為中文 JSON 503，無 500。測試完成後已恢復新設定。

這個對照確認接納上限是首次登入成功率的主要瓶頸。共用密碼快取本身不會增加可排隊人數。

## 本機 Cloudflare 連線問題與測試限制

Wrangler dev 的 ProxyWorker 會再透過本機連線轉發給 UserWorker。只準備用戶端連線、未準備代理內部連線時，新設定測得 161/300（30 ms）與 165/300（100 ms），其餘是非 JSON `Network connection lost` 500，未到達模擬資料庫。本機直接 Worker 派發的診斷也見新 TCP 連線錯誤。

因此正式比較前，先建立各學生獨立 keep-alive 連線，再用兩輪不帶 Cookie 的 GET /api/student/me 準備本機代理的內部連線。暖機只回 401，不讀取資料庫、不執行 scrypt，不會暖好共用密碼驗證快取或消耗學生登入額度。兩輪最後非 401 回應數均為 0；隨後同時送出 300 筆首次登入，每位成功者立即用自己的 Cookie 查詢。

這是「學生已開啟登入頁、傳輸連線已準備好」的應用程式負載測試。連線暖機解決的是本機測試代理的轉發限制，沒有據此宣稱修復正式 Cloudflare 的所有 500；未測試 300 人第一次建立 TLS 連線、下載前端或校園網路品質。

Supabase 是每次注入固定延遲的本機 HTTP 模擬服務，不包含 PostgreSQL CPU／磁碟 I/O／連線池／雲端方案限制。正式 300 人首次登入成功率仍應以隔離的 Cloudflare 測試部署與 Supabase 測試專案量測，不應把本次本機 100% 當成正式容量保證。此次未使用或修改正式名冊、正式帳號、正式資料庫。

## 防護驗證

- 新接納器實際測試 394 筆受阻工作：8 筆同時處理、384 筆等待、2 筆收到 ResourceBusyError；釋放後可繼續使用。
- API 測試確認 50 筆等待登入時只有 8 筆資料庫查核進行，已登入學生仍可查詢。
- Node 54 項測試與 Cloudflare 回歸測試均通過，涵蓋登入錯誤、個別密碼／共用密碼更新停用、獨立 Session、角色權限、Cookie 簽章、匿名拒絕、限流與資料庫錯誤回應；型別檢查、正式建置及 Wrangler 部署預檢亦通過。

同一 IP 的學生登入額度仍為每 15 分鐘 600 次。新流程 300 人各一次即可完成本機測試，不再因反覆同時重試而耗掉大量額度；錯誤密碼、額外梯次或其他請求仍會占用額度。

## 重現

```sh
pnpm benchmark:student-login --db-delay-ms=30 --output=STUDENT_LOGIN_LOAD_AFTER_NODE_30MS.json
pnpm benchmark:student-login --db-delay-ms=100 --output=STUDENT_LOGIN_LOAD_AFTER_NODE_100MS.json
pnpm benchmark:student-login --workers --db-delay-ms=30 --output=STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_30MS.json
pnpm benchmark:student-login --workers --db-delay-ms=100 --output=STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_100MS.json
```

原始結果：

- [STUDENT_LOGIN_LOAD_AFTER_NODE_30MS.json](STUDENT_LOGIN_LOAD_AFTER_NODE_30MS.json)
- [STUDENT_LOGIN_LOAD_AFTER_NODE_100MS.json](STUDENT_LOGIN_LOAD_AFTER_NODE_100MS.json)
- [STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_30MS.json](STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_30MS.json)
- [STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_100MS.json](STUDENT_LOGIN_LOAD_AFTER_WORKERS_PREWARMED_100MS.json)
- [STUDENT_LOGIN_LOAD_BEFORE_WORKERS_PREWARMED_30MS.json](STUDENT_LOGIN_LOAD_BEFORE_WORKERS_PREWARMED_30MS.json)
- [STUDENT_LOGIN_LOAD_AFTER_WORKERS_30MS.json](STUDENT_LOGIN_LOAD_AFTER_WORKERS_30MS.json)
- [STUDENT_LOGIN_LOAD_AFTER_WORKERS_100MS.json](STUDENT_LOGIN_LOAD_AFTER_WORKERS_100MS.json)

調整前完整測試：[舊設定報告](STUDENT_LOGIN_LOAD_TEST_2026-10-02.md)。
