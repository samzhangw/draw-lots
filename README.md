# 國立臺中科技大學專題展報告抽籤系統

React + Vite 前端，Express API 統一使用 Supabase Database 與 Supabase Auth。支援 Cloudflare Workers（含 Static Assets 與 SQLite Durable Objects）及本機 Node.js。

## 啟動

1. 安裝 Node.js 22.12 以上版本與相依套件：`npm install`（或 `pnpm install`）。
2. 在 Supabase 專案的 SQL Editor 依序執行 [初始資料庫 migration](supabase/migrations/202610010001_lottery_state.sql)、[學生資安 migration](supabase/migrations/202610010002_student_security.sql)、[工作人員 session migration](supabase/migrations/202610010003_staff_sessions_and_preferences.sql)、[移除音效偏好資料表 migration](supabase/migrations/202610010004_remove_staff_preferences.sql)、[專題獨立資料列 migration](supabase/migrations/202610020001_project_rows.sql) 與 [學生查榜單次查詢 migration](supabase/migrations/202610020002_student_lookup.sql)。已有資料庫請依序執行尚未套用的 migration；第二份會移除所有舊明文學生密碼，之後須重新設定。
3. 複製 `.env.example` 為 `.env.local`，填入：

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   PORT=3000
   ```

   亦支援舊版 `SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`。Secret / service role key 僅供伺服器使用，不能使用 `VITE_` 前綴，也不要提交至版本控制。[Supabase 官方金鑰說明](https://supabase.com/docs/guides/getting-started/api-keys)

4. 在 Supabase Authentication → Users 建立並確認管理員與抽籤人員的 Email 帳號。將下列 SQL 的 Email 改為實際帳號後執行；權限存於 `app_metadata`，使用者不能自行更改：

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@example.edu.tw';

   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"stage"}'::jsonb
   where email = 'stage@example.edu.tw';
   ```

5. 執行 `npm run dev`，開啟 `http://localhost:3000`。管理員使用 `/admin`，抽籤人員使用 `/stage`。登入使用上述 Email 與密碼，舊示範帳密已移除。

## 資料與權限

- Excel 匯出依原始「編號」排列：A01、A02、A03…B01、B02、B03…G01。流水號按數值排序（A99 在 A100 前），不受領域顯示順序、是否已抽籤或組內報告順位影響。

- 管理後台「專題展領域、分組數與評審委員設定」可在領域的「編輯」視窗，以「顯示順序」下拉選單選擇位置，按儲存後同步至 Supabase、領域選單與台上抽籤頁，重新整理後保留。新增領域預設排最後，也可指定插入位置；取消編輯不會改變順序。

- 原始「編號」同樣使用 A～G 領域字母＋至少兩位數字，例如 A01、A02、B01。既有名冊載入時會套用此格式，下次成功儲存時寫回資料庫；匯入與手動新增也由後端統一編號。已符合格式且不重複的編號會保留，新增資料取得未使用流水號；變更領域時改用新領域字母。此編號與抽籤順序分開，不會因抽籤、重設而重編。自訂領域保留原始編號。

- 新抽籤編號使用「領域字母＋至少兩位數字」：A 企業智慧化、B 數位內容與多媒體應用、C 網路應用與資通安全、D 嵌入式系統與行動計算、E 智慧運算創新應用、F 智慧流通應用與研究、G 進修部。例如 A01、A02；同領域跨組連續編號，各組報告順序仍各自從 1 開始。超過 99 件時繼續為 A100，不截斷。自訂領域沿用原編號格式；已儲存結果不會自動改號，需重設後重新抽籤。
- 縮減分組數時，後端會拒絕移除仍有抽籤結果的組別，提示先重設該領域；拒絕時設定、結果與資料版本均不變。增加組數或只移除空組可直接儲存，不會重新抽籤。
- 在領域的「編輯」視窗勾選「直接指定每組件數」，可逐組填寫專題件數，例如第 1 組 10 件、第 2 組 12 件；0 件表示不分配。設定可先儲存，抽籤時各組件數合計須等於該領域名冊件數。指定件數採容量配對，會重新安排先前分配以滿足合法方案；若件數與指導老師迴避無法同時滿足，拒絕整次抽籤並保留原資料。各組報告順位仍隨機洗牌，A–G 編號規則不變。取消勾選沿用原本自動分組；已抽結果若不符合新件數，須先重設該領域。
- 管理後台的「測試抽籤」會先開啟視窗，選擇全校或單一領域後，按「開始測試」才使用已儲存名冊與設定試跑一次，列出各組實際／指定件數、容量無解、利益衝突、重複編號與評審未設定提醒，並展開試跑順位。僅 admin 可呼叫測試 API；已有正式結果仍可測試，不會寫入資料庫、變動資料版本或覆蓋正式結果。單次試跑不是所有隨機分配的保證；正式抽籤會重新產生結果。
- 評審名單中的姓名不可空白或只有「教授」「老師」等職稱；儲存時會提示領域與組別。利益迴避比對會忽略正規化後為空的姓名，避免既有無效姓名造成誤判；空評審名單仍可保留待設定。

