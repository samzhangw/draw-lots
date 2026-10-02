import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdvisorConflict, normalizeProfessorName } from '../src/lib/lottery';
import { ApiError, validateDomains } from '../server/store';

const invalidNames = ['', ' \t\n　', '教授', '副教授', '助理教授', '特聘教授', '老師', '博士', '教授 老師'];

test('empty or title-only names never create advisor conflicts on either side', () => {
  for (const name of invalidNames) {
    assert.equal(normalizeProfessorName(name), '');
    assert.equal(isAdvisorConflict('王建宏教授', [name]), false, `invalid evaluator: ${JSON.stringify(name)}`);
    assert.equal(isAdvisorConflict(name, ['王建宏教授']), false, `invalid advisor: ${JSON.stringify(name)}`);
    assert.equal(isAdvisorConflict(name, [name]), false);
  }
  assert.equal(isAdvisorConflict('王建宏教授', [...invalidNames, '李美玲教授']), false);
  assert.equal(isAdvisorConflict('王建宏教授', [...invalidNames, '王建宏副教授']), true);
});

test('real advisor conflicts still match across titles and whitespace', () => {
  assert.equal(isAdvisorConflict(' 王 建宏 教授 ', ['王建宏副教授']), true);
  assert.equal(isAdvisorConflict('王建宏博士、李美玲老師', ['李美玲助理教授']), true);
  assert.equal(isAdvisorConflict('王建宏教授', ['李美玲副教授']), false);
  assert.equal(isAdvisorConflict('王建宏教授', []), false);
});

test('domain validation rejects invalid reviewer names but permits empty reviewer lists', () => {
  const domain = { id: 'd1', field: '企業智慧化', groupCount: 2 };
  for (const name of invalidNames) {
    assert.throws(() => validateDomains([{ ...domain, evaluatorsPerGroup: { 1: ['李美玲教授'], 2: [name] } }]),
      (error: unknown) => error instanceof ApiError && error.status === 400 && /企業智慧化.*第 2 組.*姓名/.test(error.message));
  }
  validateDomains([{ ...domain, evaluatorsPerGroup: { 1: [], 2: [' 王建宏副教授 ', '李美玲老師'] } }]);
});
