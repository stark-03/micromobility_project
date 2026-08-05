import { createRoot } from 'react-dom/client';
import './styles/tailwind.css';

// Placeholder shell — Task 18 replaces this with providers, theme and router.
const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <div className="bg-ink-950 text-mist-100 font-sans min-h-screen p-8">
    <h1 className="font-display text-2xl text-info">Scaffold OK</h1>
    <p className="text-mist-400 mt-2">Design tokens are wired through Tailwind.</p>
  </div>,
);
