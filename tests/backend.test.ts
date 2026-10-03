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
import type { ProjectItem, DomainConfig } from '../src/types';

const cloudflareTest = process.env.CLOUDFLARE_TEST === '1';
// Wrangler's local HTTPS certificate is self-signed; only this test process trusts it.
if (cloudflareTest) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const project: ProjectItem = {
  id: 'p1', seq_no: '1', education_system: '四技', department: '資管', class_name: '四甲',
  advisor: '王教授', field: '測試領域', original_code: 'P1', project_title: '完整欄位測試', leader_id: '12345678', password: 'Secure-password-123',
  assigned_group: null, draw_order: null, draw_code: null, draw_time: null, evaluators: [],
};
const domains: DomainConfig[] = [{ id: 'd1', field: '測試領域', groupCount: 2, evaluatorsPerGroup: { 1: ['李教授'], 2: ['陳教授'] } }];

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

test('evaluator group keys must be canonical integers within the configured group count', () => {
  for (const group of ['0', '-1', '3', '50', '01', '1.5', '1e0', ' 1', '', '999999999999999999999999']) {
    assert.throws(() => validateDomains([{ ...domains[0], evaluatorsPerGroup: { [group]: ['李教授'] } }]), /僅設定 2 組.*無效組別/);
  }
  validateDomains([{ ...domains[0], evaluatorsPerGroup: { 1: ['李教授'], 2: ['陳教授'] } }]);
  validateDomains([{ ...domains[0], groupCount: 50, evaluatorsPerGroup: { 50: ['李教授'] } }]);
  for (const evaluatorsPerGroup of ['invalid', [], { 1: 'invalid' }, { 1: [123] }]) {
    assert.throws(() => validateDomains([{ ...domains[0], evaluatorsPerGroup }]), /評審設定格式不正確/);
  }
});