- 每件專題以 JSONB 獨立儲存於 `ntcust_projects`，保留 `assigned_group`、`evaluators` 等欄位；`ntcust_lottery_state` 儲存領域、評審設定與資料版本。整份名冊取代時，刪除與清空也會同步生效。
- 每次修改以 `version` 比對更新，名冊與設定在同一個資料庫操作提交。其他裝置已更新時回傳 HTTP 409，請重新載入後再操作。
- 匿名 `/api/health` 只回 status，使用小型 HEAD 查詢與 2 秒後端快取；每 IP 每分鐘最多 120 次，全站 3600 次。`/api/public-results` 只選公開欄位、分頁最多 2000 筆並檢查版本一致，後端快取 5 秒；每 IP 每分鐘最多 600 次，全站 6000 次。Workers 使用共享 Durable Object 計數，Node 單行程使用有上限的記憶體計數。超限回 429 與 Retry-After。
- 登入 JSON 上限 4 KB，其他小操作 64 KB。名冊寫入先驗證管理員才解析最多 5 MB，另限制文字欄位、領域與評審數量。學生登入每個行程／isolate 最多 8 件執行、32 件等待，等待最多 8 秒；工作人員為 2 件執行、8 件等待、3 秒，兩者獨立。限流先於入隊，查榜不進登入隊列。
- scrypt 在同一行程／isolate 一次只執行 1 件、最多等待 32 件／8 秒，涵蓋學生登入、個別密碼更新與共用密碼產生；避免多個 ApiBackend 物件同時耗用雜湊記憶體。滿載或等待逾時回 503 與 Retry-After: 2。Supabase 請求設 5 秒期限；匿名快取刷新也有總共 5 秒期限，不會快取失敗回應。
- 成功寫入會清除該行程／isolate 的公開結果快取；其他 isolate 最多保留 5 秒舊結果。學生個別查榜不快取，仍直接讀取自己的專題。公開結果端點需要已套用第五份「專題獨立資料列」migration；此次負載修復沒有新增 SQL。這些程式界限不能取代 Cloudflare WAF 或正式容量測試。
- 登入限流固定以實際認證帳號計數：工作人員使用 Email、學生使用組長學號。額外欄位不能改變限流帳號；同帳號大小寫與前後空白統一，跨 IP 仍共用帳號次數。無效帳號在建立限流桶前拒絕。
- RLS 與資料表權限禁止瀏覽器直接存取，由 API 查驗後端 session 與 Supabase Auth 身分後讀寫。`admin` 可修改名冊與設定；`stage` 可抽籤及重設。
- 完整名冊與領域設定 API 僅限已登入的 admin / stage。匿名 `/api/public-results` 僅回傳領域、公開專題編號、分組及順位，移除學號、班級、專題名稱與評審等資料。
- 學生頁不預先下載名冊。登入後透過 HttpOnly、SameSite=Strict cookie 查詢 `/api/student/me`，後端 session 綁定唯一專題 ID，不接受前端選擇其他專題。學生回應僅回傳目前登入的組長學號，不提供名冊序號、班級、學制、系所或指導老師；學生頁只在登入狀態列顯示該學號。正式環境 cookie 設為 Secure，必須使用 HTTPS。
- 學生密碼使用 scrypt（N=32768、r=8、p=3）及每筆隨機 salt 保存雜湊；API 不回傳密碼或雜湊，管理員只能設定／重設密碼與查看設定狀態。新密碼須為 12 至 128 字元，不可使用學號。留空不建立預設密碼：既有帳號保留其雜湊，新帳號須由管理員設定密碼後才能登入；變更學號時也需重新設定密碼。
- 管理後台可按「產生全體共用密碼」一次產生 8 碼隨機英數密碼（避開易混淆字母），所有學生使用自己的組長學號及同一組密碼登入。密碼只顯示一次，資料庫僅保存雜湊；重新產生會使舊密碼及登入 session 失效。新增或匯入的專題會自動沿用共用密碼。共用密碼模式下顯示目前登入的組長學號、專題名稱及抽籤結果，不顯示班級、指導老師或評審；知道其他組長學號的人也能查詢該組專題名稱與抽籤結果。停用共用密碼後，所有學生須重新設定個別密碼才能登入。
- **所有舊明文密碼視為已暴露並停用**，即使未執行第二份 migration，後端也不再接受它們。執行 migration 後，管理員在專題編輯畫面重新設定並私下提供新密碼。歷史 JSON／Excel 備份仍需由管理員妥善控管，不要提交至版本控制。
- 學生 session 期限為一小時，資料庫僅保存 token 的 SHA-256；重設密碼或刪除專題會使相關 session 無效。學生登出會刪除後端 session，移除 cookie。可用 privileged 排程定期清除 `ntcust_student_sessions` 的過期資料列。
- 登入有每帳號 10 次／15 分鐘、每 IP 100 次／15 分鐘的限制，跨站 JSON 操作會被拒絕。Cloudflare 使用 Durable Object 原子計數，跨地區／重啟共用相同限制，僅保存帳號與 IP 的雜湊索引及短期計數；本機 Node.js 使用行程內限流。
- Excel 套件固定使用官方來源 `xlsx@0.20.3`，鎖定檔保存完整性；匯入上限 5 MB／2000 筆。密碼欄位可留空，後續於後台設定；有填密碼時須符合新規則，匯出結果不包含憑證。
- 跨裝置寫入使用資料庫版本比對；兩個裝置以同一版本儲存時，只有第一筆成功，另一筆收到 409，須重新載入後再操作。前端版本號與畫面資料一起更新；若載入新版時有開啟中的舊草稿，會保留其輸入供複製但禁止儲存。Excel「完全覆蓋」會替換名冊；已有抽籤結果時須另外勾選確認。相同組長學號的匯入專題會保留原專題 ID，以維持未重設的學生密碼。
- 管理員／展演人員的登入 session 與 Supabase access token 存在 `ntcust_staff_sessions`，不再回傳 token 或寫入 localStorage／sessionStorage。瀏覽器只持有 HttpOnly 隨機 cookie；每次操作均查驗後端 session、到期時間與 Supabase 身分。登出刪除 session，舊 cookie 立即失效。勾選「記住我」只決定 cookie 是否保留至 token 到期，不延長登入期限。
- 音效播放與音效開關已移除；抽籤動畫保留。未提交表單、搜尋／篩選、彈窗、載入狀態與動畫仍留在前端。第四份 migration 會移除第三份曾建立的音效偏好資料表；保留既有 migration 以支援已部署的資料庫。
- 所有正式業務資料、學生與工作人員 session均由 Supabase 保存；前端記憶體僅供畫面顯示。後端重啟不會遺失已提交資料，沒有本機資料庫備援。可定期清除 session 表的過期資料列。
- 資料連線或儲存失敗會顯示錯誤，不會改用本機 JSON、localStorage 或前端計算抽籤結果。學生按「重新整理」取得最新資料。
- 初始名冊為空，可由管理員匯入 Excel。未設定連線資訊時 API 回傳 503，不會自動建立示範資料。

