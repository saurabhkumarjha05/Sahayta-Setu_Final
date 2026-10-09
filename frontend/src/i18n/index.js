import { useState, useEffect } from 'react';
import en from './en.json';
import hi from './hi.json';

export const UI_LANGUAGES = ['en', 'hi'];

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' }
].filter(l => UI_LANGUAGES.includes(l.code));

const TRANSLATIONS = { en, hi };
const STORAGE_KEY = 'sahayta_language';
const EVENT_NAME = 'sahayta:language_changed';

export function getLanguage() {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'hi' || saved === 'en') return saved;
  // Fallback to English
  return 'en';
}

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'hi') return;
  localStorage.setItem(STORAGE_KEY, lang);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { lang } }));
  }
}

export function t(path, params = {}) {
  const lang = getLanguage();
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const fallbackDict = TRANSLATIONS.en;

  const getNested = (obj, p) => {
    return p.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : null), obj);
  };

  let text = getNested(dict, path);
  if (text === null || text === undefined) {
    text = getNested(fallbackDict, path);
  }
  if (text === null || text === undefined) {
    return path;
  }

  // Replace {{param}}
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((key) => {
      text = text.replace(new RegExp(`{{${key}}}`, 'g'), String(params[key]));
    });
  }

  return text;
}

export function useI18n() {
  const [lang, setLangState] = useState(getLanguage);

  useEffect(() => {
    const handleLangChange = (e) => {
      setLangState(e.detail?.lang || getLanguage());
    };
    window.addEventListener(EVENT_NAME, handleLangChange);
    return () => window.removeEventListener(EVENT_NAME, handleLangChange);
  }, []);

  const changeLanguage = (newLang) => {
    setLanguage(newLang);
    setLangState(newLang);
  };

  const translate = (path, params) => t(path, params);

  return {
    lang,
    setLanguage: changeLanguage,
    t: translate,
    languages: SUPPORTED_LANGUAGES
  };
}
