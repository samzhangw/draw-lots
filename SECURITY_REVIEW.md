# 資安檢查與修復 — 2026-10-01

## 本次修復狀態

使用者指定的三項高風險問題與原始項目 6、7 已在程式中修復：

1. 完整名冊與領域 API 僅供工作人員；公開結果使用固定欄位白名單。學生使用後端 session，僅取得登入所綁定專題。
2. 學生新密碼以加鹽 scrypt 雜湊保存，不再回傳明文或雜湊；舊明文密碼全部停用。管理員可設定至少 12 字元的新密碼。新帳號不產生任何學號預設密碼。
3. `xlsx` 改用官方 CDN 固定版本 0.20.3，更新 bun.lock / pnpm-lock.yaml；補上 Excel 匯入匯出與大小限制測試。

4. 原始項目 6：領域配置與分組索引改用 Map，不會命中物件繼承屬性；測試五種特殊名稱同時存在時的獨立分組、評審與唯一順位，並從名冊匯入 API 執行全校抽籤。
5. 原始項目 7：統一錯誤回應，所有 5xx 與未預期例外只回固定訊息。格式錯誤 JSON／過大內容使用固定 400／413 訊息，不序列化例外或提交內容；保留應用程式自行撰寫的 4xx 操作提示。回應附上隨機 requestId／X-Request-ID，伺服器僅記錄事件 ID、狀態與固定例外類別，不記錄密碼、token、原始 body 或 stack。

學生使用 HttpOnly / Secure（正式環境）/ SameSite=Strict cookie；後端僅保存 token 雜湊，登出、密碼重設及刪除專題會使學生 session 無效。另加入登入限流及跨站操作檢查，修復特殊領域名稱導致抽籤失敗、內部錯誤直接回傳，以及初始 SQL 第一行的語法錯誤。

**部署前需執行 `supabase/migrations/202610010002_student_security.sql`**，並在後台重新設定學生密碼。現有 Supabase 尚無連線資訊，本次未操作雲端；歷史備份也未刪除。測試涵蓋程式行為與本機模擬服務，不等於線上滲透測試。

原項目 5 已修復：工作人員登入憑證移至 Supabase 後端 session，瀏覽器僅保存 HttpOnly 隨機 cookie；API 不接受前端 Bearer token，登出刪除 session 後立即失效。音效偏好為暫時介面狀態，已取消後端 API 與儲存。需依序執行 `supabase/migrations/202610010003_staff_sessions_and_preferences.sql` 與 `supabase/migrations/202610010004_remove_staff_preferences.sql`；後者移除不必要的音效偏好資料表。

尚未處理：多副本部署需共享限流、公開查詢的資源限流，正式 HTTPS / CSP / MFA / 線上 RLS 仍須部署時驗證。本次已處理使用者指定的三項高風險問題及原始項目 6、7。

驗證結果：8 項本機測試通過；PGlite PostgreSQL 實際執行 migration 並驗證明文約束、RLS 權限與重複執行；270 個套件名稱的鎖定／啟用版本 advisory 查詢未回報已知漏洞。

以下保留修復前的檢查證據，程式位置可能已變動。

---

# 原始檢查紀錄

檢查目前工作目錄的程式碼、Supabase migration、實際安裝套件與 bun.lock，並重跑現有 API 整合測試。本次只檢查及建立報告，未修改應用程式，也未操作線上 Supabase。

結論：寫入 API 有後端角色驗證，但學生資料保護與密碼處理仍有高風險問題，應先修正再開放正式使用。測試通過不代表安全性通過。

## 優先修正

### 1. 高：學生登入無法限制資料讀取

位置：server.ts:37、server.ts:72、server.ts:76、src/components/StudentPortal.tsx:37。

匿名 GET `/api/state` 或 `/api/projects` 會取得所有專題欄位，僅移除 `password`；包含組長學號、班級、指導老師、完整抽籤結果及評審。學生頁在驗證前便已下載資料，驗證只控制畫面顯示。無須登入即可批次抓取全部名冊。

修正：公開 API 使用欄位白名單，僅提供經確認可以公開的查榜資訊，移除學號等識別資料。若學生資料必須私有，改為後端學生 session 綁定專題 ID，查詢時只回傳該專題，前端不再先下載全部名冊。若學校刻意公開部分結果，也應把公開結果與學生帳號資料分離。

### 2. 高：學生密碼明文保存、傳回管理員，預設密碼可直接推算

位置：server.ts:38、server.ts:68、server/store.ts:30、src/components/AdminManagement.tsx:1138、src/components/AdminManagement.tsx:1265、src/lib/excel.ts:110。

學生密碼原樣寫入 JSONB，管理員 API 及畫面可以取得原始密碼。未設定密碼時使用學號後四碼，搭配上述公開學號即可推算預設憑證。學生帳號未使用 Supabase Auth。

修正：學生使用 Supabase Auth，或以 Argon2id / scrypt 加鹽雜湊並在後端驗證。提供重設密碼功能，不提供查看既有密碼功能；移除公開可推算的預設密碼。既有明文資料及舊 JSON 備份需納入移轉與密碼重設作業。

### 3. 高：Excel 解析套件含已知漏洞

位置：package.json:29、src/lib/excel.ts:45。

實際安裝及 bun.lock 的 `xlsx` 均為 0.18.5。npm advisory 查詢回報兩項 high：