## 專題資料列與既有資料庫升級

- 名冊改存於 `ntcust_projects`，每件專題一列；`document` 保存該專題全部欄位，`position` 保留名冊順序。`id` 為主鍵，正規化的組長學號 `leader_key` 有唯一索引，查榜不必讀取其他專題。
- 學生登入依組長學號查詢一列；登入後依 session 的專題 ID 查詢一列。密碼雜湊、共用密碼顯示限制與密碼重設後的 session 失效規則保持一致。
- 管理、匯入、抽籤、重設與匯出仍需完整名冊。讀取 RPC 提供一致的名冊／設定／版本快照；儲存 RPC 鎖定版本，在同一交易內更新有變動的專題、刪除移出的專題、保存設定並遞增版本。失敗全部回復，過期版本回傳 409。
- 資料表啟用 RLS，匿名與一般登入角色沒有存取權限；後端角色只能讀取專題，寫入必須經過受限的儲存 RPC，避免繞過版本檢查。現有名冊上限仍為 2000 筆。

已有資料的升級順序：

1. 備份 Supabase 資料庫，確認前四份 migration 已套用。
2. 先部署新版 API；第五份 migration 尚未套用時，新版暫時沿用舊 JSON 儲存方式，網站仍可使用，但尚無單筆查詢效益。
3. 確認新版部署完成，暫停管理員匯入、抽籤等寫入操作，在 Supabase SQL Editor 執行 [專題資料列 migration](supabase/migrations/202610020001_project_rows.sql)。SQL 會將原名冊完整移入專題資料表、保留 ID／順序／抽籤結果／密碼雜湊與版本，再移除原名冊欄位。若 ID 或正規化學號重複、共用密碼不一致，整個交易失敗，原資料保留，請先修正資料再重試。
4. 確認 SQL 成功後，檢查 `/api/health`、管理名冊與學生查榜。正常查榜只查 `ntcust_projects` 的一列；相容流程僅在 schema 尚不存在時啟用，不會掩蓋斷線或權限錯誤。

