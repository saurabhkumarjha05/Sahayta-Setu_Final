import { useCallback, useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { getSocket } from '../utils/socketClient';

export default function StatusScreen({ user, onStatusUpdated, onLogout }) {
  const [currentUser, setCurrentUser] = useState(user);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const status = currentUser?.verificationStatus || 'PENDING';
  const role = currentUser?.role || 'user';
  const reason = currentUser?.verificationNote || '';

  // Function to refresh user profile from /api/auth/me
  const checkStatus = useCallback(async (showToast = true) => {
    setChecking(true);
    setError('');
    try {
      const data = await apiFetch('/api/auth/me');
      if (data && data.user) {
        setCurrentUser(data.user);
        if (data.user.verificationStatus === 'VERIFIED') {
          if (showToast) setStatusMsg('✓ Account verified! Entering dashboard...');
          if (typeof onStatusUpdated === 'function') {
            onStatusUpdated(data.user);
          }
        } else {
          if (showToast) setStatusMsg(`Status checked: ${data.user.verificationStatus}`);
        }
      }
    } catch (err) {
      setError(err.message || 'Could not connect. Please check your internet and try again.');
    } finally {
      setChecking(false);
    }
  }, [onStatusUpdated]);

  useEffect(() => {
    // 1. Listen to realtime account:status-changed event via Socket.IO
    const socket = getSocket();
    if (socket) {
      const handleStatusChanged = (payload) => {
        setStatusMsg(`Status updated by administrator: ${payload.verificationStatus}`);
        checkStatus(false);
      };

      socket.on('account:status-changed', handleStatusChanged);
      return () => {
        socket.off('account:status-changed', handleStatusChanged);
      };
    }
  }, [checkStatus]);

  useEffect(() => {
    // 2. Fallback polling every 30 seconds
    const interval = setInterval(() => {
      checkStatus(false);
    }, 30000);

    // 3. Check status when tab regains focus
    const handleFocus = () => {
      checkStatus(false);
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkStatus]);

  const getStatusConfig = () => {
    switch (status) {
      case 'PENDING':
        return {
          title: 'Account Verification Pending',
          subtitle: 'Your organization account is undergoing administrative review.',
          badgeColor: '#b45309',
          badgeBg: '#fffbeb',
          borderColor: '#fde68a',
          icon: '⏳',
          description: 'Official response access (alerts, rescue triage, responder coordination) requires verification by Sahayta Setu\'s authorized platform administrator. You will be notified immediately upon approval.',
        };
      case 'REJECTED':
        return {
          title: 'Registration Not Approved',
          subtitle: 'Your organization registration was not approved.',
          badgeColor: '#b91c1c',
          badgeBg: '#fef2f2',
          borderColor: '#fecaca',
          icon: '✕',
          description: reason || 'Please contact platform administration or re-register with verified documentation.',
        };
      case 'SUSPENDED':
        return {
          title: 'Account Temporarily Suspended',
          subtitle: 'Privileged operations have been temporarily suspended.',
          badgeColor: '#c2410c',
          badgeBg: '#fff7ed',
          borderColor: '#fed7aa',
          icon: '⏸',
          description: reason || 'Administrative hold placed on this account. Contact your state or district disaster authority coordinator.',
        };
      case 'REVOKED':
        return {
          title: 'Account Access Revoked',
          subtitle: 'Access credentials for this authority/responder have been revoked.',
          badgeColor: '#991b1b',
          badgeBg: '#fef2f2',
          borderColor: '#f87171',
          icon: '🚫',
          description: reason || 'Credentials permanently revoked. Reach out to platform administration for assistance.',
        };
      default:
        return {
          title: 'Status: ' + status,
          subtitle: 'Under review by authorized administrator.',
          badgeColor: '#475569',
          badgeBg: '#f1f5f9',
          borderColor: '#cbd5e1',
          icon: 'ℹ️',
          description: 'Awaiting administrator verification.',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="auth-v2" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '540px', width: '100%', background: '#ffffff', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        
        {/* Top header accent */}
        <div style={{ height: '6px', background: 'linear-gradient(90deg, #2563eb, #38bdf8)' }} />

        <div style={{ padding: '32px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ fontSize: '32px', width: '56px', height: '56px', borderRadius: '12px', background: config.badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${config.borderColor}` }}>
              {config.icon}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: config.badgeBg, color: config.badgeColor, border: `1px solid ${config.borderColor}` }}>
                  {status}
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {role.toUpperCase()}
                </span>
              </div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', margin: '4px 0 0 0' }}>
                {config.title}
              </h2>
            </div>
          </div>

          {/* Org details */}
          <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '16px', marginBottom: '20px', border: '1px solid #e2e8f0', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#64748b' }}>Account:</span>
              <strong style={{ color: '#1e293b' }}>{currentUser?.name || currentUser?.email}</strong>
            </div>
            {currentUser?.email && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Email:</span>
                <span style={{ color: '#1e293b' }}>{currentUser.email}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Jurisdiction:</span>
              <span style={{ color: '#1e293b' }}>
                {[currentUser?.district, currentUser?.state].filter(Boolean).join(', ') || 'National'}
              </span>
            </div>
          </div>

          {/* Description & Honest Note */}
          <p style={{ color: '#475569', fontSize: '0.925rem', lineHeight: 1.5, marginBottom: '16px' }}>
            {config.description}
          </p>

          {reason && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '12px', marginBottom: '20px', fontSize: '0.85rem', color: '#9f1239' }}>
              <strong>Admin Note:</strong> {reason}
            </div>
          )}

          {statusMsg && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px', fontSize: '0.85rem', color: '#166534' }}>
              {statusMsg}
            </div>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px', fontSize: '0.85rem', color: '#991b1b' }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button
              type="button"
              onClick={() => checkStatus(true)}
              disabled={checking}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '8px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: checking ? 'not-allowed' : 'pointer',
                opacity: checking ? 0.7 : 1,
                minHeight: '48px',
              }}
            >
              {checking ? 'Checking Status...' : '🔄 Check Status'}
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{
                padding: '12px 20px',
                borderRadius: '8px',
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                minHeight: '48px',
              }}
            >
              Log Out
            </button>
          </div>
        </div>

        {/* Footer info banner */}
        <div style={{ background: '#f8fafc', padding: '14px 32px', borderTop: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b', textAlign: 'center' }}>
          Verified by Sahayta Setu's authorized platform administrator. Real-time updates active.
        </div>
      </div>
    </div>
  );
}
