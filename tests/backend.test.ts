import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, validateDomains, validateProjects } from '../server/store';
import { projectDto, hashPassword, verifyPassword, type StoredProject } from '../server/credentials';
import type { ProjectItem } from '../src/types';

const cloudflareTest = process.env.CLOUDFLARE_TEST === '1';
// Wrangler's local HTTPS certificate is self-signed; only this test process trusts it.
if (cloudflareTest) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const project: ProjectItem = {
  id: 'p1', seq_no: '1', education_system: '四技', department: '資管', class_name: '四甲',
  advisor: '王教授', field: '測試領域', original_code: 'P1', project_title: '完整欄位測試', leader_id: '12345678', password: 'Secure-password-123',
  assigned_group: null, draw_order: null, draw_code: null, draw_time: null, evaluators: [],
};
const domains = [{ id: 'd1', field: '測試領域', groupCount: 2, evaluatorsPerGroup: { 1: ['李教授'], 2: ['陳教授'] } }];

function assertStageWhitelist(data: any) {
  assert.deepEqual(Object.keys(data.projects[0]).sort(), ['assigned_group', 'draw_code', 'draw_order', 'field', 'id', 'project_title']);
  assert.deepEqual(Object.keys(data.domainConfigs[0]).sort(), ['field', 'groupCount', 'id']);
  assert.equal(data.projects[0].leader_id, undefined);
  assert.equal(data.projects[0].advisor, undefined);
  assert.equal(data.domainConfigs[0].evaluatorsPerGroup, undefined);
}

test('input validation rejects malformed rosters and domain settings', () => {
  validateProjects([project]); validateDomains(domains);
  assert.throws(() => validateProjects([project, project]));
  assert.throws(() => validateProjects([{ ...project, draw_order: -1 }]));
  assert.throws(() => validateProjects([{ ...project, password: {} }]));
  assert.throws(() => validateProjects([{ ...project, shared_password_mode: true }]));
  assert.throws(() => validateDomains([{ ...domains[0], groupCount: 0 }]));
  assert.throws(() => validateDomains([{ ...domains[0], evaluatorsPerGroup: { 1: 'bad' } }]));
});

