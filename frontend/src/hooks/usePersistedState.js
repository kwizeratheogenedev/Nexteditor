import { useState, useEffect } from 'react';

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
    'nexeditor_video1',
    'nexeditor_video2', 
    'nexeditor_video3',
    'nexeditor_audio',
    'nexeditor_captionVideo',
    'nexeditor_captionFile',
    'nexeditor_shortsVideo',
    'nexeditor_shortsDuration',
    'nexeditor_shortsFormat',
    'nexeditor_activeTab'
  ];
  keys.forEach(clearPersistedState);
}
