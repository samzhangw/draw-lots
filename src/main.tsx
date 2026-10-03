import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import './index.css';
import { StaffInvitation } from './components/StaffInvitation';
import { invitationToken } from './lib/staffInvitation';

const isInvitation = window.location.pathname.replace(/\/+$/, '') === '/auth/invite';
const tokenHash = isInvitation ? invitationToken(window.location.hash, window.location.search) : null;
if (isInvitation) {
  // Remove the credential from history before rendering; keep it in memory only.
  window.history.replaceState(null, '', '/auth/invite');
  document.title = '接受工作人員邀請 | 專題成果展';
}

createRoot(document.getElementById('root')!).render(<PageErrorBoundary>{isInvitation ? <StaffInvitation tokenHash={tokenHash} /> : <App />}</PageErrorBoundary>);
