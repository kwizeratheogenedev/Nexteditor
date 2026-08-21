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
  youtubeAuthUrl: `${API_BASE_URL}/api/youtube/auth/url`,
  youtubeAuthStatus: `${API_BASE_URL}/api/youtube/auth/status`,
  youtubeAuthDisconnect: `${API_BASE_URL}/api/youtube/auth/disconnect`,
  youtubeUpload: `${API_BASE_URL}/api/youtube/upload`,
  youtubeVideo: (videoId) => `${API_BASE_URL}/api/youtube/videos/${videoId}`,
  authSignup: `${API_BASE_URL}/api/auth/signup`,
  authLogin: `${API_BASE_URL}/api/auth/login`,
  authLogout: `${API_BASE_URL}/api/auth/logout`,
  authMe: `${API_BASE_URL}/api/auth/me`,
  authGoogleUrl: `${API_BASE_URL}/api/auth/google/url`,
  projects: `${API_BASE_URL}/api/projects`,
  project: (id) => `${API_BASE_URL}/api/projects/${id}`,
  jobsMine: `${API_BASE_URL}/api/jobs/mine`,
  jobAck: (jobId) => `${API_BASE_URL}/api/jobs/${jobId}/ack`,
  momoRequestToPay: `${API_BASE_URL}/api/billing/momo/request-to-pay`,
  momoStatus: (referenceId) => `${API_BASE_URL}/api/billing/momo/status/${referenceId}`,
  cardsCheckoutSession: `${API_BASE_URL}/api/billing/cards/checkout-session`,
  cardsVerify: (transactionId, txRef) => `${API_BASE_URL}/api/billing/cards/verify?transaction_id=${encodeURIComponent(transactionId)}&tx_ref=${encodeURIComponent(txRef)}`,
};

export default API_BASE_URL;
