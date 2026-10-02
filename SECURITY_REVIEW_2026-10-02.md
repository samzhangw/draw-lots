# 資安檢查報告 — 2026-10-02

## 結論

受檢版本：Git `3e1038c`，檢查前工作目錄乾淨。本次只新增報告，未修改應用程式、部署或寫入正式資料庫。

既有修復有效：後端角色驗證、學生 session 綁定專題、密碼 scrypt 雜湊、DTO 白名單、登出撤銷、資料版本比對與錯誤遮蔽均有測試支持。但仍發現 **1 項高風險設計（須啟用共用密碼）、4 項中風險、2 項低風險**，另有 **1 項高優先業務完整性缺陷**。不宜將目前狀態視為完成正式環境安全驗收。

優先處理工作人員帳號限流繞過；若要求學生只能看自己的結果，停用共用密碼；抽籤不得在無合法組別時默默放寬利益迴避規則。

風險等級為本系統情境評估，並非 CVSS 分數。設計風險、已重現缺陷和待驗證部署項目分開列示。

## 檢查範圍與方法

- 讀取 Express API、Node 啟動程式、Cloudflare Workers／Durable Objects、Supabase migrations、學生與工作人員登入、session、限流、名冊與抽籤流程。
- 檢查 React 資料呈現、瀏覽器儲存、Excel 匯入／匯出、亂數、建置與部署設定、錯誤處理及資料白名單。
- 掃描目前受版本控制檔案與所有本機 Git refs 可達的 45 個提交；僅輸出疑似祕密的位置，不輸出憑證。
- 執行本機 Node／workerd 整合測試、型別檢查、正式建置、鎖定依賴 advisory 掃描，以及針對缺陷的本機重現。
- 對 README 所列兩個部署網址各執行 4 次低頻匿名 GET，未嘗試登入、猜密碼、負載攻擊或正式資料寫入。
- 使用本機設定的 publishable key，對正式 Supabase 三張資料表各執行一次 `select=*&limit=0` 匿名請求；未讀取實際名冊或 session 資料。

沒有進行正式帳號登入、authenticated 資料庫角色測試、雲端管理設定盤點、SQL catalog 全面驗證、備份恢復演練或全面滲透測試。未使用 service-role key 操作正式資料庫。本次沒有重新執行 SQL migrations；既有報告的 PGlite 結果不算本次驗證。

## 驗證結果

| 項目 | 結果與限制 |
| --- | --- |
| `pnpm test` | 12 項通過，0 失敗；包括後端權限、session 撤銷、IDOR、版本衝突、Excel、錯誤處理與限流 |
| `pnpm test:cloudflare` | 2 項通過，0 失敗；真實 workerd + 模擬 Supabase，包括 Workers 重啟與共用限流 |
| `pnpm lint` | 通過 |
| `pnpm exec wrangler deploy --dry-run` | 通過，僅打包與預檢，未部署；因環境沒有 npm，使用已完成建置後直接執行 wrangler 的等效檢查 |
| `pnpm build` | 通過；存在 Vite 設定相容性與大 bundle 警告，未視為安全漏洞 |
| `pnpm audit --json` | 390 個依賴統計；已知漏洞各等級均為 0。URL 型套件須額外確認 |
| 建置產物祕密檢查 | 未包含本機設定的 Supabase URL、publishable key、secret/service-role key 字串 |
| Git 祕密掃描 | 45 個提交未命中受檢 key/JWT/private-key 格式；未追蹤 `.env` 或 `.env.local`。格式掃描不能證明完全沒有祕密 |
| 正式 Supabase 匿名資料表讀取 | `ntcust_lottery_state`、`ntcust_student_sessions`、`ntcust_staff_sessions` 全部 HTTP 401，PostgreSQL `42501`（權限拒絕） |
| 正式網站探測 | `nutc.cc.cd` 與備用 workers.dev 的 `/student`、`/api/health`、`/api/state`、`/api/student/me` 全部 403；未取得應用程式回應，不能推定應用程式權限或安全標頭正常／異常，也不能確定拒絕來源 |

Workers 測試中的 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只作用在信任本機自簽憑證的測試行程，未發現正式程式關閉 TLS 驗證。

### SheetJS advisory 判讀

