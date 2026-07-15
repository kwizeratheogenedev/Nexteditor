// Backend API configuration
const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `${window.location.protocol}//${host}:3000`;
    }
  }

  return 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

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
