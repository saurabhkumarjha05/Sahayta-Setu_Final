import { useState, useEffect } from 'react';
import './ui.css';
import { useI18n } from '../../i18n';
import { getConnectivityState, onConnectivityChange, checkConnectivity } from '../../utils/offlineSOS';

export function OfflineBanner({ queuedCount = 0, onSync, syncing = false }) {
  const { t } = useI18n();
  const [connectivity, setConnectivity] = useState(() => getConnectivityState());

  useEffect(() => {
    const unsub = onConnectivityChange(setConnectivity);
    checkConnectivity();
    return unsub;
  }, []);

  // Show banner ONLY when OFFLINE or SERVER_UNREACHABLE
  if (connectivity === 'ONLINE') {
    return null;
  }

  const isOffline = connectivity === 'OFFLINE';

  return (
    <div
      className="ss-offline-banner anim-fade-in-up"
      role="alert"
      aria-live="polite"
      style={{
        minHeight: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        backgroundColor: isOffline ? '#fef3c7' : '#fee2e2',
        color: isOffline ? '#92400e' : '#991b1b',
        borderBottom: `1px solid ${isOffline ? '#fde68a' : '#fecaca'}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span aria-hidden="true">{isOffline ? '📡' : '⚠️'}</span>
        <span style={{ fontWeight: 600 }}>
          {isOffline
            ? t('offlineBanner.offlineTitle')
            : (t('offlineBanner.serverUnreachable') || 'Server unreachable · Running with local cached data')}
          {queuedCount > 0 && ` · ${t('offlineBanner.queuedCount', { count: queuedCount })}`}
        </span>
      </div>

      {onSync && queuedCount > 0 && (
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          style={{
            minHeight: '44px',
            minWidth: '88px',
            background: 'var(--color-warning, #d97706)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 14px',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: syncing ? 'not-allowed' : 'pointer'
          }}
        >
          {syncing ? '...' : t('offlineBanner.syncNow')}
        </button>
      )}
    </div>
  );
}

export default OfflineBanner;
