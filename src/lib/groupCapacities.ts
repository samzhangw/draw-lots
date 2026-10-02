export class LotteryAllocationError extends Error {}

export function validateGroupCapacities(value: unknown, groupCount: number, field: string): asserts value is Record<number, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== groupCount
    || Object.entries(value).some(([key, count]) => !/^[1-9]\d*$/.test(key)
      || Number(key) > groupCount || !Number.isInteger(count) || (count as number) < 0 || (count as number) > 2000)) {
    throw new LotteryAllocationError(`「${field}」請為每組設定 0 至 2000 件的整數，且件數設定須與組數一致。`);
  }
}
