// Backend API configuration
// In production, set VITE_API_URL environment variable
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const API_ENDPOINTS = {
  convert: `${API_BASE_URL}/api/convert`,
  burnSubtitles: `${API_BASE_URL}/api/burn-subtitles`,
  generateCaptions: `${API_BASE_URL}/api/generate-captions`,
  extractShorts: `${API_BASE_URL}/api/extract-shorts`,
  reformatShort: `${API_BASE_URL}/api/reformat-short`,
  fetchUrlVideo: `${API_BASE_URL}/api/fetch-url-video`,
  createMontage: `${API_BASE_URL}/api/create-montage`,
};

export default API_BASE_URL;
