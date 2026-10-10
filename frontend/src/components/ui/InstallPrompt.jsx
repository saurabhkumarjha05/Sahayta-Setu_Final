import { useState, useEffect } from 'react';
import './ui.css';
import { useI18n } from '../../i18n';

const DISMISSED_KEY = 'sahayta_pwa_install_dismissed';

export function InstallPrompt() {
  const { t } = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const userAgent = typeof window === 'undefined' ? '' : window.navigator.userAgent.toLowerCase();
  const isIosDevice = /iphone|ipad|ipod/.test(userAgent) ||
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = typeof window !== 'undefined' &&
    (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
  const isIos = isIosDevice && !isStandalone;

  useEffect(() => {
    // Check if dismissed before
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;

    if (isIos) {
      const timer = setTimeout(() => setShowPrompt(true), 0);
      return () => clearTimeout(timer);
    }

    if (isStandalone) {
      return;
    }

    // Android / Chrome beforeinstallprompt event
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowPrompt(false);
      localStorage.setItem(DISMISSED_KEY, 'true');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isIos, isStandalone]);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setShowPrompt(false);
      } catch (error) {
        console.warn('PWA installation could not be started:', error);
      } finally {
        setDeferredPrompt(null);
      }
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  if (!showPrompt) return null;

  return (
    <div className="ss-install-prompt anim-fade-in-up" role="region" aria-label="Install App Prompt">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ fontSize: '2rem' }}>📲</div>
        <div>
          <strong style={{ display: 'block', fontSize: '0.95rem' }}>{t('app.installApp')}</strong>
          <small style={{ opacity: 0.9 }}>
            {isIos
              ? 'Tap Share ⎋ then "Add to Home Screen" for instant offline access'
              : t('app.installAppDesc')}
          </small>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {!isIos && (
          <button
            type="button"
            onClick={handleInstallClick}
            style={{
              background: '#ffffff',
              color: '#1e3a8a',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 14px',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            {t('app.installButton')}
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('app.dismiss')}
          style={{
            background: 'transparent',
            color: '#ffffff',
            border: 'none',
            fontSize: '1.2rem',
            padding: '6px',
            cursor: 'pointer',
            opacity: 0.8
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
