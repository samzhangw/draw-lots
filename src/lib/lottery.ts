import { ProjectItem, DomainConfig } from '../types';
import { secureFisherYatesShuffle, getSecureRandomInt } from './cryptoRandom';

/**
 * Normalize professor names to compare without titles (e.g. "林建宏教授" -> "林建宏")
 */
export function normalizeProfessorName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/(特聘|講座|終身)?(教授|副教授|助理教授|講師|老師|博士|院長|主任|委員)/g, '')
    .replace(/\s+/g, '');
}

/**
 * Check if a project's advisor conflicts with any of the group's evaluators
 */
export function isAdvisorConflict(advisor: string, evaluators: string[] = []): boolean {
  if (!advisor || evaluators.length === 0) return false;
  const normAdvisor = normalizeProfessorName(advisor);
  return evaluators.some((ev) => {
    const normEv = normalizeProfessorName(ev);
    return normAdvisor === normEv || normAdvisor.includes(normEv) || normEv.includes(normAdvisor);
  });
}

/**
 * Allocate projects within a single domain to its subgroups, strictly avoiding advisor conflict
 * Employs CSPRNG (window.crypto.getRandomValues) + Fisher-Yates Knuth Shuffle for uniform fairness.
 */
export function allocateDomainSubgroups(
  domainProjects: ProjectItem[],
  groupCount: number,
  domainField: string,
  evaluatorsPerGroup: Record<number, string[]> = {}
): ProjectItem[] {
  const k = Math.max(1, groupCount);
  const now = new Date().toISOString();
  const domainPrefix = domainField.slice(0, 4);

  // Group buckets
  const buckets: Record<number, ProjectItem[]> = {};
  for (let g = 1; g <= k; g++) {
    buckets[g] = [];
  }

  // Cryptographically secure uniform Fisher-Yates shuffle before assignment
  const shuffledProjects = secureFisherYatesShuffle(domainProjects);

  // Calculate constraint scores: how many groups are valid for each project
  const analyzedProjects = shuffledProjects.map((p) => {
    const validGroups: number[] = [];
    for (let g = 1; g <= k; g++) {
      const evaluators = evaluatorsPerGroup[g] || [];
      if (!isAdvisorConflict(p.advisor, evaluators)) {
        validGroups.push(g);
      }
    }
    return {
      project: p,
      validGroups: validGroups.length > 0 ? validGroups : Array.from({ length: k }, (_, i) => i + 1),
    };
  });

  // Sort most-constrained projects first (projects with fewer valid groups get prioritized)
  analyzedProjects.sort((a, b) => a.validGroups.length - b.validGroups.length);

  // Assign projects to buckets with uniform random tie-breaking
  analyzedProjects.forEach(({ project, validGroups }) => {
    // Randomize validGroups order first with Fisher-Yates, then pick group with fewest members
    const shuffledValidGroups = secureFisherYatesShuffle(validGroups);
    shuffledValidGroups.sort((gA, gB) => buckets[gA].length - buckets[gB].length);
    const chosenGroup = shuffledValidGroups[0] || 1;
    buckets[chosenGroup].push(project);
  });

  // For each bucket, cryptographically Fisher-Yates shuffle within group to determine final presentation order
  const results: ProjectItem[] = [];

  for (let g = 1; g <= k; g++) {
    const groupItems = buckets[g] || [];
    // Strict Fisher-Yates uniform shuffle inside the subgroup
    const internalShuffled = secureFisherYatesShuffle(groupItems);
    const groupEvaluators = evaluatorsPerGroup[g] || [];

    internalShuffled.forEach((item, idx) => {
      const order = idx + 1;
      const drawCode = `${domainPrefix}-第${g}組-序號${String(order).padStart(2, '0')}`;

      results.push({
        ...item,
        assigned_group: g,
        draw_order: order,
        draw_code: drawCode,
        draw_time: now,
        evaluators: groupEvaluators,
      });
    });
  }

  return results;
}

/**
 * Execute whole-school lottery:
 * Loops through EACH domain independently, respects each domain's groupCount,
 * and enforces advisor conflict of interest.
 */
export function executeAllDomainsIndependentLottery(
  allProjects: ProjectItem[],
  domainConfigs: DomainConfig[]
): {
  updatedProjects: ProjectItem[];
  conflictCount: number;
  domainSummaries: { field: string; count: number; groupCount: number }[];
} {
  const domainMap = new Map(domainConfigs.map(c => [c.field, c]));

  // Group projects by field
  const projectsByField = new Map<string, ProjectItem[]>();
  allProjects.forEach((p) => {
    const items = projectsByField.get(p.field) || [];
    items.push(p);
    projectsByField.set(p.field, items);
  });

  let allUpdated: ProjectItem[] = [];
  let totalConflicts = 0;
  const summaries: { field: string; count: number; groupCount: number }[] = [];

  projectsByField.forEach((domainItems, fieldName) => {
    const cfg = domainMap.get(fieldName);
    const groupCount = cfg?.groupCount || 2;
    const evaluatorsPerGroup = cfg?.evaluatorsPerGroup || {};

    const allocated = allocateDomainSubgroups(
      domainItems,
      groupCount,
      fieldName,
      evaluatorsPerGroup
    );

    // Verify conflict of interest
    allocated.forEach((p) => {
      if (p.assigned_group && isAdvisorConflict(p.advisor, evaluatorsPerGroup[p.assigned_group] || [])) {
        totalConflicts++;
      }
    });

    allUpdated = [...allUpdated, ...allocated];
    summaries.push({
      field: fieldName,
      count: domainItems.length,
      groupCount,
    });
  });

  // Preserve original ordering or sort by sequence
  const finalSorted = allUpdated.sort(
    (a, b) => parseInt(a.seq_no, 10) - parseInt(b.seq_no, 10)
  );

  return {
    updatedProjects: finalSorted,
    conflictCount: totalConflicts,
    domainSummaries: summaries,
  };
}
