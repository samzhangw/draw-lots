import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseExcelFile, createExportWorkbook, createInputTemplateWorkbook, REQUIRED_INPUT_HEADERS, REQUIRED_OUTPUT_HEADERS } from '../src/lib/excel';
import { preserveImportedProjectIds } from '../src/lib/importProjects';

const row = { 序號: '1', 學制: '四技', 系所: '資管', 班級: '甲', 指導老師: '王教授', 領域: '企業智慧化', 編號: 'P1', 專題名稱: '中文測試', 組長學號: '12345678', 組長姓名: '林同學', 組長密碼: 'Strong-password-123' };
function makeFile(rows: Record<string, string>[]): File {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '名冊');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], '名冊.xlsx');
}
test('Excel import preserves configured letters and valid existing numbers', async () => {
  const configs = [{ id: 'a', field: row.領域, code: 'H', groupCount: 1 }];
  const parsed = await parseExcelFile(makeFile([{ ...row, 編號: 'H03' }, { ...row, 組長學號: '87654321', 編號: '' }]), configs);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.projects!.map(p => p.original_code), ['H03', 'H01']);
});
test('Excel imports session aliases, Chinese ordinals and full-width numeric labels', async () => {
  for (const header of ['分組場次', '場次', '報告場次', '組別']) {
    const values = ['1', '第２場次', '第一場次', '第十二場次', '第五十場次', ' 第 3 組 ', '第四場'];
    const parsed = await parseExcelFile(makeFile(values.map((value, index) => ({ ...row, 組長學號: `leader-${index}`, [header]: value }))));
    assert.equal(parsed.success, true, parsed.error);
    assert.deepEqual(parsed.projects!.map(p => p.assigned_group), [1, 2, 1, 12, 50, 3, 4]);
  }
});
test('Excel session import accepts missing values and rejects invalid or conflicting columns', async () => {
  for (const value of ['', '未抽籤', '待分配', '場次尚未提供']) {
    const parsed = await parseExcelFile(makeFile([{ ...row, 分組場次: value }]));
    assert.equal(parsed.success, true, parsed.error);
    assert.equal(parsed.projects![0].assigned_group, null);
  }
  for (const value of ['0', '-1', '1.5', '51', '第零場次', 'abc']) {
    const parsed = await parseExcelFile(makeFile([{ ...row, 分組場次: value }]));
    assert.equal(parsed.success, false);
    assert.match(parsed.error!, /第 2 列場次格式不正確/);
  }
  const compatible = await parseExcelFile(makeFile([{ ...row, 分組場次: '第一場次', 場次: '1', 報告場次: '' }]));
  assert.equal(compatible.success, true, compatible.error);
  assert.equal(compatible.projects![0].assigned_group, 1);
  const conflicting = await parseExcelFile(makeFile([{ ...row, 分組場次: '1', 場次: '2' }]));
  assert.equal(conflicting.success, false);
  assert.match(conflicting.error!, /第 2 列的場次欄位不一致/);
});
test('exported session labels survive Excel reimport and stable-ID reconciliation', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const original = { ...base, assigned_group: 12, draw_code: 'A03', draw_order: 3 };
  const bytes = XLSX.write(createExportWorkbook([original]), { type: 'array', bookType: 'xlsx' });
  const parsed = await parseExcelFile(new File([bytes], 'results.xlsx'));
  assert.equal(parsed.success, true, parsed.error);
  const reconciled = preserveImportedProjectIds(parsed.projects!, [original]);
  assert.equal(reconciled[0].assigned_group, 12);
  assert.equal(reconciled[0].id, original.id);
  assert.equal(reconciled[0].draw_code, 'A03');
});
test('patched SheetJS imports Chinese rosters and exports without credential fields', async () => {
  assert.equal(XLSX.version, '0.20.3');
  const parsed = await parseExcelFile(makeFile([row]));
  assert.equal(parsed.success, true); assert.equal(parsed.projects![0].project_title, '中文測試');
  assert.equal(parsed.projects![0].password, row.組長密碼);
  assert.equal(parsed.projects![0].leader_name, '林同學');
  assert.equal(parsed.projects![0].original_code, 'A01');
  const wb = createExportWorkbook(parsed.projects!);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const readback = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(readback.Sheets[readback.SheetNames[0]]);
  assert.deepEqual(Object.keys(rows[0]), REQUIRED_OUTPUT_HEADERS);
  assert.equal(rows[0].專題名稱, '中文測試'); assert.equal(rows[0].組長密碼, undefined);
  assert.equal(rows[0].組長姓名, '林同學');
  assert.equal(rows[0].編號, 'A01');
  assert.equal(rows[0].password_hash, undefined);
});
test('imports never invent predictable passwords and reject weak passwords or excessive files', async () => {
  const blank = await parseExcelFile(makeFile([{ ...row, 組長密碼: '' }]));
  assert.equal(blank.success, true); assert.equal(blank.projects![0].password, '');
  const weak = await parseExcelFile(makeFile([{ ...row, 組長密碼: '5678' }]));
  assert.equal(weak.success, false);
  const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'oversized.xlsx');
  assert.equal((await parseExcelFile(oversized)).success, false);
  assert.equal((await parseExcelFile(makeFile(Array.from({ length: 2001 }, () => row)))).success, false);
});

