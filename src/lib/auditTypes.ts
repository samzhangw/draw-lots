export const auditActionLabels = {
  login: '成功登入', logout: '成功登出', shared_password_generate: '產生共用密碼',
  shared_password_clear: '停用共用密碼', draw: '抽籤', reset: '重設抽籤結果',
} as const;
export type AuditAction = keyof typeof auditActionLabels;
export interface AuditRow {
  id: number | string; occurred_at: string; actor_email: string; actor_role: 'admin' | 'stage';
  action: AuditAction; details: { fields?: string[]; project_count?: number; version?: number; summary?: string };
}
