# 套件漏洞修補（2026-10-22）

原先掃描的 8 筆已知漏洞已從本機依賴解析結果移除。pnpm audit 回報所有等級為 0，Bun audit 回傳空物件且成功結束。這代表本次掃描未命中已知公告，不代表應用程式其他風險已消除。未部署至正式網站。

## 變更

| 套件 | pnpm 修補前 | 修補後 |
| --- | --- | --- |
| vite | 8.3.1 | 8.3.5 |
| source-map-js | 1.2.1 | 1.2.2 |
| sharp | 0.35.4 | 0.35.5 |
| esbuild（直接開發依賴） | 0.25.12 | 0.28.2 |

- package.json 將 Vite 最低版本提高至 ^8.3.3，並將 esbuild 提高至 ^0.28.1 以符合新版 Vite 的 peer dependency。
- Miniflare 仍固定依賴舊 sharp，因此在 package.json 的 overrides（npm／Bun）及 pnpm-workspace.yaml 的 overrides 指定 sharp 0.35.5、source-map-js 1.2.2。兩處設定須維持一致；未額外加入不使用的直接依賴。
- 重新產生 pnpm-lock.yaml、bun.lock。兩個鎖定檔都解析到修補版本；各套件管理器的完整依賴樹不要求逐項相同。
- 本次未變更登入、限流或抽籤程式碼。

上游公告：[Vite](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)、[sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)。全部原始公告 ID 見修補前 audit JSON。

## 原始修補工作目錄的驗證

- pnpm audit --json：0 筆。證據：[JSON](evidence/dependency-audit-after-fix-2026-10-22.json)。
- Bun 1.4.4 audit --json：成功，{}。證據：[JSON](evidence/bun-audit-after-fix-2026-10-22.json)。Bun 透過 npm exec 執行，未做全域安裝。
- pnpm install --frozen-lockfile --ignore-scripts：通過。
- pnpm peers check：沒有 peer dependency 問題。
- pnpm run lint：通過。
- pnpm run build：通過。仍有原先 Vite configLoader 未來相容性警告。
- pnpm run deploy:check：通過，僅 dry-run，沒有部署。證據：[輸出](evidence/deploy-check-dependency-fix-2026-10-22.log)。
- pnpm test：143 個，141 通過、2 失敗，與修補前同為 tests/campusRateLimit.test.ts 的 Node／Workers 校網模式測試。證據：[輸出](evidence/test-results-dependency-fix-2026-10-22.log)。
- pnpm run test:cloudflare：3 個，2 通過、1 失敗。tests/backend.test.ts:523 要求同一 session 的 300 次請求都成功，但 server/rateLimit.ts:150 設定學生每分鐘 60 次，實際成功 60 次。這兩處程式與測試此次均未變更；原檢查沒有執行此 workerd 測試，因此不宣稱已做修補前的 workerd 對照。證據：[輸出](evidence/cloudflare-tests-dependency-fix-2026-10-22.log)。

上述測試失敗描述對應原始修補工作目錄，與本儲存庫自己的測試結果分開記錄。

## draw-lots 儲存庫推送前驗證

保留本儲存庫現有 README、校網文件、server/rateLimit.ts 與 ProjectRosterCard.tsx 差異，只套用依賴修補。

- pnpm install --frozen-lockfile --ignore-scripts：通過。
- pnpm run lint：通過。
- pnpm run build：通過。
- pnpm test：143 個全部通過。證據：[輸出](evidence/draw-lots-tests-dependency-fix-2026-10-22.log)。
- 本儲存庫沒有另外執行 workerd 整合測試；上方 workerd 輸出來自原始修補工作目錄。
