export function isPageAssetError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return /ChunkLoadError|Loading chunk .+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i.test(message);
}

export function pageFailureMessage(error: unknown, online: boolean) {
  if (!online) return { title: '目前沒有網路連線', description: '請確認 Wi-Fi 或行動網路，恢復連線後再重新載入。' };
  if (isPageAssetError(error)) return { title: '頁面檔案載入失敗', description: '網站可能已更新版本，或網路暫時中斷。請重新載入以取得最新頁面。' };
  return { title: '頁面暫時無法顯示', description: '畫面發生錯誤，請重新載入後再試。若問題持續，請聯絡大會工作人員。' };
}
