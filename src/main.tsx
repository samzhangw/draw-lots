import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(<PageErrorBoundary><App /></PageErrorBoundary>);
