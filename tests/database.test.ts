import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const directory = new URL('../supabase/migrations/', import.meta.url);
const project = (id: string, leader = id) => ({
  id, leader_id: leader, seq_no: id, education_system: '四技', department: '資管',
  class_name: '甲', advisor: '王教授', field: '企業智慧化', original_code: `A${id}`,
  project_title: `專題 ${id}`, assigned_group: 2, draw_order: 1, draw_code: 'A01',
  draw_time: '2026-10-02T00:00:00.000Z', evaluators: ['李教授'],
  password_hash: `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(64)}`,
});
async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);');
  for (const file of (await readdir(directory)).sort().filter(file => file.endsWith('.sql') && !file.startsWith('20261002'))) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  return db;
}
async function migrate(db: PGlite) {
  await db.exec(await readFile(new URL('202610020001_project_rows.sql', directory), 'utf8'));
}
async function snapshot(db: PGlite): Promise<any> {
  return (await db.query<{ state: any }>('select public.ntcust_load_lottery_state() as state')).rows[0].state;
}
async function save(db: PGlite, projects: unknown[], domains: unknown[], version: number): Promise<any> {
  return (await db.query<{ state: any }>('select public.ntcust_save_lottery_state($1::jsonb, $2::jsonb, $3) as state',
    [JSON.stringify(projects), JSON.stringify(domains), version])).rows[0].state;
}

test('PostgreSQL migrates the roster and atomically persists indexed project rows', async () => {
  const db = await database();
  try {
    const projects = [project('01', '\t Student-A \u3000'), project('02', 'student-b')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb, version = 7', [JSON.stringify(projects)]);
    await migrate(db);
    const initial = await snapshot(db);
    assert.equal(initial.version, 7);
    assert.deepEqual(initial.projects, projects); // Includes hashes, reviewers and draw results.
    const rows = await db.query<{ id: string; leader_key: string }>('select id, leader_key from public.ntcust_projects order by position');
    assert.deepEqual(rows.rows, [{ id: '01', leader_key: 'student-a' }, { id: '02', leader_key: 'student-b' }]);
    const indexes = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename = 'ntcust_projects'");
    assert.ok(indexes.rows.some(row => row.indexdef.includes('UNIQUE INDEX') && row.indexdef.includes('(id)')));
    assert.ok(indexes.rows.some(row => row.indexdef.includes('UNIQUE INDEX') && row.indexdef.includes('(leader_key)')));
    // ID remains text: Excel imports are not restricted to UUID identifiers.
    assert.deepEqual((await db.query<{ document: unknown }>('select document from public.ntcust_projects where id = $1', ['01'])).rows[0].document, projects[0]);
    const configs = [...initial.domain_configs].reverse();
    const swapped = [{ ...projects[1], leader_id: projects[0].leader_id }, { ...projects[0], leader_id: projects[1].leader_id }];
    const saved = await save(db, swapped, configs, 7);
    assert.equal(saved.version, 8);
    assert.deepEqual((await snapshot(db)).projects, swapped);
    assert.deepEqual((await snapshot(db)).domain_configs, configs);
    await assert.rejects(save(db, projects, [], 7), (error: any) => error.code === '40001');
    assert.deepEqual(await snapshot(db), saved);
    // A failing row must roll back both the roster and settings/version.
    await assert.rejects(save(db, [project('03'), { ...project('04'), password: 'plaintext' }], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [project('03', ' SAME '), project('04', 'same')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [project('03'), project('03', 'other')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    await assert.rejects(save(db, [{ ...project('03'), shared_password_mode: true }, project('04')], [], 8));
    assert.deepEqual(await snapshot(db), saved);
    // Config-only saves do not rewrite unchanged project rows.
    const beforeXmin = (await db.query('select id, xmin::text as revision from public.ntcust_projects order by id')).rows;
    await save(db, swapped, configs, 8);
    assert.deepEqual((await db.query('select id, xmin::text as revision from public.ntcust_projects order by id')).rows, beforeXmin);
    await save(db, [swapped[0]], configs, 9);
    assert.equal((await snapshot(db)).projects.length, 1);
    await save(db, [], configs, 10);
    assert.deepEqual((await snapshot(db)).projects, []);
    // Only the backend may read rows or invoke the roster RPCs. Even its role
    // cannot bypass the transactional write path with an ordinary REST update.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.ntcust_projects'));
      await assert.rejects(db.query('select public.ntcust_load_lottery_state()'));
      await assert.rejects(save(db, [], [], 11));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual((await snapshot(db)).projects, []);
    await assert.rejects(db.query('delete from public.ntcust_projects'));
    await assert.rejects(db.query('update public.ntcust_lottery_state set version = 0'));
    assert.equal((await save(db, projects, configs, 11)).version, 12);
    await db.exec('reset role');
    const largeRoster = Array.from({ length: 2000 }, (_, n) => project(`large-${n}`));
    await save(db, largeRoster, configs, 12);
    await db.exec('analyze public.ntcust_projects');
    for (const key of ['id', 'leader_key']) {
      const plan = await db.query<Record<string, string>>(`explain select document from public.ntcust_projects where ${key} = $1`, ['large-1000']);
      assert.match(plan.rows.map(row => row['QUERY PLAN']).join('\n'), /Index Scan/);
    }
    const competingWrites = await Promise.allSettled([
      save(db, largeRoster.slice(0, 1), configs, 13),
      save(db, largeRoster.slice(1, 2), configs, 13),
    ]);
    assert.equal(competingWrites.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = competingWrites.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, '40001');
    assert.equal((await snapshot(db)).version, 14);

  } finally { await db.close(); }
});

test('failed migration preserves the old roster and does not leave half-created tables', async () => {
  const db = await database();
  try {
    const projects = [project('01', 'same'), project('02', ' SAME ')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb', [JSON.stringify(projects)]);
    await assert.rejects(migrate(db));
    await db.exec('rollback');
    assert.deepEqual((await db.query<{ projects: any }>('select projects from public.ntcust_lottery_state')).rows[0].projects, projects);
    assert.equal((await db.query<{ table: string | null }>("select to_regclass('public.ntcust_projects')::text as table")).rows[0].table, null);
  } finally { await db.close(); }
});

test('student lookup joins only the token owner, excludes expired/revoked sessions and restricts RPC access', async () => {
  const db = await database();
  try {
    const projects = [project('01'), project('02')];
    await db.query('update public.ntcust_lottery_state set projects = $1::jsonb', [JSON.stringify(projects)]);
    await migrate(db);
    await db.exec(await readFile(new URL('202610020002_student_lookup.sql', directory), 'utf8'));
    const token = 'a'.repeat(64); const expired = 'b'.repeat(64);
    await db.query("insert into public.ntcust_student_sessions values ($1, '02', 'credential-version', now() + interval '1 hour'), ($2, '01', 'expired-version', now() - interval '1 second')", [token, expired]);
    const lookup = async (key: string) => (await db.query<{ result: any }>('select public.ntcust_student_lookup($1) as result', [key])).rows[0].result;
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(lookup(token), (error: any) => error.code === '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual(await lookup(token), { project: projects[1], credential_version: 'credential-version' });
    assert.equal(await lookup(expired), null);
    assert.equal(await lookup('c'.repeat(64)), null);
    await db.exec('reset role');
    await db.query('delete from public.ntcust_student_sessions where token_hash = $1', [token]);
    await db.exec('set role service_role');
    assert.equal(await lookup(token), null);
    await db.exec('reset role');
  } finally { await db.close(); }
});