- CVE-2023-30533：讀取特製檔案時可能觸發 Prototype Pollution；影響 <0.19.3。[公告](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- CVE-2024-22363：Regular Expression Denial of Service；影響 <0.20.2。[公告](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)

本程式在管理員瀏覽器執行 `XLSX.read`，因此攻擊入口是管理員匯入不可信 Excel；不能據此宣稱匿名者可直接攻陷 Node.js 伺服器。本次未執行漏洞惡意檔案。

修正：換用已修補版本或其他維護中的解析套件，更新鎖定檔並验证匯入／匯出。npm 的 `xlsx` 套件沒有對應修補版，單純 `npm update xlsx` 不足以修正；依 [SheetJS 官方安裝說明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) 選擇來源並鎖定版本與完整性。限制檔案大小與列數，必要時將解析移至可終止的 Web Worker。

## 其他確認問題

### 4. 中：自訂學生登入與公開資料 API 沒有應用層限流

位置：server.ts:15、server.ts:49、server.ts:63、server.ts:72。

學生驗證沒有嘗試次數限制、帳號／IP 限流或冷卻時間；每次請求都讀取整份 Supabase 資料。公開查詢也能被反覆呼叫消耗資源。Supabase Auth 的限流僅適用其 Auth 端點，不會替自訂 `/api/student/verify` 限流。管理員 Auth 請求由同一後端轉送，還需確認 Supabase 對伺服器 IP 的限流是否造成使用者共用配額。[官方說明](https://supabase.com/docs/guides/auth/rate-limits)

修正：加上每個來源 IP 與每個登入帳號的限流，超限回 429。多副本部署採共享儲存／反向代理限流；只有在可信代理配置下才採用轉送 IP，避免信任任意 X-Forwarded-For。

### 5. 中：管理員 token 可由 JavaScript 讀取，登出未撤销伺服器存取

位置：src/lib/auth.ts:29、src/lib/auth.ts:40、src/App.tsx:54。

Bearer token 存在 localStorage / sessionStorage。若發生同源 XSS 或其他同源腳本遭竄改，token 可被讀取。登出只刪除本機資料，先前被複製的 token 在到期前仍可使用。本次未發現可直接執行的 XSS，也未把可改寫前端 role 當作後端權限繞過，因為後端仍向 Supabase 驗證 token 與 app_metadata。

修正：採用伺服器管理的 session 與 Secure、HttpOnly、SameSite cookie；增加 CSRF 防護與 Origin 檢查。若要求登出後立即失效，API 必須檢查 session 撤銷狀態／denylist，不能只呼叫 Supabase signOut 就假定現有 access JWT 立即失效。

### 6. 中：特殊領域名稱可讓全校抽籤失敗

位置：src/lib/lottery.ts:123、server/store.ts:44。

領域名稱來自匯入資料，但分組使用普通 `{}` 物件作字典。`__proto__`、`constructor` 等名稱會命中繼承屬性。以只有一筆、field=`__proto__` 的測試專題通過 `validateProjects` 後呼叫全校抽籤，已重現 `projectsByField[p.field].push is not a function`。資料一旦經管理員匯入，全校抽籤便會持續失敗，直到修正資料；不是匿名直接寫入漏洞。

修正：改用 `Map` 或 `Object.create(null)`，同步檢查其他按領域名稱索引的字典；加入特殊領域名稱測試。

### 7. 低：錯誤回應直接揭露內部錯誤文字

位置：server.ts:144、server/store.ts:26、server/store.ts:36。

資料庫與程式例外的 message 直接回傳用戶端，匿名查詢出錯也會取得資料表／服務細節。本次沒有證據顯示金鑰出現在錯誤文字中。

修正：未預期錯誤僅回傳固定訊息與事件 ID；完整診斷在伺服器保存並遮蔽敏感資料。

## 已驗證的保護與檢查限制

- 未登入的寫入請求回 401，stage 修改名冊回 403；admin / stage 的權限由後端驗證，不依赖前端角色。
- 抽籤與重設同樣要求登入。跨裝置相同版本的同時寫入只有一個成功，另一個回 409。
- secret key 由伺服器環境變數讀取，前端 API helper 不包含 secret key；目前工作目錄只找到 .env.example，未發現實際 .env 金鑰檔。這不是 Git 歷史或外部平台的完整 secrets 掃描。
- migration 宣告啟用 RLS 並撤銷 anon / authenticated 表權限，但尚未驗證線上是否實際執行。後端使用 privileged key，因此 API 回傳的資料不會被 RLS 再次过滤。[Supabase RLS 說明](https://supabase.com/docs/guides/database/postgres/row-level-security)
- 現有 2 項測試皆通過，包含多項登入、權限、儲存、衝突與失敗情境；測試使用模擬 Supabase，不包含線上滲透測試。
- 套件掃描查詢 npm advisory 資料庫，涵蓋實際安裝的 194 個套件名稱以及 bun.lock 鎖定版本。查無公告不代表沒有漏洞；不涵蓋 OS、容器、代理或供應鏈來源遭竄改。
- 未提供實際部署網址與雲端設定，尚不能驗證 HTTPS、反向代理限流、MFA、備份權限或線上 RLS。程式自身沒有設定 CSP / frame-ancestors 等安全標頭。

## 另發現的部署問題

目前 `supabase/migrations/202610010001_lottery_state.sql` 第一行以 `ㄧ--` 開頭，多了一個 `ㄧ`，會造成 SQL 語法錯誤；執行建表前應移除。此項是部署問題，不列為資安漏洞。本次未改動該檔。

`npm start` 沒有自行設定 NODE_ENV；缺少 `NODE_ENV=production` 時會啟動 Vite 開發中介層並監聽 0.0.0.0。正式部署應明確使用 production 模式與 HTTPS 反向代理。
