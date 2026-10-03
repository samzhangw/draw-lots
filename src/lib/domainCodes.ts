const DOMAIN_CODES = new Map([
  ['企業智慧化', 'A'],
  ['數位內容與多媒體應用', 'B'],
  ['網路應用與資通安全', 'C'],
  ['嵌入式系統與行動計算', 'D'],
  ['智慧運算創新應用', 'E'],
  ['智慧流通應用與研究', 'F'],
  ['進修部', 'G'],
]);

export function getDomainCode(field: string): string | undefined {
  const name = field.trim().replace(/^[A-G][.．]\s*/, '').replace(/[、，,]+$/, '').trim();
  return DOMAIN_CODES.get(name);
}

// The same namespace must be used for allocation and validation, including
// legacy custom-domain prefixes. Do not merge distinct group configurations.
export function getDrawCodeNamespace(field: string): string {
  return getDomainCode(field) ?? field.slice(0, 4);
}

export function domainCodeCollisionError(fields: Iterable<string>): string | null {
  const owners = new Map<string, string>();
  for (const field of fields) {
    const prefix = getDrawCodeNamespace(field);
    const previous = owners.get(prefix);
    if (previous !== undefined && previous !== field) {
      return `「${previous}」與「${field}」使用相同抽籤編號前綴「${prefix}」，會產生重複編號。請將領域別名統一為同一名稱，或為自訂領域設定不同的前四個字，再儲存或抽籤。`;
    }
    owners.set(prefix, field);
  }
  return null;
}