test('replacing a roster keeps stable IDs for matching student leaders', async () => {
  const before = (await parseExcelFile(makeFile([row]))).projects!;
  const next = (await parseExcelFile(makeFile([{ ...row, 專題名稱: '更新專題' }, { ...row, 組長學號: 'new-leader', 專題名稱: '新專題' }]))).projects!;
  const reconciled = preserveImportedProjectIds(next, before);
  assert.equal(reconciled[0].id, before[0].id);
  assert.equal(reconciled[0].project_title, '更新專題');
  assert.equal(reconciled[1].id, next[1].id);
});

test('exported file follows drawn codes numerically across domains and puts undrawn rows last', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const codes = ['G01', 'B03', 'A100', 'B01', 'A03', 'A99', 'A01', 'A02', 'B02', 'C01', 'D01', 'E01', 'F01'];
  const projects = codes.map((code, i) => ({
    ...base, id: `export-${i}`, seq_no: String(codes.length - i), original_code: `X${String(i + 1).padStart(2, '0')}`,
    draw_order: 1, draw_code: code, assigned_group: i === 0 ? 12 : 2,
  }));
  const roster = [...projects, { ...base, id: 'undrawn-z', original_code: 'Z01', draw_order: null, draw_code: null }, { ...base, id: 'undrawn-a', original_code: 'A01', draw_order: null, draw_code: null }];
  const before = structuredClone(roster);
  const bytes = XLSX.write(createExportWorkbook(roster), { type: 'array', bookType: 'xlsx' });
  const workbook = XLSX.read(bytes, { type: 'array' });
  const exported = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
  assert.deepEqual(exported.map(p => p['+編號(抽籤後)']), ['A01', 'A02', 'A03', 'A99', 'A100', 'B01', 'B02', 'B03', 'C01', 'D01', 'E01', 'F01', 'G01', '未抽籤', '未抽籤']);
  assert.deepEqual(exported.slice(-2).map(p => p.編號), ['A01', 'Z01']);
  assert.deepEqual(exported.map(p => p.場次), [...Array(12).fill('第二場次'), '第十二場次', '未抽籤', '未抽籤']);
  assert.deepEqual(roster, before);
});

test('drawn projects without an assigned session export an explicit missing-session label', async () => {
  const base = (await parseExcelFile(makeFile([row]))).projects![0];
  const workbook = createExportWorkbook([{ ...base, draw_code: 'A01', draw_order: 1, assigned_group: null }]);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const exported = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
  assert.equal(exported[0].場次, '場次尚未提供');
  assert.equal(sheet['!cols']?.length, REQUIRED_OUTPUT_HEADERS.length);
});


test('download template includes leader names and imports them back', async () => {
  const bytes = XLSX.write(createInputTemplateWorkbook(), { type: 'array', bookType: 'xlsx' });
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const cells = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  assert.deepEqual(cells[0], REQUIRED_INPUT_HEADERS);
  const parsed = await parseExcelFile(new File([bytes], 'template.xlsx'));
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.projects!.map(p => p.leader_name), ['王小明', '陳小華']);
});

test('empty result export retains all headers including leader name', () => {
  const workbook = createExportWorkbook([]);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.deepEqual(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0], REQUIRED_OUTPUT_HEADERS);
});