安裝來源固定為官方 CDN 的 `xlsx@0.20.3`。額外 OSV 查詢回傳兩項 advisory，但其 npm SEMVER 範圍只有 introduced=0，沒有 fixed 邊界；`last_known_affected_version_range` 分別為 `<0.19.3`、`<0.20.2`。因此不能直接將 OSV 回傳誤判為本專案仍受這兩項漏洞影響。

官方公告指出 Prototype Pollution 修復於 0.19.3、ReDoS 修復於 0.20.2，0.20.3 高於兩者修復版本。本次未將兩者列為適用漏洞，也不以此聲稱不存在其他未知漏洞。參考：[CVE-2023-30533 官方公告](https://cdn.sheetjs.com/advisories/CVE-2023-30533)、[CVE-2024-22363 官方公告](https://cdn.sheetjs.com/advisories/CVE-2024-22363)。

## S01 — 中：額外 leaderId 欄位可繞過工作人員帳號限流（已重現）

位置：`server/rateLimit.ts:15`、`server/app.ts:75`。

所有 scope 都使用 `req.body.leaderId ?? req.body.username` 建立帳號索引。工作人員驗證實際使用 username，卻接受額外 leaderId。因此攻擊者對同一 Email 猜密碼時，只要每次帶入不同 leaderId，就會得到不同的帳號限流桶。

本機重現：固定 username、固定 IP，連續呼叫 middleware 12 次。不帶額外欄位時前 10 次放行，第 11／12 次 429；帶入不同 leaderId 時 12 次全部放行。這驗證的是限流決策，並非 12 次成功登入。Node 與 Workers 使用相同索引程式，兩者均受影響；尚未對正式登入端點嘗試此技巧。

IP 限制仍有效（staff 每 IP 100 次／15 分鐘），Supabase 自身防護也可能限制攻擊，因此不是無條件無限猜密碼或登入繞過。但多 IP 可以對同一帳號繞過原先跨 IP 的 10 次限制。

修正：依 scope 明確選取 `staff → username`、`student → leaderId`；驗證登入 payload 白名單，並新增不同 IP／額外欄位仍共用同帳號計數的回歸測試。應先驗證帳號型別與長度再建立限流索引。

## S02 — 高（條件式）：全體共用密碼無法證明學生身分

位置：`server/app.ts:99`、`server/app.ts:156`、`server/credentials.ts:61`、`server/credentials.ts:98`。

啟用時所有專題保存同一個密碼雜湊；登入以可推知的學號選擇專題，再驗證共同密碼。任何知道共同密碼與另一位組長學號的人，都能取得該組專題名稱與抽籤結果，且在抽籤前就能取得名稱。成功登入後 session 綁定專題不能阻止這種首次身分冒用。

這是 README 與後台確認文字已揭露的刻意設計，不是新發現的程式權限繞過。若專題名稱及學號對應關係應保密，風險高；若已正式確認可對所有持有共同密碼者公開，應記錄接受風險，勿再宣稱「學生只能看自己的資料」。未確認正式環境目前是否啟用。

修正：私有模式使用個別隨機密碼、學校 SSO 或唯一查詢憑證；公開模式直接提供經核准的公開資料白名單，避免用共同密碼營造個別身分驗證的效果。單純增加共同密碼長度不能修正此問題。

## S03 — 中：管理員 API 未要求 MFA assurance level

位置：`server/app.ts:75`、`server/staffSessions.ts:42`。

程式以密碼登入後，只查驗 Supabase 使用者、ID 與 app_metadata.role，未要求 `aal2`，也沒有 MFA challenge 流程。這個應用程式層的檢查不會因使用者已註冊 MFA 就自動強制第二因素。若沒有外部額外政策，取得管理員密碼即可登入並修改名冊、密碼與結果。

這是防護缺口，未證實任何帳號遭入侵，也未讀取正式 MFA 設定。

修正：工作人員整合 MFA challenge；建立及查驗後端 session 時要求經驗證 token 的 AAL 符合規則。角色移除／停用、密碼重設與 session 撤銷也需做正式驗收。參考：[Supabase MFA 與授權要求](https://supabase.com/docs/guides/auth/auth-mfa)。

## S04 — 中：公開查詢與登入排隊缺少應用層資源界限

位置：`server/app.ts:24`、`server/app.ts:65`、`server/app.ts:118`、`worker/index.ts:45`。

`/api/health` 每次讀取整份名冊並查兩张 session 表；`/api/public-results` 每次讀取整份含雜湊的 JSONB 再篩選。兩者未設應用層限流或快取，重複匿名請求會放大資料庫負載。全域 JSON parser 在認證／限流之前解析最多 5 MB 的 payload，登入實際只需很小的內容。

Workers 學生登入先進入沒有長度／等待期限上限的 queue，之後才到 Express 限流。被限流的請求也先排隊；密碼重設與共用密碼產生端點則未經該 queue。這是可用性與成本風險，未進行負載測試，也未確認 Cloudflare WAF 或平台配額是否已有補強。

修正：為匿名查詢設限流與短期公開結果快取；健康檢查改成最小查詢。登入 payload 另設較小上限；在排隊前執行驗證／限流，設 queue 上限、等待期限及適當的雜湊並行限制，避免使用全域鎖阻塞正常查榜。

## S05 — 中：前端文件缺少 CSP；Node 版本未全面加上安全標頭

位置：`worker/index.ts:33`、`server/app.ts:16`、`server.ts:17`、`index.html`。

Workers 對回應加入 HSTS、nosniff、DENY，但沒有 CSP。Node 的 nosniff／DENY 僅加在 `/api`，直接回傳的 SPA 文件沒有相同防護；HTTPS 終結代理也未在此專案配置。Node 若直接公開，可能遭 iframe 嵌入；缺少 CSP 會減少對未來腳本注入或資源污染的防禦。

未發現可用的 XSS payload：業務資料以 React 文字節點呈現，未發現啟用路徑中的 dangerouslySetInnerHTML/eval。未將未使用的 LogoUploadModal SVG 支援誤判為已成立 XSS 或 SSRF。正式網址 403 的標頭不是本程式正常回應證據。

修正：HTML 及 API 一致套用防護；依前端實際需求設定 CSP 的 script-src、connect-src、img-src、object-src、base-uri、frame-ancestors。先用 Report-Only 驗證動畫、inline style 與校方圖檔不被誤擋，再啟用強制規則。Node 正式服務須經 HTTPS 代理並明確設定 cookie／代理信任。參考：[Cloudflare Workers 安全標頭範例](https://developers.cloudflare.com/workers/examples/security-headers/)。

## S06 — 低：安全亂數不存在時默默改用 Math.random（已修復）

位置：`src/lib/cryptoRandom.ts:42`、`src/lib/cryptoRandom.ts:60`。

抽籤亂數函式在 Web Crypto 不可用時回退 Math.random，削弱「使用密碼學亂數」承諾。目前要求的 Node 22.12+ 與 Workers 通常具備 Web Crypto，沒有證據表示正式抽籤正在使用 fallback。

修正：正式抽籤在 CSPRNG 不可用時拒絕執行；測試需要的亂數改以顯式注入方式提供。

2026-10-02 修復：移除整數與浮點亂數的 Math.random 備援。Web Crypto 缺少或 getRandomValues 執行失敗時拋出明確錯誤，API 回傳 503 並停止儲存抽籤結果；洗牌與隨機選取也檢查安全亂數支援。單元測試明確替換 Web Crypto 以模擬故障與拒絕取樣，不在正式程式提供不安全亂數路徑。

## S07 — 低：匿名健康檢查暴露名冊筆數與更新時間

位置：`server/app.ts:73`。

健康檢查回傳 projectCount、lastUpdated 與 backend engine。這不是學生個資直接外洩，但提供活動規模與更新節奏的額外資訊。

修正：匿名端點只回 status；細節移至驗證後的管理診斷端點。若這些數據已核准公開，可記錄接受風險。

## B01 — 高優先：無合法組別時繼續抽籤，忽略利益迴避規則（已重現）

位置：`src/lib/lottery.ts:61`、`src/lib/lottery.ts:145`、`server/app.ts:192`。

若某專題的指導老師與所有組別評審都衝突，validGroups 變空後程式直接改為全部組別，繼續產生並保存結果。全校抽籤雖算出 conflictCount，但 API 只取 updatedProjects，回傳成功訊息，沒有阻止儲存或告警。

本機重現：指導老師「王教授」，兩組評審均含「王教授」，仍得到 draw_order，且 isAdvisorConflict 為 true。

這是業務規則與結果完整性缺陷，並非匿名攻擊者能改寫結果的證据。修正：無合法組別時在保存前拒絕並列出需修正的設定；領域評審在抽籤後變更時也要重新檢查衝突。如需人工例外，應提供明確核准流程並留下紀錄。

## 已確認的有效防護

- admin／stage 角色由 Supabase app_metadata 判斷，未依賴前端角色或 user_metadata；stage 無法修改名冊與領域。
- 匿名名冊端點要求工作人員 session；公開結果採欄位白名單；學生 session 不接受 query projectId 選擇別組。
- 工作人員 token 不回傳前端、不存 localStorage；兩種 session 使用 32-byte 隨機 token，資料庫索引保存 SHA-256；cookie 有 HttpOnly、SameSite=Strict，正式環境有 Secure。
- 學生雜湊使用隨機 salt 與 scrypt，舊明文密碼不再接受；重設、刪除與登出使 session 失效，回應不包含 hash／password。
- 儲存採資料庫 version compare-and-swap，過期畫面不能覆蓋新結果；抽籤使用後端結果。
- API 未開放任意 CORS，POST 有 JSON、Origin 與 Fetch Metadata 檢查。Origin 目前只比 host，建議正式環境固定完整 origin 作進一步強化；未重現 cookie CSRF 繞過。
- 資料庫查詢使用 SDK，不拼接使用者 SQL；未發現路徑遍歷、任意檔案寫入、shell 執行或使用者可控制的後端 URL fetch。
- Excel 匯出字串型 cell，沒有將使用者文字轉成 formula；目前輸出為 xlsx，未將 CSV formula injection 當成已成立漏洞。解析設定停用公式／HTML，有檔案大小與行數限制；壓縮解碼與主執行緒卡頓仍需強化。
- SQL migrations 對敏感資料表啟用 RLS、撤銷 anon/authenticated 權限；本次匿名線上探測確認拒絕。尚未驗證正式 catalog、其他 schema/table/view/function 或 authenticated 身分。
- 5xx 使用固定訊息和 requestId，不回傳堆疊、原始資料庫錯誤或提交密碼。

## 部署與營運仍須驗收

以下為待確認或強化事項，不列入已成立漏洞數量：

1. 從可正常存取的網路確認正式 HTML／API 的 HTTPS、HSTS、CSP、cookie、匿名拒絕與公開白名單；確認部署 SHA 對應受檢版本。
2. 以正式 Supabase catalog 和 authenticated 測試身分確認三張表、其他 views/functions、PUBLIC grants、migration 狀態及預設權限；避免僅憑匿名 401 宣稱全部 RLS 完成驗證。
3. 正式管理員 MFA、弱密碼／洩漏密碼防護、Email 確認、註冊政策、角色授權清單、停用與撤銷流程。
4. Cloudflare WAF／rate-limit 規則是否同時涵蓋自訂網域與 workers.dev；若不需要備用入口，關閉或套用一致規則。Node 多副本應改共享限流，代理後 req.ip 的配置須明確；重啟會清空目前 Node 計數。
5. 建立管理員名冊覆寫、刪除、密碼重設、抽籤與重設的稽核紀錄。現有 version 只有最後狀態，requestId 例外紀錄不能還原操作者及歷史變更。
6. 設定 session 過期清理排程、資料備份保存期間、加密與恢復演練；控管包含舊明文密碼的外部 Excel／JSON 備份。
7. 統一使用一種 lockfile 並固定 CI 安裝方式；目前存在 bun.lock／pnpm-lock.yaml，而 README 也列 npm install，缺 package-lock，npm 重新解析版本可能與本次受檢依賴不同。移除未使用依賴並持續掃描供應鏈。
8. `.env` 為本機必要敏感檔案且被忽略；本次未發現 Git 外洩證据，仍需避免分享整個資料夾或把憑證寫進報告／日誌。

## 修正與驗收順序

1. 修正 S01，補上額外 leaderId、跨 IP 同帳號及 Node／Workers 一致性的測試。
2. 釐清 S02 的公開資料政策；私有需求須改回個別憑證。修正 B01，確保不合法抽籤整筆不儲存。
3. 完成 MFA、全站標頭／CSP，以及匿名讀取和登入資源界限。
4. 補齊稽核紀錄、過期清理、部署與資料庫權限驗收。

本報告完成的是有證據的程式與設定審查、受控本機驗證及有限的線上唯讀檢查；未修改上述問題。現有測試全過不能取代新增缺陷測試與正式部署驗收。
