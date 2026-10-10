import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { forwardPendingSOSViaMesh, startAutoSync } from '../../utils/offlineSOS';
import {
  addNativeMeshListener,
  hasNativeNearbyMesh,
  startNativeNearbyMesh,
  stopNativeNearbyMesh
} from '../../utils/mesh/EmergencyTransport';

const ENABLED_KEY = 'sahayta_nearby_mesh_enabled';

export function NearbyMeshControl({ role }) {
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [error, setError] = useState('');
  const supported = hasNativeNearbyMesh();

  const relayQueuedSOS = useCallback(async () => {
    try {
      await forwardPendingSOSViaMesh();
    } catch (relayError) {
      console.error('Could not forward queued SOS to nearby devices:', relayError);
      setError(t('app.meshRelayFailed'));
    }
  }, [t]);

  useEffect(() => {
    if (!supported) return undefined;

    let disposed = false;
    let statusListener;
    let packetListener;

    const applyStatus = (status) => {
      if (disposed) return;
      setActive(Boolean(status.active));
      setPeerCount(Number(status.peerCount) || 0);
      if (status.error) setError(status.error);
      if (Number(status.peerCount) > 0) relayQueuedSOS();
    };

    addNativeMeshListener('meshStatus', applyStatus)
      .then((listener) => {
        statusListener = listener;
      })
      .catch((listenerError) => {
        console.error('Could not listen for Android mesh status:', listenerError);
        setError(t('app.meshStartFailed'));
      });

    addNativeMeshListener('meshPacketReceived', relayQueuedSOS)
      .then((listener) => {
        packetListener = listener;
      })
      .catch((listenerError) => {
        console.error('Could not listen for relayed Android SOS:', listenerError);
        setError(t('app.meshStartFailed'));
      });

    try {
      if (localStorage.getItem(ENABLED_KEY) === 'true') {
        startNativeNearbyMesh()
          .then(applyStatus)
          .catch((startError) => {
            console.error('Could not restart Android nearby mesh:', startError);
            setError(t('app.meshStartFailed'));
          });
      }
    } catch (storageError) {
      console.warn('Nearby mesh preference could not be restored:', storageError);
    }

    return () => {
      disposed = true;
      statusListener?.remove();
      packetListener?.remove();
    };
  }, [relayQueuedSOS, supported, t]);

  useEffect(() => {
    if (!supported || role === 'villager') return undefined;
    return startAutoSync();
  }, [role, supported]);

  const enableMesh = async () => {
    setError('');
    try {
      const status = await startNativeNearbyMesh();
      setActive(Boolean(status.active));
      setPeerCount(Number(status.peerCount) || 0);
      localStorage.setItem(ENABLED_KEY, 'true');
      if (Number(status.peerCount) > 0) await relayQueuedSOS();
    } catch (startError) {
      console.error('Android nearby SOS mesh could not start:', startError);
      setError(t('app.meshStartFailed'));
    }
  };

  const disableMesh = async () => {
    setError('');
    try {
      await stopNativeNearbyMesh();
      localStorage.removeItem(ENABLED_KEY);
      setActive(false);
      setPeerCount(0);
    } catch (stopError) {
      console.error('Android nearby SOS mesh could not stop:', stopError);
      setError(t('app.meshStopFailed'));
    }
  };

  if (!supported) return null;

  return (
    <section
      aria-label={t('app.meshTitle')}
      style={{
        margin: '12px',
        padding: '12px 16px',
        border: `1px solid ${peerCount > 0 ? '#86efac' : '#bfdbfe'}`,
        borderRadius: '12px',
        background: peerCount > 0 ? '#f0fdf4' : '#eff6ff',
        color: '#1e3a8a'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <strong>{t('app.meshTitle')}</strong>
          <div style={{ marginTop: '4px', fontSize: '0.85rem' }}>
            {peerCount > 0
              ? t('app.meshPeersConnected', { count: peerCount })
              : active
                ? t('app.meshSearching')
                : t('app.meshDescription')}
          </div>
        </div>
        <button
          type="button"
          onClick={active ? disableMesh : enableMesh}
          style={{
            minHeight: '44px',
            padding: '8px 14px',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            background: active ? '#475569' : '#1d4ed8',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {active ? t('app.meshStop') : t('app.meshEnable')}
        </button>
      </div>
      {error && <p role="alert" style={{ margin: '8px 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>}
    </section>
  );
}

export default NearbyMeshControl;
