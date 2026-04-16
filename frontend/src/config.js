// Backend API configuration
// In production, set VITE_API_URL environment variable
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const API_ENDPOINTS = {
  convert: `${API_BASE_URL}/api/convert`,
  burnSubtitles: `${API_BASE_URL}/api/burn-subtitles`,
  extractShorts: `${API_BASE_URL}/api/extract-shorts`,
  reformatShort: `${API_BASE_URL}/api/reformat-short`,
};

export default API_BASE_URL;
