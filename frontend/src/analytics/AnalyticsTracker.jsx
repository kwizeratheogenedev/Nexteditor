import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { setPath, startTracking } from './tracker.js';

// Mounted once inside the router: starts the minute pings and reports each
// page change.
export default function AnalyticsTracker() {
  const { pathname } = useLocation();
  useEffect(() => { startTracking(); }, []);
  useEffect(() => { setPath(pathname); }, [pathname]);
  return null;
}