第五份 migration 只需執行一次。套用後不要回退到仍直接寫入舊 `projects` 欄位的 API；回退新版程式需搭配備份還原或另外準備反向遷移。本機測試已驗證 SQL，正式 Supabase 的遷移仍須另外執行，推送程式不會自動修改資料庫。

學生查榜加速：先部署新版程式，再於 Supabase SQL Editor 執行第六份 [學生查榜單次查詢 migration](supabase/migrations/202610020002_student_lookup.sql)。需先完成第五份 migration；此 SQL 不變更名冊、密碼或既有登入 session。套用後 `/api/student/me` 一次 RPC 同時讀取有效 session 與自己的專題，後端仍檢查密碼指紋；函式僅開放 service_role。未套用時僅在 RPC 缺少（PGRST202）時回退既有索引查詢，其他資料庫錯誤直接回 503。推送不會自動執行 SQL。

## 舊資料移轉

保留原始 `data/server-db.json` 作為備份。完成建表與環境設定後，在尚未操作過的空白 Supabase 資料庫執行：

```sh
npm run migrate:local
# 或指定其他備份檔
npm run migrate:local -- /absolute/path/server-db.json
```

移轉工具會保留專題與領域設定、移除舊明文密碼，並拒絕覆蓋已使用的資料庫。舊瀏覽器 localStorage 快取不會自動上傳。

## 驗證與部署

```sh
npm run lint
npm run test
npm run build
NODE_ENV=production npm start
```

### Cloudflare Workers 部署

