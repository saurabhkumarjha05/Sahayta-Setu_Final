import './ui.css';
import { useI18n, SUPPORTED_LANGUAGES } from '../../i18n';

export function LanguageSwitcher({ className = '' }) {
  const { lang, setLanguage } = useI18n();

  return (
    <div
      className={`ss-lang-switcher ${className}`}
      role="group"
      aria-label="Language selection"
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`ss-lang-btn ${lang === l.code ? 'active' : ''}`}
          onClick={() => setLanguage(l.code)}
          aria-pressed={lang === l.code}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
