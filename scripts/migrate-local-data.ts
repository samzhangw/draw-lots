import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { removeLegacyCredentials } from '../server/credentials';
import { createStore, validateProjects, validateDomains } from '../server/store';
config({ path: '.env.local' });
config();

async function migrate() {
  const source = JSON.parse(await readFile(process.argv[2] || 'data/server-db.json', 'utf8'));
  validateProjects(source.projects);
  validateDomains(source.domainConfigs);
  const store = createStore();
  const current = await store.load();
  if (current.projects.length || current.version !== 0) throw new Error('Supabase 已有資料或已被操作，停止移轉以避免覆蓋。');
  const saved = await store.save({ ...current, projects: removeLegacyCredentials(source.projects), domainConfigs: source.domainConfigs }, current.version);
  console.log(`已移轉 ${saved.projects.length} 筆專題與 ${saved.domainConfigs.length} 個領域至 Supabase；舊學生密碼已移除，請於後台重新設定。`);
}
migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