目前部署網址：[學生查榜首頁](https://nutc.cc.cd/)、[管理後台](https://nutc.cc.cd/admin)、[台上抽籤](https://nutc.cc.cd/stage)。備用網域：`special-exhibition-lottery.ymhs0208.workers.dev`。

首頁固定使用 `/`，管理後台使用 `/admin`，台上抽籤使用 `/stage`，不再附加重複的 `#/...`。舊 `/student`、`/manage`、`/lottery`、`/inquiry`、`?view=...` 與角色 hash 網址會整理為對應路徑；明確頁面路徑優先於 query/hash。其他查詢參數與 `#main-content` 等內容錨點保留，瀏覽器上一頁／下一頁會同步畫面與標題。點擊頁首標誌可返回首頁。

使用 Workers，並在 Workers & Pages 建立 Worker、連接本 GitHub 儲存庫。不要選擇只部署 `dist` 的純靜態 Pages。

- 儲存庫：`ymhs0208/Special-Exhibition-Lottery`，分支：`main`，根目錄：`/`。
- 建置命令：`npm run build`；部署命令：`npx wrangler deploy`。
- 使用 Bun 的 Workers Builds 可保留建置命令 `bun run build`。`bun.lock` 採用 Bun 1.2.15 可讀取的版本 1 格式，套件版本與完整性保持鎖定；更新依賴時須確認 `bun install --frozen-lockfile` 可在建置環境使用的 Bun 版本通過，避免產生舊版 Bun 無法解析的鎖定檔。
- 在 Worker 的 Settings → Variables and Secrets 設定 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`；`SUPABASE_SECRET_KEY` 必須選 **Secret**。這些是執行階段設定，不只是在 Builds 裡的建置變數。
- `wrangler.jsonc` 配置 API、前端 SPA 路由、自訂網域與 Durable Object migration；不含任何實際金鑰。`keep_vars` 保留 Dashboard 中已設定的執行階段變數，避免後續部署移除連線設定。`/api/*` 優先執行後端，即使直接從網址列開啟也不會回傳前端 HTML。
- 管理員與學生 cookie 在 Workers 正式環境一律使用 Secure / HttpOnly / SameSite=Strict；前端與 API 共用網域，不需開放跨站 CORS。

本機 CLI 部署：

```sh
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
npm run deploy
```

若使用私人的 `.env.local` 一次上傳三個執行階段設定，可用 `npm run build` 後執行 `npx wrangler deploy --secrets-file .env.local`；該檔案不得提交 Git。線上不需要 `PORT`。

API 在 `ApiBackend` Durable Object 執行，提供密碼雜湊所需的 CPU 時間；正式名冊、登入 session 與抽籤結果仍保存於 Supabase。`LoginLimiter` Durable Object 只保存短期限流計數。SQLite Durable Objects 支援 Workers Free；請留意實際用量配額。參考 [Workers CPU 限制](https://developers.cloudflare.com/workers/platform/limits/) 與 [Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)。

Cloudflare 單次最多設定 100 組學生密碼，請分批設定；不設定新密碼的名冊仍可匯入 2000 筆。後端逐筆雜湊並限制同一 API shard 的並行操作，避免記憶體與執行時間超額。已有雜湊可留空保留。

部署後檢查 `https://你的網域/api/health` 應回傳 `status: ok`，此檢查包含業務資料表與兩種登入 session 資料表。若回傳 503，確認 Supabase URL、Secret key 及 SQL migrations／資料表權限；Secret key 不可誤填 Publishable key。

### 本機 Workers 驗證

```sh
npm run build
npm run test:cloudflare
npm run deploy:check
npm run dev:cloudflare
```

`test:cloudflare` 使用真正的 workerd 引擎與模擬 Supabase，驗證前端路由、API 權限、scrypt 雜湊、cookie、抽籤、資料庫版本衝突、登入限流及 Workers 重啟；不會寫入正式 Supabase。

一般 Node.js 部署仍可用 `NODE_ENV=production npm start`。`vite preview` 僅供靜態預覽，不提供 API。

測試使用本機模擬 Supabase HTTP 服務，涵蓋工作人員 cookie／登出撤銷／重啟恢復、匿名讀取限制、學生專題存取、cookie、密碼雜湊／重設／舊密碼停用、API 權限、完整欄位儲存、刪除／清空、抽籤／重設、版本衝突、登入限流與連線失敗，另測試 Excel 匯入匯出。實際 Supabase migration 與雲端連線需填入專案資訊後驗證。

資料庫測試使用 PostgreSQL（PGlite）實際執行 migrations，驗證欄位與抽籤結果保留、主鍵／學號索引與 2000 筆資料的查詢計畫、交易失敗回復、版本衝突、刪除／清空、學號互換、角色權限，以及遷移失敗保留原資料。API 測試另驗證舊 schema 相容與 300 次同時查榜只查單筆資料。套件 advisory 查詢涵蓋鎖定及啟用版本，未回報已知漏洞；不代表所有部署層面的風險都已消除。

API 內部錯誤僅回傳固定訊息與事件 ID；5xx 不會回傳資料庫錯誤、檔案路徑或堆疊。格式錯誤 JSON 回 400，過大請求回 413。特殊領域名稱（含 `__proto__`、`constructor`）可正常參與獨立分組抽籤。
