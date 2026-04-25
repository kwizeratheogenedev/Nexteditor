import { useState, useEffect } from 'react';
import {
  KEY_ACTIVE_TAB,
  KEY_AUDIO_META,
  KEY_CAPTION_FILE_META,
  KEY_CAPTION_VIDEO_META,
  KEY_SHORTS_DURATION,
  KEY_SHORTS_FORMAT,
  KEY_SHORTS_VIDEO_META,
  KEY_VIDEO1_META,
  KEY_VIDEO2_META,
  KEY_VIDEO3_META,
} from '../constants/storageKeys';

/**
 * Custom hook for persisting state to localStorage
 * @param {string} key - The localStorage key
 * @param {any} initialValue - Initial value if nothing in storage
 * @returns {[any, function]} - [value, setValue]
 */
export function usePersistedState(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

export function clearPersistedState(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Error clearing localStorage key "${key}":`, error);
  }
}

export function clearAllAppState() {
  const keys = [
    KEY_VIDEO1_META,
    KEY_VIDEO2_META,
    KEY_VIDEO3_META,
    KEY_AUDIO_META,
    KEY_CAPTION_VIDEO_META,
    KEY_CAPTION_FILE_META,
    KEY_SHORTS_VIDEO_META,
    KEY_SHORTS_DURATION,
    KEY_SHORTS_FORMAT,
    KEY_ACTIVE_TAB,
  ];
  keys.forEach(clearPersistedState);
}
