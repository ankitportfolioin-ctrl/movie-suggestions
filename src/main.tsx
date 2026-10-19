import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AnalyticsDashboard from './components/AnalyticsDashboard.tsx';
import { trackPageviewOnce } from './analytics.ts';
import './index.css';

trackPageviewOnce();

createRoot(document.getElementById('root')!).render(
  location.pathname === '/analytics'
    ? <AnalyticsDashboard />
    : <App />,
);
