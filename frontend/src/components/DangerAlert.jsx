import { useEffect, useRef, useState } from "react";
import "./DangerAlert.css";
import { ALERT_AUDIO_SRC } from "../config/audioConfig";
import { useI18n } from "../i18n";

// Only these levels interrupt the villager with a full-screen warning.
// Low/Moderate still appear in the normal risk card on the dashboard.
const DANGER_LEVELS = ["High", "Severe", "Critical"];

// Alerts older than this are not "current" any more
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

const SEEN_KEY = "sahaytaSeenAlerts";

function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY)) || [];
  } catch {
    return [];
  }
}

function markSeen(id) {
  const seen = loadSeen();
  if (!seen.includes(id)) {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-50)));
  }
}

const isRecent = (alert) =>
  Boolean(alert.createdAt) && new Date() - new Date(alert.createdAt) < MAX_AGE_MS;

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function isForMyVillage(alert, user) {
  if (!alert.village) return true;                      // district-wide alert
  if (same(alert.village, alert.district)) return true; // village field holds district name
  if (!user?.village) return true;                      // unknown village: warn anyway
  return same(alert.village, user.village);
}

// Siren created via Web Audio API
function startSiren(audioCtxRef) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  try {
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);

    const sweep = () => {
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.linearRampToValueAtTime(1200, t + 0.6);
      osc.frequency.linearRampToValueAtTime(600, t + 1.2);
    };
    sweep();
    const timer = setInterval(sweep, 1200);
    osc.start();

    return () => {
      clearInterval(timer);
      try {
        osc.stop();
      } catch {
        // already stopped
      }
      osc.disconnect();
    };
  } catch {
    return null;
  }
}

async function showPhoneNotification(alert) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const title = `⚠ ${String(alert.riskLevel).toUpperCase()} ALERT – You are in danger / आप खतरे में हैं`;
  const options = {
    body: `${alert.message}\nतुरंत सुरक्षित स्थान पर जाएं / Evacuate immediately`,
    tag: `alert-${alert._id}`,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500],
    icon: "/favicon.svg",
    badge: "/favicon.svg"
  };

  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // fallback
  }
  try {
    new Notification(title, options);
  } catch {
    // ignore
  }
}

function DangerAlert({ alerts, user, onFindShelter, onSendSOS }) {
  const { lang, t } = useI18n();
  const [seen, setSeen] = useState(loadSeen);
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [needsTap, setNeedsTap] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  const audioCtxRef = useRef(null);
  const stopSirenRef = useRef(null);
  const voiceRef = useRef(null);

  // Newest active danger alert for user's village
  const active = (alerts || []).find(
    (alert) =>
      DANGER_LEVELS.includes(alert.riskLevel) &&
      isRecent(alert) &&
      !seen.includes(alert._id) &&
      isForMyVillage(alert, user)
  );
  const activeId = active?._id;

  const stopVoice = () => {
    if (voiceRef.current) {
      voiceRef.current.pause();
      voiceRef.current.currentTime = 0;
    }
    setIsPlayingVoice(false);
  };

  const playHindiVoice = () => {
    // Stop siren when user requests voice guide
    stopSirenRef.current?.();
    stopSirenRef.current = null;

    if (!voiceRef.current) {
      voiceRef.current = new Audio(ALERT_AUDIO_SRC);
      voiceRef.current.onended = () => setIsPlayingVoice(false);
      voiceRef.current.onerror = () => {
        setIsPlayingVoice(false);
        console.warn("Emergency alert audio failed to play.");
      };
    }

    if (isPlayingVoice) {
      stopVoice();
    } else {
      voiceRef.current.currentTime = 0;
      voiceRef.current
        .play()
        .then(() => setIsPlayingVoice(true))
        .catch((err) => {
          console.warn("Audio autoplay blocked by browser:", err);
          setIsPlayingVoice(false);
          setNeedsTap(true);
        });
    }
  };

  // Original siren sound starts automatically whenever danger alert triggers
  useEffect(() => {
    if (!active) return;

    showPhoneNotification(active);
    if ("vibrate" in navigator) {
      navigator.vibrate([800, 300, 800, 300, 800]);
    }

    // Play the original emergency siren immediately
    stopSirenRef.current = startSiren(audioCtxRef);

    // If audio is suspended before user interaction, prompt tap to unmute
    const ctx = audioCtxRef.current;
    if (ctx) {
      Promise.resolve().then(() => setNeedsTap(ctx.state === "suspended"));
    }

    return () => {
      stopSirenRef.current?.();
      stopSirenRef.current = null;
      stopVoice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    return () => {
      stopVoice();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);

    // Unlocks Web Audio Context for later emergency sirens
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
    audioCtxRef.current?.resume().catch(() => {});
  };

  const unmute = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
    audioCtxRef.current?.resume().then(() => {
      setNeedsTap(false);
      if (!stopSirenRef.current && active) {
        stopSirenRef.current = startSiren(audioCtxRef);
      }
    }).catch(() => {});
  };

  const close = (next) => {
    if (active?._id) markSeen(active._id);
    setSeen(loadSeen());
    stopVoice();
    stopSirenRef.current?.();
    stopSirenRef.current = null;
    setNeedsTap(false);
    next?.();
  };

  return (
    <>
      {/* One-time prompt so alerts can reach the phone's notification bar */}
      {permission === "default" && (
        <div className="danger-permission">
          <span>🔔 Get a loud warning on this phone when your village is in danger.</span>
          <button type="button" onClick={enableNotifications}>
            Turn on danger alerts
          </button>
        </div>
      )}

      {active && (
        <div
          className={`danger-overlay danger-${String(active.riskLevel).toLowerCase()}`}
          role="alertdialog"
          aria-live="assertive"
          aria-labelledby="danger-title"
          onClick={needsTap ? unmute : undefined}
        >
          <div className="danger-box">
            <div className="danger-icon">⚠</div>
            <p className="danger-level">{String(active.riskLevel).toUpperCase()} ALERT</p>
            <h1 id="danger-title">
              {lang === "hi" ? "आप खतरे में हैं" : "You are in danger"}
            </h1>
            <p className="danger-subtitle">
              {lang === "hi"
                ? "तुरंत सुरक्षित स्थान पर जाएं / Evacuate immediately"
                : "Evacuate immediately to safety / तुरंत सुरक्षित स्थान पर जाएं"}
            </p>

            <p className="danger-message">{active.message}</p>
            <p className="danger-place">
              📍 {[active.village, active.district].filter(Boolean).join(", ")} ·{" "}
              {new Date(active.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>

            {needsTap && (
              <p className="danger-tap" onClick={unmute} style={{ cursor: "pointer" }}>
                🔔 {t("alert.soundBlockedHint")}
              </p>
            )}

            <div className="danger-actions">
              <button
                type="button"
                className={`danger-secondary danger-audio-btn ${isPlayingVoice ? "active" : ""}`}
                onClick={playHindiVoice}
              >
                {isPlayingVoice ? `⏹️ ${t("alert.stopVoice")}` : `🔊 ${t("alert.playHindiVoice")}`}
              </button>

              <button type="button" className="danger-primary" onClick={() => close(onFindShelter)}>
                {t("alert.routeToShelter")}
              </button>
              <button type="button" className="danger-sos" onClick={() => close(onSendSOS)}>
                {t("alert.needHelpSos")}
              </button>
              <button type="button" className="danger-secondary" onClick={() => close()}>
                {t("alert.understand")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default DangerAlert;