test(`API persists through Supabase, enforces roles and detects concurrent writes (${cloudflareTest ? 'Workers' : 'Node'})`, { timeout: 300000 }, async () => {
  let state = { id: 1, projects: [] as StoredProject[], domain_configs: domains, version: 0, updated_at: new Date().toISOString() };
  let unavailable = false;
  let malformedState = false;
  let rosterReads = 0;
  let databaseRequests = 0;
  let indexedReads = 0;
  let studentLookupReads = 0;
  let missingLookup = false;
  let changedSharedCredential: 'hash' | 'leader' | undefined;
  let publicReads = 0;
  let metadataReads = 0;
  let activeCapacityReads = 0;
  let maxCapacityReads = 0;
  let capacityWait: Promise<void> = Promise.resolve();
  let releaseCapacity = () => {};
  let legacySchema = false;
  const staffSessions = new Map<string, any>();
  const sessions = new Map<string, { token_hash: string; project_id: string; credential_version: string; expires_at: string }>();
  const mock = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/rest/v1/')) databaseRequests++;
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
    if (legacySchema && url.pathname.startsWith('/rest/v1/rpc/ntcust_')) {
      res.writeHead(404); res.end(JSON.stringify({ code: 'PGRST202', message: 'function not found' })); return;
    }
    if (legacySchema && url.pathname === '/rest/v1/ntcust_projects') {
      res.writeHead(404); res.end(JSON.stringify({ code: 'PGRST205', message: 'table not found' })); return;
    }
    if (url.pathname === '/rest/v1/rpc/ntcust_student_lookup') {
      if (missingLookup) { res.writeHead(404); res.end(JSON.stringify({ code: 'PGRST202' })); return; }
      studentLookupReads++;
      const session = sessions.get(body.p_token_hash);
      const p = session && Date.parse(session.expires_at) > Date.now() ? state.projects.find(p => p.id === session.project_id) : undefined;
      res.end(JSON.stringify(p ? { project: p, credential_version: session!.credential_version } : null)); return;
    }
    if (url.pathname === '/rest/v1/ntcust_lottery_state') {
      if (req.method === 'HEAD') {
        metadataReads++; res.setHeader('Content-Range', '0-0/1'); res.end(); return;
      }
      if (url.searchParams.get('select') === 'version') {
        metadataReads++; res.end(JSON.stringify({ version: state.version })); return;
      }
      rosterReads++;
      if (req.method === 'PATCH') {
        if (url.searchParams.get('version') !== `eq.${state.version}`) { res.end('null'); return; }
        state = { ...state, ...body };
      }
      res.end(JSON.stringify(state)); return;
    }
    if (url.pathname === '/rest/v1/rpc/ntcust_load_lottery_state') {
      rosterReads++;
      res.end(JSON.stringify(malformedState ? { ...state, projects: null } : state)); return;
    }
    if (url.pathname === '/rest/v1/rpc/ntcust_save_lottery_state') {
      if (body.p_expected_version !== state.version) {
        res.writeHead(409); res.end(JSON.stringify({ code: '40001', message: 'version conflict' })); return;
      }
      state = { ...state, projects: body.p_projects, domain_configs: body.p_domain_configs,
        version: state.version + 1, updated_at: new Date().toISOString() };
      res.end(JSON.stringify(state)); return;
    }
    if (url.pathname === '/rest/v1/ntcust_projects') {
      if (url.searchParams.get('select') !== 'document') {
        publicReads++;
        assert.equal(url.searchParams.get('document->>draw_order'), 'not.is.null');
        assert.equal(url.searchParams.get('order'), 'position.asc');
        assert.equal(url.searchParams.get('select')?.includes('password'), false);
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 500);
        const rows = state.projects.filter(p => p.draw_order).slice(offset, offset + limit).map(p => ({
          field: p.field, original_code: p.original_code, assigned_group: p.assigned_group,
          draw_order: p.draw_order, draw_code: p.draw_code,
        }));
        res.end(JSON.stringify(malformedState ? null : rows)); return;
      }
      indexedReads++;
      const id = url.searchParams.get('id')?.slice(3);
      const leader = url.searchParams.get('leader_key')?.slice(3);
      if (leader?.startsWith('capacity-')) {
        activeCapacityReads++;
        maxCapacityReads = Math.max(maxCapacityReads, activeCapacityReads);
        try { await capacityWait; } finally { activeCapacityReads--; }
      }

      const row = state.projects.find(p => id !== undefined ? p.id === id : p.leader_id.trim().toLowerCase() === leader);
      const currentRow = row && id !== undefined && changedSharedCredential
        ? { ...row, ...(changedSharedCredential === 'hash' ? { password_hash: 'changed-credential-version' } : { leader_id: 'changed-leader' }) } : row;
      res.end(JSON.stringify(currentRow ? { document: currentRow } : null)); return;
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
  const readJson = async (res: Response) => {
    const body = await res.text();
    try { return JSON.parse(body); } catch { throw new Error(`Invalid JSON response ${res.url} (${res.status}): ${body.slice(0, 300)}\n${output}`); }
  };
  const request = async (endpoint: string, body?: Record<string, unknown>, token?: string, cookie?: string) => {
    const res = await fetch(`${base}${endpoint}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...((token || cookie) ? { Cookie: [token, cookie].filter(Boolean).join('; ') } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await readJson(res), cookie: res.headers.getSetCookie().at(-1), retryAfter: res.headers.get('retry-after') };
  };
  try {
    await launch();
    const beforeForgedCookies = databaseRequests;
    for (const fake of ['1'.repeat(64), `${'2'.repeat(64)}.${'3'.repeat(64)}`]) {
      for (const endpoint of ['/api/student/me', '/api/auth/me', '/api/state', '/api/projects', '/api/domain-configs']) {
        const cookie = endpoint === '/api/student/me' ? `ntcust_student_session=${fake}` : `ntcust_staff_session=${fake}`;
        assert.equal((await request(endpoint, undefined, undefined, cookie)).status, 401);
      }
      for (const scope of ['student', 'staff']) {
        const endpoint = scope === 'student' ? '/api/student/logout' : '/api/auth/logout';
        assert.equal((await request(endpoint, {}, undefined, `ntcust_${scope}_session=${fake}`)).status, 200);
      }
    }
    assert.equal(databaseRequests, beforeForgedCookies, 'unsigned and forged cookies must never query/delete database sessions');
    if (cloudflareTest) {
      for (const iconPath of ['/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/android-chrome-192x192.png', '/android-chrome-512x512.png']) {
        const icon = await fetch(`${base}${iconPath}`);
        assert.equal(icon.status, 200);
        assert.match(icon.headers.get('content-type')!, /^image\//);
        assert.ok((await icon.arrayBuffer()).byteLength > 0);
      }
      const manifest = await fetch(`${base}/site.webmanifest`);
      assert.equal(manifest.status, 200);
      assert.equal((await manifest.json() as any).short_name, '專題成果展');
      const robots = await fetch(`${base}/robots.txt`);
      assert.equal(robots.status, 200);
      assert.match(robots.headers.get('content-type')!, /^text\/plain/);
      assert.equal(robots.headers.get('cache-control'), 'no-cache');
      const robotsText = await robots.text();
      assert.match(robotsText, /^User-agent: \*\nAllow: \/\n/);
      assert.match(robotsText, /Disallow: \/admin/);
      assert.doesNotMatch(robotsText, /<html|<!doctype/i);
      for (const page of ['/', '/admin', '/stage', '/student']) {
        const response = await fetch(`${base}${page}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-cache');
        const html = await response.text();
        assert.match(html, /<div id="root">/);
        if (page === '/') {
          const script = html.match(/src="(\/assets\/[^"\s]+\.js)"/);
          assert.ok(script, 'built HTML must reference its versioned entry module');
          const asset = await fetch(`${base}${script[1]}`);
          assert.equal(asset.status, 200);
          assert.match(asset.headers.get('cache-control')!, /immutable/);
          await asset.arrayBuffer();
        }
      }
      const missingAsset = await fetch(`${base}/assets/previous-version-missing.js`);
      assert.equal(missingAsset.status, 404);
      assert.equal(missingAsset.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(missingAsset.headers.get('content-type')!, /html/);
      const healthNavigation = await fetch(`${base}/api/health`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal((await readJson(healthNavigation) as any).status, 'ok');
    }
    const invalidJson = await fetch(`${base}/api/student/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"password":"do-not-echo-this"',
    });
    const invalidBody = await readJson(invalidJson);
    assert.equal(invalidJson.status, 400);
    assert.equal(JSON.stringify(invalidBody).includes('do-not-echo-this'), false);
    assert.equal(invalidJson.headers.get('cache-control'), 'no-store');
    assert.equal(invalidJson.headers.get('x-request-id'), invalidBody.requestId);
    for (const endpoint of ['/api/student/verify', '/api/auth/verify', '/api/STUDENT/VERIFY/']) {
      const oversized = await request(endpoint, { leaderId: 'test', username: 'test', password: 'x'.repeat(5000), targetView: 'admin' });
      assert.equal(oversized.status, 413);
    }
    const adminLogin = await request('/api/auth/verify', { username: 'admin@test.local', password: 'valid-password', targetView: 'admin' });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.accessToken, undefined);
    assert.match(adminLogin.cookie!, /HttpOnly/i);
    assert.match(adminLogin.cookie!, /Secure/i);
    assert.match(adminLogin.cookie!, /SameSite=Strict/i);
    assert.equal(adminLogin.cookie!.includes('Max-Age'), false);
    const admin = adminLogin.cookie!.split(';')[0];
    assert.match(admin, /^ntcust_staff_session=[a-f0-9]{64}\.[a-f0-9]{64}$/);
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
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await request('/api/auth/verify', {
        username: attempt % 2 ? 'admin-limit@test.local' : ' ADMIN-LIMIT@test.local ',
        password: 'wrong-password', targetView: 'admin', leaderId: `ignored-${attempt}`,
      })).status, 401);
    }
    const blockedExtraField = await request('/api/auth/verify', {
      username: 'admin-limit@test.local', password: 'wrong-password', targetView: 'admin', leaderId: {},
    });
    assert.equal(blockedExtraField.status, 429);
    assert.equal((await request('/api/auth/verify', {
      username: {}, password: 'wrong-password', targetView: 'admin', leaderId: 'valid-extra',
    })).status, 400);

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
    const beforeAnonymousRosterReads = rosterReads;
    const beforePublicReads = publicReads;
    assert.deepEqual((await request('/api/public-results')).data.results, []);
    await Promise.all(Array.from({ length: 20 }, () => request('/api/public-results')));
    assert.equal(publicReads - beforePublicReads, 1, 'cache must coalesce repeated public queries');
    assert.equal(rosterReads, beforeAnonymousRosterReads, 'public queries must not load roster documents');
    assert.ok(metadataReads > 0);
    const beforeHealthRosterReads = rosterReads;
    assert.deepEqual((await request('/api/health')).data, { status: 'ok' });
    assert.equal(rosterReads, beforeHealthRosterReads, 'health must not load roster documents');
    assert.equal((await request('/api/projects', { projects: [{ ...project, password: '5678' }], version: saved.data.version }, admin)).status, 400);
    assert.equal((await request('/api/projects', { projects: [{ ...project, password_hash: 'forged' }], version: saved.data.version }, admin)).status, 400);
    assert.equal((await request('/api/student/verify', { leaderId: project.leader_id, password: '5678' })).status, 401);
    const readsBeforeLogin = rosterReads;
    const student = await request('/api/student/verify', { leaderId: `  ${project.leader_id}  `, password: project.password });
    assert.equal(rosterReads, readsBeforeLogin, 'student login must not read the full roster');
    assert.equal(student.status, 200); assert.equal(student.data.project.password, undefined);
    assert.equal(student.data.project.password_hash, undefined);
    assert.equal(student.data.project.leader_id, project.leader_id);
    for (const field of ['seq_no', 'class_name', 'advisor', 'education_system', 'department']) assert.equal(student.data.project[field], '');
    assert.match(student.cookie!, /HttpOnly/i); assert.match(student.cookie!, /Secure/i); assert.match(student.cookie!, /SameSite=Strict/i);
    const studentCookie = student.cookie!.split(';')[0];
    assert.match(studentCookie, /^ntcust_student_session=[a-f0-9]{64}\.[a-f0-9]{64}$/);
    const sessionToken = studentCookie.split('=')[1];
    assert.equal(sessions.has(sessionToken), false); // Supabase only holds token digests.
    const readsBeforeLookup = rosterReads;
    const indexedBeforeLookup = indexedReads;
    const rpcBeforeLookup = studentLookupReads;
    const lookupCount = cloudflareTest ? 300 : 20;
    const settledLookups = await Promise.allSettled(Array.from({ length: lookupCount }, () => request('/api/student/me', undefined, undefined, studentCookie)));
    const lookupFailures = settledLookups.filter(result => result.status === 'rejected');
    assert.equal(lookupFailures.length, 0, `lookup failures: ${lookupFailures.map(result => String((result as PromiseRejectedResult).reason)).join('; ')}`);
    const results = settledLookups.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof request>>>).value);
    assert.equal(results.filter(result => result.status === 200).length, lookupCount);
    assert.equal(rosterReads, readsBeforeLookup, 'student lookup must not read the full roster');
    assert.equal(indexedReads, indexedBeforeLookup, 'lookup RPC must not trigger another project query');
    assert.equal(studentLookupReads - rpcBeforeLookup, lookupCount);
    missingLookup = true;
    assert.equal((await request('/api/student/me', undefined, undefined, studentCookie)).status, 200);
    assert.equal(indexedReads - indexedBeforeLookup, 1, 'missing migration must use the indexed fallback');
    missingLookup = false;
    assert.ok(results.every(result => result.data.project.leader_id === project.leader_id));
    capacityWait = new Promise<void>(resolve => { releaseCapacity = resolve; });
    let busyResponses = 0;
    const loginBurst = Promise.all(Array.from({ length: 50 }, (_, n) =>
      request('/api/student/verify', { leaderId: `capacity-${n}`, password: 'incorrect' }).then(result => {
        if (result.status === 503) { busyResponses++; assert.equal(result.retryAfter, '2'); }
        return result;
      })
    ));
    try {
      for (let n = 0; n < 100 && activeCapacityReads < 16; n++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(activeCapacityReads, 16, 'queued logins must keep database work at the active limit');
      assert.equal(busyResponses, 0, 'a 50-student burst must fit in the expanded login queue');
      const duringOverload = await Promise.all(Array.from({ length: 20 }, () => request('/api/student/me', undefined, undefined, studentCookie)));
      assert.ok(duringOverload.every(result => result.status === 200), 'lookup must remain available during login overload');
    } finally { releaseCapacity(); }
    const burstResults = await loginBurst;
    assert.ok(burstResults.every(result => result.status === 401 || result.status === 503));
    assert.ok(maxCapacityReads <= 16, 'login admission must bound concurrent database requests across API objects');

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
    // Invalid reviewer names must not overwrite existing settings or drawn results.
    const beforeInvalidReviewers = structuredClone(state);
    for (const name of ['', '　 ', '教授', '副教授']) {
      const invalidReviewers = await request('/api/domain-configs', {
        domainConfigs: [{ ...domains[0], evaluatorsPerGroup: { 1: ['李教授'], 2: [name] } }],
        version: state.version,
      }, admin);
      assert.equal(invalidReviewers.status, 400);
      assert.match(invalidReviewers.data.error, /測試領域.*第 2 組.*姓名/);
      assert.deepEqual(state, beforeInvalidReviewers);
    }
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
    // Deployment can precede the SQL migration without taking the site offline.
    legacySchema = true;
    const legacySnapshot = await store.load();
    assert.equal(legacySnapshot.version, fullSaved.version);
    assert.deepEqual(await store.findProject('id', full.id), full);
    assert.deepEqual(await store.findProject('leader_key', full.leader_id.toLowerCase()), full);
    const adapterSaved = await store.save(legacySnapshot, legacySnapshot.version);
    assert.equal(adapterSaved.version, legacySnapshot.version + 1);
    await assert.rejects(store.save(legacySnapshot, legacySnapshot.version), /其他人更新/);
    legacySchema = false;
    assert.deepEqual(await store.load(), adapterSaved);
    const largePublicRoster = Array.from({ length: 1200 }, (_, n) => ({ ...full, id: `public-${n}`, leader_id: `public-${n}`, original_code: `P${n}` }));
    const largeSaved = await store.save({ ...adapterSaved, projects: largePublicRoster }, adapterSaved.version);
    const beforeLargeReads = publicReads;
    const publicRosterReads = rosterReads;
    const largePublic = await request('/api/public-results');
    assert.equal(largePublic.status, 200);
    assert.equal(largePublic.data.results.length, 1200);
    assert.equal(publicReads - beforeLargeReads, 3);
    assert.equal(rosterReads, publicRosterReads);
    assert.deepEqual(Object.keys(largePublic.data.results[0]).sort(), ['assigned_group', 'draw_code', 'draw_order', 'field', 'original_code']);
    await store.save({ ...largeSaved, projects: [full] }, largeSaved.version);
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
    const appended = await request('/api/projects', { projects: [projectDto(project), { ...projectDto(project), id: 'new', leader_id: 'new-student', project_title: '私人新專題' }], version: state.version }, adminAgain);
    assert.equal(appended.status, 200);
    assert.equal(state.projects[1].password_hash, state.projects[0].password_hash);
    // Start distinct student logins together before the shared verification cache is warm.
    const firstCommonLogins = await Promise.all(state.projects.map(p => request('/api/student/verify', { leaderId: p.leader_id, password: generated.data.password })));
    assert.ok(firstCommonLogins.every(r => r.status === 200));
    assert.equal(new Set(firstCommonLogins.map(r => r.cookie!.split(';')[0])).size, state.projects.length);
    const commonLogin = firstCommonLogins.find(r => r.data.project.leader_id === project.leader_id)!;
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
    const commonLogins = await Promise.all(state.projects.map(p => request('/api/student/verify', { leaderId: p.leader_id, password: generated.data.password })));
    assert.ok(commonLogins.every(r => r.status === 200));
    const separateCookies = commonLogins.map(r => r.cookie!.split(';')[0]);
    assert.equal(new Set(separateCookies).size, state.projects.length, 'shared verification must still create independent student sessions');
    for (let n = 0; n < separateCookies.length; n++) {
      const lookup = await request('/api/student/me', undefined, undefined, separateCookies[n]);
      assert.equal(lookup.status, 200);
      assert.equal(lookup.data.project.leader_id, state.projects[n].leader_id);
    }
    for (const change of ['hash', 'leader'] as const) {
      changedSharedCredential = change;
      const sessionsBeforeChange = sessions.size;
      const staleLogin = await request('/api/student/verify', { leaderId: 'new-student', password: generated.data.password });
      assert.equal(staleLogin.status, 401, 'cached verification cannot bypass a concurrent credential/leader change');
      assert.equal(sessions.size, sessionsBeforeChange);
      changedSharedCredential = undefined;
    }
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

    // Reject code namespaces at every write entry point, including legacy data
    // and single-domain draws that would collide with another domain.
    const beforeCollision = structuredClone(state);
    const aliasConfigs = [{ id: 'a', field: '企業智慧化', groupCount: 1 }, { id: 'alias', field: 'A.企業智慧化', groupCount: 1 }];
    const aliasProjects = aliasConfigs.map((cfg, i) => ({ ...projectDto(project), id: `alias-${i}`, leader_id: `alias-${i}`, field: cfg.field, assigned_group: null, draw_order: null, draw_code: null, draw_time: null }));
    const configCollision = await request('/api/domain-configs', { domainConfigs: aliasConfigs, version: state.version }, adminAgain);
    assert.equal(configCollision.status, 400);
    assert.match(configCollision.data.error, /相同抽籤編號前綴/);
    const importCollision = await request('/api/projects', { projects: aliasProjects, version: state.version }, adminAgain);
    assert.equal(importCollision.status, 400);
    assert.deepEqual(state, beforeCollision);
    state.projects = aliasProjects;
    state.domain_configs = aliasConfigs;
    const legacyCollision = structuredClone(state);
    for (const field of ['ALL', '企業智慧化', 'A.企業智慧化']) {
      const blocked = await request('/api/lottery/draw', { field, version: state.version }, stage);
      assert.equal(blocked.status, 400);
      assert.match(blocked.data.error, /相同抽籤編號前綴/);
      assert.deepEqual(state, legacyCollision);
    }
    // Final merged-result guard also rejects a conflicting legacy/manual code.
    state.projects = [aliasProjects[0], { ...aliasProjects[1], field: '進修部', assigned_group: 1, draw_order: 1, draw_code: 'A01' }];
    state.domain_configs = [aliasConfigs[0], { id: 'g', field: '進修部', groupCount: 1 }];
    const beforeMergedCollision = structuredClone(state);
    const mergedCollision = await request('/api/lottery/draw', { field: '企業智慧化', version: state.version }, stage);
    assert.equal(mergedCollision.status, 400);
    assert.match(mergedCollision.data.error, /A01.*重複.*未儲存/);
    assert.deepEqual(state, beforeMergedCollision);
    state = structuredClone(beforeCollision);

    // Administrators can resolve aliases with explicit letters; existing draws
    // cannot silently acquire a new prefix, and stage receives the configured code.
    state.projects = aliasProjects;
    state.domain_configs = aliasConfigs;
    const explicitConfigs = aliasConfigs.map((cfg, i) => ({ ...cfg, code: i ? 'H' : 'A' }));
    const explicitSave = await request('/api/domain-configs', { domainConfigs: explicitConfigs, version: state.version }, adminAgain);
    assert.equal(explicitSave.status, 200);
    assert.deepEqual(explicitSave.data.projects.map((p: ProjectItem) => p.original_code), ['A01', 'H01']);
    const stageCodes = await request('/api/state', undefined, stage);
    assert.deepEqual(stageCodes.data.domainConfigs.map((c: DomainConfig) => c.code), ['A', 'H']);
    const explicitDraw = await request('/api/lottery/draw', { field: 'ALL', version: state.version }, stage);
    assert.equal(explicitDraw.status, 200);
    assert.deepEqual(state.projects.map(p => p.draw_code), ['A01', 'H01']);
    const changedConfigs = explicitConfigs.map(c => c.code === 'H' ? { ...c, code: 'J' } : c);
    const drawnSnapshot = structuredClone(state);
    const blockedCodeEdit = await request('/api/domain-configs', { domainConfigs: changedConfigs, version: state.version }, adminAgain);
    assert.equal(blockedCodeEdit.status, 409);
    assert.match(blockedCodeEdit.data.error, /先重設.*對應字母/);
    assert.deepEqual(state, drawnSnapshot);
    assert.equal((await request('/api/lottery/reset', { field: 'A.企業智慧化', version: state.version }, stage)).status, 200);
    assert.equal((await request('/api/domain-configs', { domainConfigs: changedConfigs, version: state.version }, adminAgain)).status, 200);
    assert.equal(state.projects[1].original_code, 'J01');
    assert.equal(state.projects[0].draw_code, 'A01');
    assert.equal((await request('/api/lottery/draw', { field: 'A.企業智慧化', version: state.version }, stage)).status, 200);
    assert.deepEqual(state.projects.map(p => p.draw_code), ['A01', 'J01']);
    state = structuredClone(beforeCollision);

    // Deleting a drawn domain must reject before moving/merging any results.
    const deletionFields = ['企業智慧化', '數位內容與多媒體應用'];
    assert.equal((await request('/api/projects', {
      projects: deletionFields.map((field, i) => ({ ...projectDto(project), id: `delete-${i}`, leader_id: `delete-${i}`, field })),
      version: state.version,
    }, adminAgain)).status, 200);
    const deletionConfigs = deletionFields.map(field => ({ id: state.domain_configs.find(config => config.field === field)!.id, field, groupCount: 1, evaluatorsPerGroup: {} }));
    assert.equal((await request('/api/domain-configs', { domainConfigs: deletionConfigs, version: state.version }, adminAgain)).status, 200);
    assert.equal((await request('/api/lottery/draw', { field: 'ALL', version: state.version }, stage)).status, 200);
    const beforeDelete = structuredClone(state);
    for (const renamedField of [undefined, { oldName: deletionFields[0], newName: deletionFields[1] }]) {
      const blocked = await request('/api/domain-configs', { domainConfigs: [deletionConfigs[1]], renamedField, version: state.version }, adminAgain);
      assert.equal(blocked.status, 409);
      assert.match(blocked.data.error, /企業智慧化.*已有抽籤結果.*重設.*刪除/);
      assert.deepEqual(state, beforeDelete, 'rejected deletion must preserve projects, config and version');
    }
    assert.equal((await request('/api/lottery/reset', { field: deletionFields[0], version: state.version }, stage)).status, 200);
    const destinationResult = structuredClone(state.projects[1]);
    assert.equal((await request('/api/domain-configs', { domainConfigs: [deletionConfigs[1]], version: state.version }, adminAgain)).status, 200);
    assert.equal(state.projects[0].field, deletionFields[1]);
    assert.equal(state.projects[0].draw_order, null);
    assert.equal(state.projects[0].assigned_group, null);
    assert.deepEqual(state.projects[1], destinationResult);

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
    for (const group of ['3', '50', '01']) {
      const invalidEvaluators = await request('/api/domain-configs', {
        domainConfigs: configsWithCount(2).map(config => config.field === shrinkField
          ? { ...config, evaluatorsPerGroup: { [group]: ['李教授'] } } : config),
        version: state.version,
      }, adminAgain);
      assert.equal(invalidEvaluators.status, 400);
      assert.match(invalidEvaluators.data.error, /僅設定 2 組.*無效組別/);
      assert.deepEqual(state, beforeInvalidShrink, 'invalid evaluator groups must not change configs, projects or version');
    }
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

    // Manual per-group counts persist; invalid draws and edits are atomic.
    assert.equal((await request('/api/lottery/reset', { field: shrinkField, version: state.version }, stage)).status, 200);
    const manualConfigs = (groupCapacities: Record<number, number>, evaluatorsPerGroup: Record<number, string[]> = {}) =>
      state.domain_configs.map(c => c.field === shrinkField ? { ...c, groupCount: 2, groupCapacities, evaluatorsPerGroup } : c);
    assert.equal((await request('/api/domain-configs', { domainConfigs: manualConfigs({ 1: 1, 2: 3 }), version: state.version }, adminAgain)).status, 200);
    const beforeWrongTotal = structuredClone(state);
    const wrongTotal = await request('/api/lottery/draw', { field: shrinkField, version: state.version }, stage);
    assert.equal(wrongTotal.status, 400);
    assert.match(wrongTotal.data.error, /共 4 件.*名冊有 3 件/);
    assert.deepEqual(state, beforeWrongTotal);
    assert.equal((await request('/api/domain-configs', { domainConfigs: manualConfigs({ 1: 1, 2: 2 }, { 1: ['王教授'], 2: ['李教授'] }), version: state.version }, adminAgain)).status, 200);
    const beforeImpossible = structuredClone(state);
    const impossible = await request('/api/lottery/draw', { field: 'ALL', version: state.version }, stage);
    assert.equal(impossible.status, 400);
    assert.match(impossible.data.error, /件數.*迴避/);
    assert.deepEqual(state, beforeImpossible);
    const manualSaved = await request('/api/domain-configs', { domainConfigs: manualConfigs({ 1: 1, 2: 2 }, { 1: ['李教授'], 2: ['陳教授'] }), version: state.version }, adminAgain);
    assert.equal(manualSaved.status, 200);
    assert.deepEqual((await request('/api/state', undefined, adminAgain)).data.domainConfigs.find((c: any) => c.field === shrinkField).groupCapacities, { 1: 1, 2: 2 });
    const stageConfigs = (await request('/api/state', undefined, stage)).data.domainConfigs.find((c: any) => c.field === shrinkField);
    assert.deepEqual(stageConfigs.groupCapacities, { 1: 1, 2: 2 });
    assert.equal(stageConfigs.evaluatorsPerGroup, undefined);
    const manualDraw = await request('/api/lottery/draw', { field: 'ALL', version: state.version }, stage);
    assert.equal(manualDraw.status, 200);
    assert.deepEqual([1, 2].map(group => state.projects.filter(p => p.assigned_group === group).length), [1, 2]);
    const beforeCapacityEdit = structuredClone(state);
    const capacityEdit = await request('/api/domain-configs', { domainConfigs: manualConfigs({ 1: 2, 2: 1 }), version: state.version }, adminAgain);
    assert.equal(capacityEdit.status, 409);
    assert.match(capacityEdit.data.error, /重設/);
    assert.deepEqual(state, beforeCapacityEdit);
    // Admin test draws reuse current saved settings but never commit any state.
    const beforeTestDraw = structuredClone(state);
    assert.equal((await request('/api/lottery/test', { field: 'ALL', version: state.version })).status, 401);
    assert.equal((await request('/api/lottery/test', { field: 'ALL', version: state.version }, stage)).status, 403);
    assert.equal((await request('/api/lottery/test', { field: 'ALL', version: state.version - 1 }, adminAgain)).status, 409);
    assert.equal((await request('/api/lottery/test', { field: 'missing', version: state.version }, adminAgain)).status, 400);
    const testDraw = await request('/api/lottery/test', { field: 'ALL', version: state.version }, adminAgain);
    assert.equal(testDraw.status, 200); assert.equal(testDraw.data.errorCount, 0);
    assert.deepEqual(testDraw.data.domains[0].groups.map((g: any) => g.count), [1, 2]);
    assert.deepEqual(state, beforeTestDraw);
    assert.equal(testDraw.data.version, beforeTestDraw.version);
    assert.equal(testDraw.data.projects, undefined);
    assert.deepEqual(Object.keys(testDraw.data.domains[0].preview[0]).sort(), ['drawCode', 'group', 'order', 'originalCode', 'title']);
    assert.equal((await request('/api/lottery/reset', { field: shrinkField, version: state.version }, stage)).status, 200);
    assert.equal((await request('/api/domain-configs', { domainConfigs: manualConfigs({ 1: 1, 2: 3 }), version: state.version }, adminAgain)).status, 200);
    const beforeFailedTest = structuredClone(state);
    const failedTest = await request('/api/lottery/test', { field: shrinkField, version: state.version }, adminAgain);
    assert.equal(failedTest.status, 200); assert.equal(failedTest.data.errorCount, 1);
    assert.ok(failedTest.data.domains[0].issues.some((issue: any) => issue.level === 'error' && /共 4 件.*名冊有 3 件/.test(issue.message)));
    assert.deepEqual(state, beforeFailedTest);
    // Multi-domain draw/reset is one atomic save and leaves unselected results intact.
    assert.equal((await request('/api/lottery/reset', { field: 'ALL', version: state.version }, stage)).status, 200);
    const multiFields = ['企業智慧化', '數位內容與多媒體應用', '網路應用與資通安全'];
    const multiProjects = multiFields.map((field, i) => ({ ...project, id: `multi-${i}`, leader_id: `multi-student-${i}`, original_code: `M${i}`, seq_no: String(i + 1), field, assigned_group: null, draw_order: null, draw_code: null, evaluators: [] }));
    assert.equal((await request('/api/projects', { projects: multiProjects, version: state.version }, adminAgain)).status, 200);
    const multiConfigs = multiFields.map(field => ({ id: state.domain_configs.find(cfg => cfg.field === field)!.id, field, groupCount: 1 }));
    assert.equal((await request('/api/domain-configs', { domainConfigs: multiConfigs, version: state.version }, adminAgain)).status, 200);
    const multiFirst = await request('/api/lottery/draw', { field: multiFields[2], version: state.version }, stage);
    assert.equal(multiFirst.status, 200, JSON.stringify(multiFirst.data));
    const thirdBefore = structuredClone(state.projects.find(p => p.field === multiFields[2]));
    const beforeMultiVersion = state.version;
    assert.equal((await request('/api/lottery/draw', { fields: multiFields.slice(0, 2), version: state.version }, stage)).status, 200);
    assert.equal(state.version, beforeMultiVersion + 1);
    assert.ok(state.projects.every(p => p.draw_order === 1));
    assert.deepEqual(state.projects.find(p => p.field === multiFields[2]), thirdBefore);
    const beforeBadScope = structuredClone(state);
    for (const fields of [[], [multiFields[0], multiFields[0]], ['missing']]) {
      assert.equal((await request('/api/lottery/reset', { fields, version: state.version }, stage)).status, 400);
    }
    assert.deepEqual(state, beforeBadScope);
    assert.equal((await request('/api/lottery/reset', { fields: multiFields.slice(0, 2), version: state.version }, stage)).status, 200);
    assert.ok(state.projects.filter(p => p.field !== multiFields[2]).every(p => p.draw_order === null));
    assert.deepEqual(state.projects.find(p => p.field === multiFields[2]), thirdBefore);
    assert.equal((await request('/api/domain-configs', { domainConfigs: multiConfigs.map((cfg, i) => i === 1 ? { ...cfg, groupCapacities: { 1: 2 } } : cfg), version: state.version }, adminAgain)).status, 200);
    const beforeMultiFailure = structuredClone(state);
    assert.equal((await request('/api/lottery/draw', { fields: multiFields.slice(0, 2), version: state.version }, stage)).status, 400);
    assert.deepEqual(state, beforeMultiFailure, 'failure in second domain must not save first domain results');
    // A legitimately signed but revoked cookie must still have a bounded DB budget.
    let sessionLimited = false;
    for (let n = 0; n < 610; n++) {
      const before = databaseRequests;
      const response = await request('/api/auth/me', undefined, admin);
      if (response.status === 429) {
        assert.equal(databaseRequests, before, 'session limit must reject before database access');
        assert.ok(Number(response.retryAfter) > 0);
        assert.match(response.data.error, /過於頻繁/);
        sessionLimited = true; break;
      }
      assert.equal(response.status, 401);
    }
    assert.equal(sessionLimited, true, 'revoked signed cookies must not query the DB without a ceiling');
  } finally {
    releaseCapacity();
    await stop();
    await rm(persistence, { recursive: true, force: true });
    await new Promise<void>(resolve => mock.close(() => resolve()));
  }
});
