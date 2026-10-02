// Display hint only. The backend cookie remains the sole authentication proof.
const KEY = 'nutc_student_session_hint_until';
const LIFETIME_MS = 60 * 60 * 1000;

export function hasStudentSessionHint(): boolean {
  try {
    const until = Number(localStorage.getItem(KEY));
    return Number.isFinite(until) && until > Date.now() && until <= Date.now() + LIFETIME_MS;
  } catch { return false; }
}

export function rememberStudentSessionHint(): void {
  try { localStorage.setItem(KEY, String(Date.now() + LIFETIME_MS)); } catch {}
}

export function clearStudentSessionHint(): void {
  try { localStorage.removeItem(KEY); } catch {}
}