test(`API persists through Supabase, enforces roles and detects concurrent writes (${cloudflareTest ? 'Workers' : 'Node'})`, { timeout: 300000 }, async () => {
  let state = { id: 1, projects: [] as StoredProject[], domain_configs: domains, version: 0, updated_at: new Date().toISOString() };
  let unavailable = false;
  let malformedState = false;
  const staffSessions = new Map<string, any>();
  const sessions = new Map<string, { token_hash: string; project_id: string; credential_version: string; expires_at: string }>();
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (unavailable) { res.writeHead(503); res.end(JSON.stringify({ message: 'private database detail: ntcust_lottery_state password=private-test' })); return; }
    if (url.pathname === '/auth/v1/token') {
      if (body.password !== 'valid-password') { res.writeHead(400); res.end(JSON.stringify({ message: 'Invalid login credentials', error_code: 'invalid_credentials' })); return; }
      const role = body.email.startsWith('admin') ? 'admin' : body.email.startsWith('stage') ? 'stage' : 'student';
      const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url')}.signature`;
      res.end(JSON.stringify({ access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, user: { id: role, email: body.email, app_metadata: { role } } })); return;
    }
    if (url.pathname === '/auth/v1/user') {
      try {
        const token = req.headers.authorization!.slice(7);
        const role = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
        if (!['admin', 'stage'].includes(role)) throw new Error();
        res.end(JSON.stringify({ id: role, email: `${role}@test.local`, app_metadata: { role } }));
      } catch { res.writeHead(401); res.end(JSON.stringify({ message: 'invalid token' })); }
      return;
    }
    if (url.pathname === '/rest/v1/ntcust_staff_sessions') {
      const key = url.searchParams.get('token_hash')?.replace('eq.', '');
      if (req.method === 'POST') { staffSessions.set(body.token_hash, { ...body, created_at: new Date().toISOString() }); res.writeHead(201); res.end('{}'); return; }
      if (req.method === 'DELETE') { if (key) staffSessions.delete(key); res.writeHead(204); res.end(); return; }
      res.end(JSON.stringify(key ? staffSessions.get(key) || null : null)); return;
    }
    if (url.pathname === '/rest/v1/ntcust_student_sessions') {
      const key = url.searchParams.get('token_hash')?.replace('eq.', '');
      if (req.method === 'POST') { sessions.set(body.token_hash, body); res.writeHead(201); res.end('{}'); return; }
      if (req.method === 'DELETE') { if (key) sessions.delete(key); res.writeHead(204); res.end(); return; }
      res.end(JSON.stringify(key ? sessions.get(key) || null : null)); return;
    }
    if (url.pathname === '/rest/v1/ntcust_lottery_state') {
      if (req.method === 'PATCH') {
        if (url.searchParams.get('version') !== `eq.${state.version}`) { res.end('null'); return; }
        state = { ...state, ...body };
      }
      res.end(JSON.stringify(malformedState ? { ...state, projects: null } : state)); return;
    }
    res.writeHead(404); res.end('{}');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockPort = (mock.address() as { port: number }).port;
  // Reserve an available app port, then release it immediately before spawning.
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const appPort = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const base = `${cloudflareTest ? 'https' : 'http'}://127.0.0.1:${appPort}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(appPort), SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SECRET_KEY: 'sb_secret_test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  const persistence = await mkdtemp(join(tmpdir(), 'lottery-worker-test-'));
  let child: ChildProcess;
  let output = '';
  const launch = async () => {
    const args = cloudflareTest ? [
      'node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', String(appPort), '--local-protocol', 'https', '--persist-to', persistence,
      '--var', `SUPABASE_URL:${env.SUPABASE_URL}`, '--var', `SUPABASE_SECRET_KEY:${env.SUPABASE_SECRET_KEY}`,
      '--var', `SUPABASE_PUBLISHABLE_KEY:${env.SUPABASE_PUBLISHABLE_KEY}`,
    ] : ['--import', 'tsx', 'server.ts'];
    child = spawn(process.execPath, args, { env: { ...env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    output = ''; child.stdout!.on('data', data => output += data); child.stderr!.on('data', data => output += data);
    for (let n = 0; n < 400; n++) {
      if (child.exitCode != null) throw new Error(output);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Server did not start: ${output}`);
  };
  const stop = async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } };
  const request = async (endpoint: string, body?: Record<string, unknown>, token?: string, cookie?: string) => {
    const res = await fetch(`${base}${endpoint}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...((token || cookie) ? { Cookie: [token, cookie].filter(Boolean).join('; ') } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().at(-1) };
  };
  try {
    await launch();
    if (cloudflareTest) {
      for (const page of ['/', '/admin', '/stage', '/student']) {
        const response = await fetch(`${base}${page}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /<div id="root">/);
      }
      const healthNavigation = await fetch(`${base}/api/health`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal((await healthNavigation.json() as any).status, 'ok');
    }
    const invalidJson = await fetch(`${base}/api/student/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"password":"do-not-echo-this"',
    });
    const invalidBody = await invalidJson.json();
    assert.equal(invalidJson.status, 400);
    assert.equal(JSON.stringify(invalidBody).includes('do-not-echo-this'), false);
    assert.equal(invalidJson.headers.get('cache-control'), 'no-store');
    assert.equal(invalidJson.headers.get('x-request-id'), invalidBody.requestId);
    const adminLogin = await request('/api/auth/verify', { username: 'admin@test.local', password: 'valid-password', targetView: 'admin' });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.accessToken, undefined);
    assert.match(adminLogin.cookie!, /HttpOnly/i);
    assert.match(adminLogin.cookie!, /Secure/i);
    assert.match(adminLogin.cookie!, /SameSite=Strict/i);
    assert.equal(adminLogin.cookie!.includes('Max-Age'), false);
    const admin = adminLogin.cookie!.split(';')[0];
    assert.equal(staffSessions.has(admin.split('=')[1]), false);
    assert.equal((await request('/api/auth/me', undefined, admin)).data.session.role, 'admin');
    assert.equal((await request('/api/preferences', undefined, admin)).status, 404);
    const staffRecord = [...staffSessions.values()].find(s => s.user_id === 'admin')!;
    const staffExpiry = staffRecord.expires_at;
    staffRecord.expires_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await request('/api/auth/me', undefined, admin)).status, 401);
    staffRecord.expires_at = staffExpiry;
    const bearerOnly = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${staffRecord.access_token}` } });
    assert.equal(bearerOnly.status, 401);
    const blockedStaffLogout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin, Origin: 'https://attacker.invalid' }, body: '{}' });
    assert.equal(blockedStaffLogout.status, 403);
    assert.equal((await request('/api/auth/me', undefined, admin)).status, 200);
    if (cloudflareTest) {
      const oversizedPasswordBatch = Array.from({ length: 101 }, (_, n) => ({ ...project, id: `batch-${n}`, leader_id: `batch-student-${n}` }));
      assert.equal((await request('/api/projects', { projects: oversizedPasswordBatch, version: 0 }, admin)).status, 400);
    }
    const stageLogin = await request('/api/auth/verify', { username: 'stage@test.local', password: 'valid-password', targetView: 'stage', remember: true });
    assert.match(stageLogin.cookie!, /Max-Age/i);
    const stage = stageLogin.cookie!.split(';')[0];
    assert.equal((await request('/api/auth/verify', { username: 'stage@test.local', password: 'valid-password', targetView: 'admin' })).status, 403);
    assert.equal((await request('/api/auth/verify', { username: 'admin', password: 'admin888', targetView: 'admin' })).status, 401);
    assert.equal((await request('/api/projects', { projects: [project], version: 0 })).status, 401);
    assert.equal((await request('/api/lottery/draw', { field: 'ALL', version: 0 })).status, 401);
    assert.equal((await request('/api/projects', { projects: [project], version: 0 }, stage)).status, 403);
    assert.equal((await request('/api/projects', { projects: [project] }, admin)).status, 400);
    assert.equal((await request('/api/projects', { projects: [project, project], version: 0 }, admin)).status, 400);
    let saved = await request('/api/projects', { projects: [project], version: 0 }, admin);
    assert.equal(saved.status, 200); assert.deepEqual(saved.data.projects[0], { ...projectDto(project), password_set: true });
    assert.equal(state.projects[0].password, undefined);
    assert.match(state.projects[0].password_hash!, /^scrypt-v1/);
    const firstHash = state.projects[0].password_hash;
    const second = { ...project, id: 'p2', leader_id: '87654321', original_code: 'P2', project_title: '另一位學生的私人專題', password: 'Another-password-456' };
    saved = await request('/api/projects', { projects: [saved.data.projects[0], second], version: saved.data.version }, admin);
    assert.equal(saved.status, 200); assert.equal(state.projects[0].password_hash, firstHash);
    assert.equal((await request('/api/projects', undefined, stage)).status, 403);
    assert.equal((await request('/api/domain-configs', undefined, stage)).status, 403);
    const stageState = await request('/api/state', undefined, stage);
    assert.equal(stageState.status, 200);
    assertStageWhitelist(stageState.data);
    assert.equal(stageState.data.projects[0].project_title, project.project_title);
    assert.equal((await request('/api/state', undefined, admin)).data.projects[0].leader_id, project.leader_id);
    for (const endpoint of ['/api/state', '/api/projects', '/api/domain-configs', '/api/student/me']) assert.equal((await request(endpoint)).status, 401);
    assert.deepEqual((await request('/api/public-results')).data.results, []);
    assert.equal((await request('/api/projects', { projects: [{ ...project, password: '5678' }], version: saved.data.version }, admin)).status, 400);
    assert.equal((await request('/api/projects', { projects: [{ ...project, password_hash: 'forged' }], version: saved.data.version }, admin)).status, 400);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: '5678' })).status, 401);
    const student = await request('/api/student/verify', { leaderId: project.leader_id, password: project.password });
    assert.equal(student.status, 200); assert.equal(student.data.project.password, undefined);
    assert.equal(student.data.project.password_hash, undefined);
    assert.equal(student.data.project.leader_id, project.leader_id);
    for (const field of ['seq_no', 'class_name', 'advisor', 'education_system', 'department']) assert.equal(student.data.project[field], '');
    assert.match(student.cookie!, /HttpOnly/i); assert.match(student.cookie!, /Secure/i); assert.match(student.cookie!, /SameSite=Strict/i);
    const studentCookie = student.cookie!.split(';')[0];
    const sessionToken = studentCookie.split('=')[1];
    assert.equal(sessions.has(sessionToken), false); // Supabase only holds token digests.
    if (cloudflareTest) {
      const results = await Promise.all(Array.from({ length: 300 }, () => request('/api/student/me', undefined, undefined, studentCookie)));
      assert.equal(results.filter(result => result.status === 200).length, 300);
    }
    const blockedLogout = await fetch(`${base}/api/student/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: studentCookie, Origin: 'https://attacker.invalid' }, body: '{}' });
    assert.equal(blockedLogout.status, 403);
    assert.equal((await request('/api/student/me?projectId=p2', undefined, undefined, studentCookie)).data.project.id, project.id);
    assert.equal((await request('/api/student/verify', { leaderId: second.leader_id, password: project.password })).status, 401);
    const otherStudent = await request('/api/student/verify', { leaderId: second.leader_id, password: second.password });
    assert.equal(otherStudent.data.project.id, second.id);
    const otherCookie = otherStudent.cookie!.split(';')[0];
    assert.equal((await request('/api/student/me?projectId=p1', undefined, undefined, otherCookie)).data.project.id, second.id);
    await request('/api/student/logout', {}, undefined, otherCookie);
    const initialSession = [...sessions.values()].find(s => s.project_id === project.id)!;
    const originalExpiry = initialSession.expires_at;
    initialSession.expires_at = new Date(Date.now() - 1).toISOString();
    assert.equal((await request('/api/student/me', undefined, undefined, studentCookie)).status, 401);
    initialSession.expires_at = originalExpiry;
    assert.equal((await request('/api/state', undefined, undefined, studentCookie)).status, 401);
    assert.equal((await request('/api/student/me', undefined, undefined, studentCookie.replace(/.$/, 'x'))).status, 401);
    assert.equal((await request('/api/projects', { projects: [], version: 0 }, admin)).status, 409);
    const draw = await request('/api/lottery/draw', { field: 'ALL', version: saved.data.version }, stage);
    assertStageWhitelist(draw.data);
    // A second device holding the pre-draw roster cannot overwrite draw results.
    const staleRoster = await request('/api/projects', { projects: saved.data.projects, version: saved.data.version }, admin);
    assert.equal(staleRoster.status, 409);
    assert.equal(state.version, draw.data.version);
    assert.ok(state.projects.every(p => p.draw_order));
    assert.equal(draw.status, 200); assert.ok(draw.data.projects[0].assigned_group); assert.ok(draw.data.projects[0].draw_order);
    assert.ok(state.projects[0].evaluators?.length); assert.equal(draw.data.projects[0].evaluators, undefined);
    assert.equal(state.projects[0].password, undefined);
    const publicDraw = (await request('/api/public-results')).data.results[0];
    assert.deepEqual(Object.keys(publicDraw).sort(), ['assigned_group', 'draw_code', 'draw_order', 'field', 'original_code']);
    const ownedDraw = await request('/api/student/me', undefined, undefined, studentCookie);
    assert.ok(ownedDraw.data.project.draw_order);
    assert.equal(ownedDraw.data.project.leader_id, project.leader_id);
    assert.equal((await request('/api/lottery/draw', { field: 'ALL', version: draw.data.version }, stage)).status, 409);
    const reviewers = await request('/api/domain-configs', { domainConfigs: [{ ...domains[0], evaluatorsPerGroup: { 1: ['新評審'], 2: ['新評審'] } }], version: draw.data.version }, admin);
    assert.equal(reviewers.status, 200); assert.deepEqual(reviewers.data.projects[0].evaluators, ['新評審']);
    const reset = await request('/api/lottery/reset', { field: 'ALL', version: reviewers.data.version }, stage);
    assertStageWhitelist(reset.data);
    assert.equal(reset.status, 200); assert.equal(reset.data.projects[0].assigned_group, null); assert.deepEqual(state.projects[0].evaluators, []);
    const renamed = await request('/api/domain-configs', { domainConfigs: [{ ...domains[0], field: '更名領域' }], renamedField: { oldName: '測試領域', newName: '更名領域' }, version: reset.data.version }, admin);
    assert.equal(renamed.status, 200); assert.equal(renamed.data.projects[0].field, '更名領域');
    if (cloudflareTest) for (let n = 0; n < 3; n++) {
      assert.equal((await request('/api/student/verify', { leaderId: 'restart-limit', password: 'incorrect' })).status, 401);
    }
    await stop(); await launch();
    if (cloudflareTest) {
      for (let n = 0; n < 7; n++) assert.equal((await request('/api/student/verify', { leaderId: 'restart-limit', password: 'incorrect' })).status, 401);
      assert.equal((await request('/api/student/verify', { leaderId: 'restart-limit', password: 'incorrect' })).status, 429);
    }
    assert.equal((await request('/api/state', undefined, admin)).data.projects[0].field, '更名領域');
    assert.equal((await request('/api/student/me', undefined, undefined, studentCookie)).status, 200);
    assert.equal((await request('/api/auth/me', undefined, admin)).status, 200);
    const previousHash = state.projects.find(p => p.id === project.id)!.password_hash;
    const changedPassword = await request('/api/projects', { projects: [{ ...renamed.data.projects.find((p: ProjectItem) => p.id === project.id), password: 'A-new-password-123' }], version: renamed.data.version }, admin);
    assert.equal(changedPassword.status, 200); assert.notEqual(state.projects.find(p => p.id === project.id)!.password_hash, previousHash);
    assert.equal((await request('/api/student/me', undefined, undefined, studentCookie)).status, 401);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: project.password })).status, 401);
    assert.equal(await verifyPassword('A-new-password-123', state.projects.find(p => p.id === project.id)!.password_hash), true);
    const newLogin = await request('/api/student/verify', { leaderId: project.leader_id, password: 'A-new-password-123' });
    assert.equal(newLogin.status, 200, JSON.stringify(newLogin.data));
    const newCookie = newLogin.cookie!.split(';')[0];
    assert.equal((await request('/api/student/logout', {}, undefined, newCookie)).status, 200);
    assert.equal((await request('/api/student/me', undefined, undefined, newCookie)).status, 401);
    const removedDomain = await request('/api/domain-configs', { domainConfigs: [], version: state.version }, admin);
    assert.equal(removedDomain.status, 200); assert.deepEqual(removedDomain.data.domainConfigs, []); assert.equal(removedDomain.data.projects[0].field, '未分類領域');
    // Two saves using the same version: exactly one can commit.
    const races = await Promise.all([request('/api/projects', { projects: [project], version: removedDomain.data.version }, admin), request('/api/projects', { projects: [], version: removedDomain.data.version }, admin)]);
    assert.deepEqual(races.map(x => x.status).sort(), [200, 409]);
    const latest = (await request('/api/state', undefined, admin)).data;
    const cleared = await request('/api/projects', { projects: [], version: latest.version }, admin);
    assert.equal(cleared.status, 200); assert.deepEqual(state.projects, []);
    unavailable = true;
    const offline = await request('/api/health');
    assert.equal(offline.status, 503);
    assert.equal(offline.data.error, '服務暫時無法使用，請稍後再試。');
    assert.ok(offline.data.requestId);
    assert.equal(JSON.stringify(offline.data).includes('ntcust_lottery_state'), false);
    assert.equal(JSON.stringify(offline.data).includes('private-test'), false);
    assert.equal((await request('/api/public-results')).status, 503);
    unavailable = false;
    malformedState = true;
    const unexpected = await request('/api/public-results');
    assert.equal(unexpected.status, 500);
    assert.equal(unexpected.data.error, '伺服器發生錯誤，請稍後再試。');
    assert.ok(unexpected.data.requestId);
    assert.equal(JSON.stringify(unexpected.data).includes('TypeError'), false);
    assert.equal(JSON.stringify(unexpected.data).includes('filter'), false);
    for (let attempt = 0; attempt < 10 && !output.includes(unexpected.data.requestId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(output.includes(unexpected.data.requestId));
    malformedState = false;
    // Real SDK store path preserves all optional fields; DB errors propagate.
    process.env.SUPABASE_URL = env.SUPABASE_URL; process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    const store = createStore(); const initial = await store.load();
    const full = { ...projectDto(project), password_hash: await hashPassword('Secure-password-123'), assigned_group: 2, draw_order: 1, draw_code: '第2組-序號01', draw_time: new Date().toISOString(), evaluators: ['陳教授'] };
    const fullSaved = await store.save({ ...initial, projects: [full] }, initial.version);
    assert.deepEqual(fullSaved.projects[0], full);
    await assert.rejects(store.save(initial, initial.version), /其他人更新/);
    unavailable = true;
    await assert.rejects(store.save(fullSaved, fullSaved.version), /無法儲存/);
    unavailable = false;
    const fields = ['__proto__', 'constructor', 'toString'];
    const dangerousNames = fields.map((field, index) => ({ ...projectDto(project), id: `special-${index}`, leader_id: `student-${index}`, field }));
    const uploaded = await request('/api/projects', { projects: dangerousNames, version: state.version }, admin);
    assert.equal(uploaded.status, 200);
    const configured = await request('/api/domain-configs', { domainConfigs: fields.map((field, index) => ({ id: uploaded.data.domainConfigs.find((c: { field: string }) => c.field === field).id, field, groupCount: index + 1 })), version: uploaded.data.version }, admin);
    assert.equal(configured.status, 200);
    const specialDraw = await request('/api/lottery/draw', { field: 'ALL', version: configured.data.version }, stage);
    assert.equal(specialDraw.status, 200);
    assert.deepEqual(new Set(specialDraw.data.projects.map((p: ProjectItem) => p.field)), new Set(fields));
    assert.ok(specialDraw.data.projects.every((p: ProjectItem) => p.draw_order && p.assigned_group));
    // Legacy credentials remain unusable even if SQL migration has not yet scrubbed them.
    state.projects = [{ ...project }];
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: project.password })).status, 401);
    const legacySave = await store.save(await store.load(), state.version);
    assert.equal(legacySave.projects[0].password, undefined);
    assert.equal(legacySave.projects[0].password_hash, undefined);
    // Rate limits prevent an unlimited student password guessing loop.
    let limited = false;
    for (let attempt = 0; attempt < 18; attempt++) {
      const response = await request('/api/student/verify', { leaderId: 'unknown', password: 'incorrect' });
      if (response.status === 429) { limited = true; break; }
    }
    assert.equal(limited, true);
    const logout = await request('/api/auth/logout', {}, admin);
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/auth/me', undefined, admin)).status, 401);
    assert.equal((await request('/api/state', undefined, admin)).status, 401);
    assert.equal((await request('/api/state', undefined, stage)).status, 200);
    const relogin = await request('/api/auth/verify', { username: 'admin@test.local', password: 'valid-password', targetView: 'admin' });
    assert.equal(relogin.status, 200);
    assert.equal((await request('/api/auth/me', undefined, relogin.cookie!.split(';')[0])).status, 200);
    const adminAgain = relogin.cookie!.split(';')[0];
    assert.equal((await request('/api/student/shared-password', { action: 'generate', version: state.version })).status, 401);
    assert.equal((await request('/api/student/shared-password', { action: 'generate', version: state.version }, stage)).status, 403);
    const generated = await request('/api/student/shared-password', { action: 'generate', version: state.version }, adminAgain);
    assert.equal(generated.status, 200);
    assert.match(generated.data.password, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(generated.data.sharedPasswordEnabled, true);
    assert.equal(generated.data.projects[0].password_hash, undefined);
    assert.equal(generated.data.projects[0].shared_password_mode, undefined);
    assert.equal(state.projects[0].shared_password_mode, true);
    assert.equal(await verifyPassword(generated.data.password, state.projects[0].password_hash), true);
    const commonLogin = await request('/api/student/verify', { leaderId: project.leader_id, password: generated.data.password });
    assert.equal(commonLogin.status, 200);
    assert.equal(commonLogin.data.sharedPasswordMode, true);
    assert.equal(commonLogin.data.project.project_title, project.project_title);
    assert.equal(commonLogin.data.project.leader_id, project.leader_id);
    assert.equal(commonLogin.data.project.advisor, '');
    const commonCookie = commonLogin.cookie!.split(';')[0];
    const commonMe = await request('/api/student/me', undefined, undefined, commonCookie);
    assert.equal(commonMe.data.project.project_title, project.project_title);
    assert.equal(commonMe.data.project.leader_id, project.leader_id);
    assert.equal((await request('/api/projects', { projects: [{ ...projectDto(project), password: 'Another-password-123' }], version: state.version }, adminAgain)).status, 400);
    const appended = await request('/api/projects', { projects: [projectDto(project), { ...projectDto(project), id: 'new', leader_id: 'new-student', project_title: '私人新專題' }], version: state.version }, adminAgain);
    assert.equal(appended.status, 200);
    assert.equal(state.projects[1].password_hash, state.projects[0].password_hash);
    assert.equal((await request('/api/student/verify', { leaderId: 'new-student', password: generated.data.password })).status, 200);
    const rotated = await request('/api/student/shared-password', { action: 'generate', version: state.version }, adminAgain);
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.password, generated.data.password);
    assert.match(rotated.data.password, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal((await request('/api/student/me', undefined, undefined, commonCookie)).status, 401);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: generated.data.password })).status, 401);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: rotated.data.password })).status, 200);
    const disabled = await request('/api/student/shared-password', { action: 'clear', version: state.version }, adminAgain);
    assert.equal(disabled.status, 200);
    assert.equal(disabled.data.sharedPasswordEnabled, false);
    assert.equal(state.projects[0].password_hash, undefined);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: rotated.data.password })).status, 401);
    const originalCodeSave = await request('/api/projects', {
      projects: [
        { ...projectDto(project), field: '企業智慧化', original_code: 'P-1' },
        { ...projectDto(project), id: 'code-2', leader_id: 'code-2', field: '企業智慧化', original_code: 'P-2' },
        { ...projectDto(project), id: 'code-3', leader_id: 'code-3', field: '進修部', original_code: 'P-3' },
      ], version: state.version,
    }, adminAgain);
    assert.equal(originalCodeSave.status, 200);
    assert.deepEqual(originalCodeSave.data.projects.map((p: ProjectItem) => p.original_code), ['A01', 'A02', 'G01']);
    assert.deepEqual(state.projects.map(p => p.original_code), ['A01', 'A02', 'G01']);
    // Existing database rows get the same codes on read, without mutating their version.
    state.projects[0].original_code = 'legacy';
    const codeVersion = state.version;
    assert.equal((await request('/api/state', undefined, adminAgain)).data.projects[0].original_code, 'A01');
    assert.equal(state.version, codeVersion);
    assert.equal(state.projects[0].original_code, 'legacy');
    const beforeReorder = (await request('/api/state', undefined, adminAgain)).data;
    const reorderedConfigs = [...beforeReorder.domainConfigs].reverse();
    const reordered = await request('/api/domain-configs', { domainConfigs: reorderedConfigs, version: beforeReorder.version }, adminAgain);
    assert.equal(reordered.status, 200);
    assert.deepEqual(reordered.data.domainConfigs, reorderedConfigs);
    assert.deepEqual(reordered.data.projects, beforeReorder.projects);
    assert.equal(reordered.data.version, beforeReorder.version + 1);
    assert.deepEqual((await request('/api/state', undefined, adminAgain)).data.domainConfigs, reorderedConfigs);
    assert.deepEqual((await request('/api/state', undefined, stage)).data.domainConfigs.map((c: { id: string }) => c.id), reorderedConfigs.map((c: { id: string }) => c.id));
    assert.equal((await request('/api/domain-configs', { domainConfigs: beforeReorder.domainConfigs, version: beforeReorder.version }, adminAgain)).status, 409);

    // Shrinking a domain must not strand drawn projects in a removed group.
    const shrinkField = '縮組測試';
    const shrinkUpload = await request('/api/projects', {
      projects: [1, 2, 3].map(n => ({ ...projectDto(project), id: `shrink-${n}`, leader_id: `shrink-${n}`, seq_no: String(n), field: shrinkField })),
      version: state.version,
    }, adminAgain);
    assert.equal(shrinkUpload.status, 200);
    const shrinkDraw = await request('/api/lottery/draw', { field: shrinkField, version: state.version }, stage);
    assert.equal(shrinkDraw.status, 200);
    assert.ok(state.projects.some(p => p.assigned_group === 2));
    const configsWithCount = (groupCount: number) => state.domain_configs.map(c => c.field === shrinkField ? { ...c, groupCount } : c);
    // Expanding, or removing only an empty group, preserves valid results.
    const drawnProjects = structuredClone(state.projects);
    assert.equal((await request('/api/domain-configs', { domainConfigs: configsWithCount(3), version: state.version }, adminAgain)).status, 200);
    assert.deepEqual(state.projects, drawnProjects);
    assert.equal((await request('/api/domain-configs', { domainConfigs: configsWithCount(2), version: state.version }, adminAgain)).status, 200);
    assert.deepEqual(state.projects, drawnProjects);
    const beforeInvalidShrink = structuredClone(state);
    const invalidShrink = await request('/api/domain-configs', { domainConfigs: configsWithCount(1), version: state.version }, adminAgain);
    assert.equal(invalidShrink.status, 409);
    assert.match(invalidShrink.data.error, /縮組測試.*第 2 組.*重設/);
    assert.deepEqual(state, beforeInvalidShrink);
    const afterInvalidShrink = (await request('/api/state', undefined, adminAgain)).data;
    assert.equal(afterInvalidShrink.version, beforeInvalidShrink.version);
    assert.deepEqual(afterInvalidShrink.domainConfigs, beforeInvalidShrink.domain_configs);
    assert.deepEqual(afterInvalidShrink.projects, drawnProjects.map(p => ({ ...projectDto(p), password_set: false })));
    // Resetting the affected domain makes the smaller configuration safe to save and draw.
    assert.equal((await request('/api/lottery/reset', { field: shrinkField, version: state.version }, stage)).status, 200);
    assert.equal((await request('/api/domain-configs', { domainConfigs: configsWithCount(1), version: state.version }, adminAgain)).status, 200);
    assert.equal((await request('/api/lottery/draw', { field: shrinkField, version: state.version }, stage)).status, 200);
    assert.ok(state.projects.every(p => p.assigned_group === 1));
    assert.deepEqual(state.projects.map(p => p.draw_order).sort(), [1, 2, 3]);
  } finally {
    await stop();
    await rm(persistence, { recursive: true, force: true });
    await new Promise<void>(resolve => mock.close(() => resolve()));
  }
});
