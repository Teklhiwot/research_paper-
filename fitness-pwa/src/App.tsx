import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Workout from './pages/Workout';
import Weight from './pages/Weight';
import Statistics from './pages/Statistics';
import Settings from './pages/Settings';
import { initializeDatabase } from './database/db';
import { registerServiceWorker } from './services/pwa';
import './index.css';

function App() {
  useEffect(() => {
    // Initialize database and PWA
    initializeDatabase();
    registerServiceWorker();
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workout" element={<Workout />} />
          <Route path="/weight" element={<Weight />} />
          <Route path="/statistics" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
