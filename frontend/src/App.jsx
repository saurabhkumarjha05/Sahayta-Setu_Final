import { useCallback, useEffect, useState } from "react";
import Login from "./Login";
import ProfileMenu from "./components/ProfileMenu";
import { apiFetch, clearSession, initials, loadSession, saveSession } from "./api";
import {
  AlertsView,
  EvacuationBar,
  EvacuationLegend,
  EvacuationView,
  MapView,
  RespondersView,
  SheltersView,
  SOSView,
  VerificationCenterView,
  AuditLogView,
} from "./components/ControlViews";
import VillagerDashboard from "./VillagerDashboard";
import NgoDashboard from "./NgoDashboard";
import AdminDashboard from "./components/AdminDashboard";
import StatusScreen from "./components/StatusScreen";
import GramPanchayatMap from "./components/map/GramPanchayatMap";
import "./App.css";
import LocationSelector from "./components/LocationSelector";
import { getSocket, subscribeToDistrict } from "./utils/socketClient";
import { registerDeviceWithBackend } from "./utils/trustedDevice";

// Value of the "Other village" choice in the alert form
const OTHER_VILLAGE = "__other__";

function App() {
  // Logged-in session: { role, token, user }. Kept in localStorage so a refresh stays logged in.
  const [session, setSession] = useState(() => {
    const saved = loadSession();
    return saved?.token ? saved : null;   // sessions from before OTP login have no token
  });
  const loggedIn = Boolean(session);
  const role = session?.role || null;

  // =========================================================
  // LIVE BACKEND DATA
  // =========================================================

  const [sosRequests, setSosRequests] = useState([]);   // active (not resolved)
  const [allSOS, setAllSOS] = useState([]);             // every request, for the SOS page
  const [ngos, setNgos] = useState([]);
  const [ngosLoading, setNgosLoading] = useState(true);
  const [ngosError, setNgosError] = useState("");

  // Which Control Centre page is open: dashboard | alerts | sos | map | shelters | responders
  const [activeView, setActiveView] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sosFilter, setSosFilter] = useState("active");

  // Family evacuation reports: { totals, villages, reports }
  const [evacuation, setEvacuation] = useState(null);
  const [evacLoading, setEvacLoading] = useState(true);
  const [evacError, setEvacError] = useState("");
  const [shelters, setShelters] = useState([]);

  const [sosLoading, setSosLoading] = useState(true);
  const [shelterLoading, setShelterLoading] = useState(true);

  const [sosError, setSosError] = useState("");
  const [shelterError, setShelterError] = useState("");

  // =========================================================
  // ALERT STATE
  // =========================================================

  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState("");

  const [showAlertModal, setShowAlertModal] = useState(false);

  const [alertVillage, setAlertVillage] = useState("");   // "" = whole district
  const [alertState, setAlertState] = useState("Karnataka");
  const [alertDistrict, setAlertDistrict] = useState("Udupi");
  const [otherVillage, setOtherVillage] = useState("");   // typed name when "Other village" is chosen
  const [alertAreas, setAlertAreas] = useState({ districts: [], villages: {} });
  const [alertRiskLevel, setAlertRiskLevel] = useState("Severe");

  const [alertLoading, setAlertLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertError, setAlertError] = useState("");

  // =========================================================
  // LOGIN & DEVICE REGISTRATION
  // =========================================================

  const handleLogin = (newSession) => {
    saveSession(newSession);
    setSession(newSession);

    // Register trusted emergency device in background for EVERY logged-in account
    if (newSession?.token) {
      registerDeviceWithBackend(newSession.user?._id || newSession.user?.id).catch((err) => {
        console.warn('Trusted emergency device registration notice:', err?.message || err);
      });
    }
  };

  const handleLogout = () => {
    apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
    setSession(null);
  };

  // =========================================================
  // FETCH SOS
  // =========================================================

  const fetchSOSRequests = useCallback(async () => {
    try {
      setSosError("");
      const districtParam = session?.user?.district
        ? `?district=${encodeURIComponent(session.user.district)}&state=${encodeURIComponent(session.user.state || "")}`
        : "";

      const data = await apiFetch(`/api/sos${districtParam}`);
      const list = Array.isArray(data) ? data : [];
      setAllSOS(list);
      setSosRequests(list.filter((sos) => sos.status !== "Resolved"));
    } catch (error) {
      console.error("SOS fetch error:", error);
      if (error.status === 403) {
        setSosError(`Geo-Authorization: ${error.message || 'Access restricted to authorized jurisdiction'}`);
      } else if (error.status === 401) {
        setSosError("Please log out and log in again as Gram Panchayat.");
      } else {
        setSosError("Unable to load live SOS data.");
      }
    } finally {
      setSosLoading(false);
    }
  }, [session]);

  // =========================================================
  // FETCH SHELTERS
  // =========================================================

  const fetchShelters = useCallback(async () => {
    try {
      setShelterError("");

      const data = await apiFetch("/api/shelters");

      setShelters(data);
    } catch (error) {
      console.error("Shelters fetch error:", error);
      setShelterError("Unable to load shelter data.");
    } finally {
      setShelterLoading(false);
    }
  }, []);

  // =========================================================
  // FETCH ALERTS
  // =========================================================

  const fetchNgos = useCallback(async () => {
    try {
      setNgosError("");
      const data = await apiFetch("/api/ngos");
      setNgos(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("NGO fetch error:", error);
      setNgosError("Unable to load responders.");
    } finally {
      setNgosLoading(false);
    }
  }, []);

  const fetchEvacuation = useCallback(async () => {
    try {
      setEvacError("");
      const data = await apiFetch("/api/evacuation");
      setEvacuation(data);
    } catch (error) {
      console.error("Evacuation fetch error:", error);
      setEvacError("Unable to load family reports.");
    } finally {
      setEvacLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      setAlertsError("");
      const districtParam = session?.user?.district
        ? `?district=${encodeURIComponent(session.user.district)}&state=${encodeURIComponent(session.user.state || "")}`
        : "";

      const data = await apiFetch(`/api/alerts${districtParam}`);
      setAlerts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Alerts fetch error:", error);
      setAlertsError("Unable to load live alert data.");
    } finally {
      setAlertsLoading(false);
    }
  }, [session]);

  // =========================================================
  // REFRESH LIVE DATA & REAL-TIME SOCKET.IO
  // =========================================================

  useEffect(() => {
    if (loggedIn && role === "control") {
      const initialFetch = setTimeout(() => {
        fetchSOSRequests();
        fetchShelters();
        fetchAlerts();
        fetchNgos();
        fetchEvacuation();
      }, 0);

      // Subscribe to Panchayat authorized district room
      if (session?.user?.district) {
        subscribeToDistrict(session.user.district, "control");
        const s = getSocket();

        const handleSosEvent = () => {
          fetchSOSRequests();
        };

        const handleAlertEvent = (alert) => {
          setAlerts((prev) => [alert, ...prev.filter(a => a._id !== alert._id)]);
        };

        s.on("emergency:new_sos", handleSosEvent);
        s.on("sos:assigned", handleSosEvent);
        s.on("sos:list_updated", handleSosEvent);
        s.on("alert:published", handleAlertEvent);

        return () => {
          clearTimeout(initialFetch);
          s.off("emergency:new_sos", handleSosEvent);
          s.off("sos:assigned", handleSosEvent);
          s.off("sos:list_updated", handleSosEvent);
          s.off("alert:published", handleAlertEvent);
        };
      }

      const interval = setInterval(() => {
        fetchSOSRequests();
        fetchShelters();
        fetchAlerts();
        fetchNgos();
        fetchEvacuation();
      }, 5000);

      return () => {
        clearTimeout(initialFetch);
        clearInterval(interval);
      };
    }
  }, [
    loggedIn,
    role,
    session?.user?.district,
    fetchSOSRequests,
    fetchShelters,
    fetchAlerts,
    fetchNgos,
    fetchEvacuation,
  ]);

  // =========================================================
  // PAGE NAVIGATION
  // =========================================================

  const VIEW_TITLES = {
    dashboard: "OVERVIEW",
    alerts: "LIVE ALERTS",
    sos: "SOS REQUESTS",
    map: "RISK MAP",
    shelters: "SHELTERS",
    responders: "RESPONDERS",
    evacuation: "EVACUATION",
    verifications: "VERIFICATION CENTER",
    audit: "AUDIT LOGS",
  };

  const openView = (view, sosTab) => {
    setActiveView(view);
    if (sosTab) setSosFilter(sosTab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // =========================================================
  // OPEN ALERT MODAL
  // =========================================================

  const openAlertModal = async () => {
    setAlertMessage("");
    setAlertError("");

    // A Gram Panchayat officer can only alert the district they registered with
    if (session?.user?.district) {
      setAlertDistrict(session.user.district);
    }
    setShowAlertModal(true);

    // Districts + the villages that have registered villagers
    try {
      const data = await apiFetch("/api/alerts/areas");
      setAlertAreas({
        districts: Array.isArray(data.districts) ? data.districts : [],
        villages: data.villages || {},
      });
    } catch (error) {
      console.error("Alert areas fetch error:", error);
    }
  };

  // =========================================================
  // CLOSE ALERT MODAL
  // =========================================================

  const closeAlertModal = () => {
    if (alertLoading) return;

    setShowAlertModal(false);
    setAlertMessage("");
    setAlertError("");
  };

  // =========================================================
  // TRIGGER EMERGENCY ALERT
  // =========================================================

  const triggerEmergencyAlert = async () => {
    const village =
      alertVillage === OTHER_VILLAGE ? otherVillage.trim() : alertVillage;

    if (!alertDistrict || !alertRiskLevel) {
      setAlertError("Please select a district and risk level.");
      return;
    }
    if (alertVillage === OTHER_VILLAGE && !village) {
      setAlertError("Please type the village name.");
      return;
    }

    try {
      setAlertLoading(true);
      setAlertError("");
      setAlertMessage("");

      const data = await apiFetch("/api/alerts/trigger", {
        method: "POST",
        body: JSON.stringify({
            village,
            state: session?.user?.state || alertState,
            district: session?.user?.district || alertDistrict,
            riskLevel: alertRiskLevel,
          }),
      });

      const total = data.recipients?.length || 0;
      const smsText =
        data.sms?.mode === "live"
          ? ` · SMS sent to ${data.sms.sent} of ${total} villager(s)${
              data.sms.failed ? ` (${data.sms.failed} failed)` : ""
            }`
          : ` · ${total} villager(s) in this area · SMS: demo mode`;

      setAlertMessage(
        `${data.message || `Emergency alert triggered for ${village || alertDistrict}`}${smsText}`
      );

      // Refresh alerts immediately
      await fetchAlerts();

      setTimeout(() => {
        setShowAlertModal(false);
        setAlertMessage("");
      }, 2500);
    } catch (error) {
      console.error("Emergency alert error:", error);

      setAlertError(
        "Unable to trigger emergency alert. Please try again."
      );
    } finally {
      setAlertLoading(false);
    }
  };

  // =========================================================
  // ALERT DISPLAY HELPERS
  // =========================================================

  const formatAlertTime = (createdAt) => {
    if (!createdAt) return "Just now";

    const date = new Date(createdAt);

    if (Number.isNaN(date.getTime())) {
      return "Just now";
    }

    const diffMinutes = Math.max(
      0,
      Math.floor((new Date().getTime() - date.getTime()) / 60000)
    );

    if (diffMinutes < 1) return "Just now";

    if (diffMinutes < 60) {
      return `${diffMinutes} minute${
        diffMinutes === 1 ? "" : "s"
      } ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours < 24) {
      return `${diffHours} hour${
        diffHours === 1 ? "" : "s"
      } ago`;
    }

    const diffDays = Math.floor(diffHours / 24);

    return `${diffDays} day${
      diffDays === 1 ? "" : "s"
    } ago`;
  };

  const getAlertDisplayClass = (color) => {
    switch (String(color || "").toLowerCase()) {
      case "red":
        return "warning";

      case "orange":
        return "warning";

      case "yellow":
        return "info";

      case "green":
        return "safe-symbol";

      default:
        return "info";
    }
  };

  const getAlertStatusClass = (color) => {
    switch (String(color || "").toLowerCase()) {
      case "red":
      case "orange":
        return "active-status";

      case "yellow":
        return "monitoring";

      case "green":
        return "resolved";

      default:
        return "monitoring";
    }
  };

  const getAlertStatusText = (color) => {
    switch (String(color || "").toLowerCase()) {
      case "red":
      case "orange":
        return "Active";

      case "yellow":
        return "Monitoring";

      case "green":
        return "Resolved";

      default:
        return "Monitoring";
    }
  };

  // =========================================================
  // LOGIN SCREEN
  // =========================================================

  if (!loggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  // FORCE PASSWORD CHANGE IF REQUIRED
  if (session?.user?.mustChangePassword) {
    return (
      <div className="auth-v2" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ maxWidth: "440px", width: "100%", background: "#fff", padding: "32px", borderRadius: "16px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", border: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#0f172a", marginBottom: "8px" }}>Change Temporary Password</h2>
          <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "20px" }}>
            Your account requires you to choose a new secure password before proceeding.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const newPassword = e.target.newPassword.value;
              const currentPassword = e.target.currentPassword.value;
              if (newPassword.length < 8) {
                alert("Password must be at least 8 characters");
                return;
              }
              try {
                await apiFetch("/api/auth/change-password", {
                  method: "POST",
                  body: JSON.stringify({ currentPassword, newPassword }),
                });
                const updatedSession = { ...session, user: { ...session.user, mustChangePassword: false } };
                saveSession(updatedSession);
                setSession(updatedSession);
                alert("Password changed successfully!");
              } catch (err) {
                alert(err.message || "Failed to update password");
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>CURRENT PASSWORD</label>
              <input name="currentPassword" type="password" required className="auth-input-base" style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: "4px" }}>NEW PASSWORD (MIN 8 CHARS)</label>
              <input name="newPassword" type="password" required className="auth-input-base" style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
            </div>
            <button type="submit" className="auth-submit-btn" style={{ marginTop: "8px" }}>Save & Continue</button>
            <button type="button" onClick={handleLogout} className="auth-text-btn" style={{ alignSelf: "center", marginTop: "4px" }}>Log Out</button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================
  // VILLAGER (Always permitted)
  // =========================================================

  if (role === "villager") {
    return <VillagerDashboard user={session.user} onLogout={handleLogout} />;
  }

  // =========================================================
  // PRIVILEGED ROLES VERIFICATION CHECK
  // =========================================================

  const verificationStatus = session.user?.verificationStatus;

  // If NGO or Control is NOT verified, show StatusScreen
  if (["ngo", "control"].includes(role) && verificationStatus !== "VERIFIED") {
    return (
      <StatusScreen
        user={session.user}
        onStatusUpdated={(updatedUser) => {
          const updatedSession = { ...session, user: updatedUser, role: updatedUser.role };
          saveSession(updatedSession);
          setSession(updatedSession);
        }}
        onLogout={handleLogout}
      />
    );
  }

  // NGO (VERIFIED)
  if (role === "ngo") {
    return <NgoDashboard user={session.user} onLogout={handleLogout} />;
  }

  // SUPER ADMIN (Platform Console)
  if (role === "super_admin") {
    return <AdminDashboard user={session.user} onLogout={handleLogout} />;
  }

  // CONTROL (PANCHAYAT / DISTRICT AUTHORITY VERIFIED) continue to Control Centre below

  // =========================================================
  // CALCULATED VALUES
  // =========================================================

  const pendingSOS = sosRequests.filter(
    (sos) => sos.status === "Pending"
  ).length;

  // Newest High/Severe alert from the last 24 hours, shown as the red banner
  const latestSerious = alerts.find(
    (alert) =>
      ["High", "Severe"].includes(alert.riskLevel) &&
      alert.createdAt &&
      new Date() - new Date(alert.createdAt) < 24 * 60 * 60 * 1000
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // NGOs currently handling at least one SOS
  const busyNgoIds = new Set(
    sosRequests
      .filter((sos) => sos.status === "In Progress" && sos.assignedTo)
      .map((sos) => sos.assignedTo._id || sos.assignedTo)
  );

  const availableShelters = shelters.filter(
    (shelter) => shelter.status !== "Full"
  ).length;

  // =========================================================
  // CONTROL CENTRE
  // =========================================================

  return (
    <div className="app">

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>

        <div className="brand">

          <div className="brand-icon">
            🛡️
          </div>

          <div>
            <h2>SAHAYTA SETU</h2>
            <span>Disaster Control</span>
          </div>

        </div>


        <div className="location">

          <span className="location-dot"></span>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <small>{role === 'super_admin' ? 'SUPER ADMIN' : 'GRAM PANCHAYAT'}</small>
              {session?.user?.isDemo && (
                <span style={{ fontSize: '0.62rem', background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, border: '1px solid #fde68a' }}>
                  DEMO ACCOUNT
                </span>
              )}
            </div>
            <p>{role === 'super_admin' ? 'National Coordination' : (session?.user?.district ? `${session.user.district}${session.user.state ? `, ${session.user.state}` : ''}` : "India")}</p>
          </div>

        </div>


        <nav onClick={() => setMobileNavOpen(false)}>
          <button
            className={`nav-item ${activeView === "dashboard" ? "active" : ""}`}
            onClick={() => openView("dashboard")}
          >
            <span>▦</span>
            Dashboard
          </button>

          <button
            className={`nav-item ${activeView === "alerts" ? "active" : ""}`}
            onClick={() => openView("alerts")}
          >
            <span>⚠</span>
            Live Alerts
            <b className="nav-badge">{alerts.length}</b>
          </button>

          <button
            className={`nav-item ${activeView === "sos" ? "active" : ""}`}
            onClick={() => openView("sos")}
          >
            <span>🆘</span>
            SOS Requests
            <b className="nav-badge red">{sosRequests.length}</b>
          </button>

          <button
            className={`nav-item ${activeView === "map" ? "active" : ""}`}
            onClick={() => openView("map")}
          >
            <span>⌖</span>
            Risk Map
          </button>

          <button
            className={`nav-item ${activeView === "shelters" ? "active" : ""}`}
            onClick={() => openView("shelters")}
          >
            <span>⌂</span>
            Shelters
          </button>

          <button
            className={`nav-item ${activeView === "evacuation" ? "active" : ""}`}
            onClick={() => openView("evacuation")}
          >
            <span>👪</span>
            Evacuation
          </button>

          <button
            className={`nav-item ${activeView === "responders" ? "active" : ""}`}
            onClick={() => openView("responders")}
          >
            <span>♧</span>
            Responders
          </button>

          <button
            className={`nav-item ${activeView === "verifications" ? "active" : ""}`}
            onClick={() => openView("verifications")}
          >
            <span>🛡️</span>
            Verification Center
          </button>

          <button
            className={`nav-item ${activeView === "audit" ? "active" : ""}`}
            onClick={() => openView("audit")}
          >
            <span>📜</span>
            Audit Logs
          </button>
        </nav>


        <div className="sidebar-bottom">

          <div className="system-status">

            <span className="status-dot"></span>

            <div>
              <strong>System Online</strong>
              <small>All services operational</small>
            </div>

          </div>

        </div>

      </aside>


      {/* =====================================================
          MAIN
      ===================================================== */}

      <main className="main">

        {/* ===================================================
            HEADER
        =================================================== */}

        <header className="topbar">

          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span aria-hidden="true">{mobileNavOpen ? "×" : "☰"}</span>
          </button>

          <div>

            <p className="breadcrumb">
              GRAM PANCHAYAT / {VIEW_TITLES[activeView]}
            </p>

            <h1>
              {greeting}, {session.user?.name?.split(" ")[0] || "Officer"}
            </h1>

            <p className="subtitle">
              Here's what's happening across your monitored region.
            </p>

          </div>


          <div className="header-actions">

            <div className="live-indicator">
              <span></span>
              LIVE
            </div>

            <ProfileMenu
              className="profile"
              avatarClassName="avatar"
              initials={initials(session.user?.name || "Control Officer")}
              name={session.user?.name || "Panchayat Officer"}
              subtitle="Gram Panchayat"
              phone={session.user?.phone}
              onLogout={handleLogout}
            />

          </div>

        </header>


        {activeView === "dashboard" && (
          <>
        {/* ===================================================
            ALERT BANNER
        =================================================== */}

        {latestSerious && (
          <section className="critical-banner">

            <div className="critical-icon">
              ⚠
            </div>

            <div className="critical-text">
              <strong>
                {String(latestSerious.riskLevel).toUpperCase()} ALERT ACTIVE
              </strong>

              <p>
                {latestSerious.message}
              </p>
            </div>

            <div className="critical-location">
              <span>●</span>
              {[latestSerious.village, latestSerious.district].filter(Boolean).join(", ") || "Region-wide"}
            </div>

            <button className="view-alert" onClick={() => openView("alerts")}>
              View Alert →
            </button>

          </section>
        )}


        {/* ===================================================
            STAT CARDS
        =================================================== */}

        <section className="stats">

          <div className="stat-card">

            <div className="stat-top">

              <span>ACTIVE ALERTS</span>

              <div className="stat-icon orange">
                ⚠
              </div>

            </div>

            <h2>
              {alerts.length}
            </h2>

            <p>
              <span className="up">
                {
                  alerts.filter(
                    (alert) =>
                      alert.riskLevel?.toLowerCase() ===
                      "severe"
                  ).length
                } severe
              </span>
              recent alerts
            </p>

          </div>


          <div className="stat-card">

            <div className="stat-top">

              <span>ACTIVE SOS</span>

              <div className="stat-icon red-icon">
                🆘
              </div>

            </div>

            <h2>
              {sosRequests.length}
            </h2>

            <p>
              <span className="danger">
                {pendingSOS} pending
              </span>
              requiring response
            </p>

          </div>


          <div className="stat-card">

            <div className="stat-top">

              <span>RESPONDERS</span>

              <div className="stat-icon blue">
                ♧
              </div>

            </div>

            <h2>{ngos.length}</h2>
            <p>
              <span className="up">{busyNgoIds.size}</span>
              {" "}currently responding
            </p>

          </div>


          <div className="stat-card">

            <div className="stat-top">

              <span>SHELTERS</span>

              <div className="stat-icon green">
                ⌂
              </div>

            </div>

            <h2>
              {shelters.length}
            </h2>

            <p>
              <span className="safe">
                {availableShelters} available
              </span>
              · {shelters.length - availableShelters} full
            </p>

          </div>

        </section>

        {/* ===================================================
            EVACUATION SUMMARY
        =================================================== */}

        <section className="panel evac-summary">
          <div className="panel-header">
            <div>
              <h3>Evacuation Status</h3>
              <p>
                {evacuation?.totals?.families
                  ? `${evacuation.totals.totalMembers} people reported by ${evacuation.totals.families} families`
                  : "Waiting for families to report where they went"}
              </p>
            </div>
            <button className="text-btn" onClick={() => openView("evacuation")}>
              View details →
            </button>
          </div>

          {evacuation?.totals?.families > 0 && (
            <>
              <EvacuationBar row={evacuation.totals} />
              <div className="evac-summary-numbers">
                <span><b>{evacuation.totals.inShelter}</b> in shelter</span>
                <span><b>{evacuation.totals.withRelatives}</b> with relatives</span>
                <span><b>{evacuation.totals.atHome}</b> stayed home</span>
                <span><b>{evacuation.totals.elsewhere}</b> place unknown</span>
                <span><b>{evacuation.totals.unaccounted}</b> not reported</span>
              </div>
              <EvacuationLegend />
            </>
          )}
        </section>


        {/* ===================================================
            CONTENT GRID
        =================================================== */}

        <section className="dashboard-grid">

          {/* =================================================
              RISK MAP
          ================================================= */}

          <div className="panel map-panel">

            <div className="panel-header">

              <div>

                <h3>
                  Regional Risk Overview
                </h3>

                <p>
                  Live risk levels across monitored villages
                </p>

              </div>

              <button className="outline-btn" onClick={() => openView("map")}>
                Full Map ↗
              </button>

            </div>


            <div className="embedded-map">
              <GramPanchayatMap />
            </div>

          </div>


          {/* =================================================
              SOS
          ================================================= */}

          <div className="panel sos-panel">

            <div className="panel-header">

              <div>

                <h3>
                  Live SOS Requests
                </h3>

                <p>
                  Requests requiring attention
                </p>

              </div>

              <span className="count-pill">
                {sosRequests.length} Active
              </span>

            </div>


            <div className="sos-list">

              {sosLoading && (

                <div className="sos-item">

                  <div className="sos-info">

                    <strong>
                      Loading live SOS requests...
                    </strong>

                    <small>
                      Connecting to emergency service
                    </small>

                  </div>

                </div>

              )}


              {!sosLoading &&
                sosError && (

                  <div className="sos-item">

                    <div className="sos-info">

                      <strong>
                        Unable to load SOS requests
                      </strong>

                      <small>
                        {sosError}
                      </small>

                    </div>

                  </div>

                )}


              {!sosLoading &&
                !sosError &&
                sosRequests.length === 0 && (

                  <div className="sos-item">

                    <div className="sos-avatar">
                      ✓
                    </div>

                    <div className="sos-info">

                      <strong>
                        No active SOS requests
                      </strong>

                      <small>
                        All emergency requests are currently handled.
                      </small>

                    </div>

                  </div>

                )}


              {!sosLoading &&
                !sosError &&
                sosRequests.length > 0 &&
                sosRequests
                  .slice(0, 4)
                  .map((sos) => {

                    const village =
                      sos.village ||
                      "Unknown location";

                    const type =
                      sos.type ||
                      "Emergency";

                    const initials =
                      village
                        .split(" ")
                        .map(
                          (word) => word[0]
                        )
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();

                    const isPending =
                      sos.status === "Pending";

                    return (

                      <div
                        className={`sos-item ${
                          isPending
                            ? "critical-item"
                            : ""
                        }`}
                        key={sos._id}
                      >

                        <div className="sos-avatar">
                          {initials}
                        </div>

                        <div className="sos-info">

                          <strong>
                            {village}
                          </strong>

                          <span>
                            {village} · {type}
                          </span>

                          <small>
                            {sos.status}
                          </small>

                        </div>

                        <span
                          className={`priority ${
                            isPending
                              ? "critical-priority"
                              : "high-priority"
                          }`}
                        >

                          {isPending
                            ? "PENDING"
                            : "IN PROGRESS"}

                        </span>

                      </div>

                    );

                  })}

            </div>


            <button className="view-all" onClick={() => openView("sos", "active")}>
              View all SOS requests →
            </button>

          </div>

        </section>


        {/* ===================================================
            BOTTOM GRID
        =================================================== */}

        <section className="bottom-grid">

          {/* =================================================
              RECENT ALERTS
          ================================================= */}

          <div className="panel">

            <div className="panel-header">

              <div>

                <h3>
                  Recent Alerts
                </h3>

                <p>
                  Latest system notifications
                </p>

              </div>

              <button className="text-btn" onClick={() => openView("alerts")}>
                View all →
              </button>

            </div>


            {alertsLoading && (

              <div className="alert-row">

                <span className="alert-symbol info">
                  ●
                </span>

                <div>

                  <strong>
                    Loading live alerts...
                  </strong>

                  <p>
                    Connecting to alert service
                  </p>

                </div>

              </div>

            )}


            {!alertsLoading &&
              alertsError && (

                <div className="alert-row">

                  <span className="alert-symbol warning">
                    ⚠
                  </span>

                  <div>

                    <strong>
                      Unable to load alerts
                    </strong>

                    <p>
                      {alertsError}
                    </p>

                  </div>

                </div>

              )}


            {!alertsLoading &&
              !alertsError &&
              alerts.length === 0 && (

                <div className="alert-row">

                  <span className="alert-symbol safe-symbol">
                    ✓
                  </span>

                  <div>

                    <strong>
                      No recent alerts
                    </strong>

                    <p>
                      The alert system has no recorded alerts.
                    </p>

                  </div>

                </div>

              )}


            {!alertsLoading &&
              !alertsError &&
              alerts.slice(0, 3).map((alert) => (

                <div
                  className="alert-row"
                  key={alert._id}
                >

                  <span
                    className={`alert-symbol ${getAlertDisplayClass(
                      alert.color
                    )}`}
                  >
                    {String(alert.color || "").toLowerCase() ===
                    "green"
                      ? "✓"
                      : "⚠"}
                  </span>

                  <div>

                    <strong>
                      {alert.riskLevel
                        ? `${alert.riskLevel} risk alert`
                        : "Emergency alert"}
                    </strong>

                    <p>
                      {alert.village || "Unknown village"} ·{" "}
                      {alert.district || "Unknown district"} ·{" "}
                      {formatAlertTime(alert.createdAt)}
                    </p>

                    <small>
                      {alert.message ||
                        "Emergency warning issued."}

                      {alert.sms?.mode === "simulated"
                        ? " · SMS: demo mode"
                        : ""}
                    </small>

                  </div>

                  <span
                    className={`alert-status ${getAlertStatusClass(
                      alert.color
                    )}`}
                  >
                    {getAlertStatusText(alert.color)}
                  </span>

                </div>

              ))}


          </div>


          {/* =================================================
              SHELTERS
          ================================================= */}

          <div className="panel">

            <div className="panel-header">

              <div>

                <h3>
                  Shelter Capacity
                </h3>

                <p>
                  Current occupancy
                </p>

              </div>

              <button className="text-btn" onClick={() => openView("shelters")}>
                Manage →
              </button>

            </div>


            {shelterLoading && (

              <div className="shelter">

                <strong>
                  Loading shelters...
                </strong>

              </div>

            )}


            {!shelterLoading &&
              !shelterError &&
              shelters.slice(0, 3).map(
                (shelter, index) => {

                  const capacity =
                    Number(shelter.capacity) || 0;

                  const occupancy =
                    Number(
                      shelter.currentOccupancy
                    ) || 0;

                  const percentage =
                    capacity > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (occupancy /
                              capacity) *
                              100
                          )
                        )
                      : 0;

                  let fillClass =
                    "green-fill";

                  if (percentage >= 80) {
                    fillClass =
                      "red-fill";
                  } else if (
                    percentage >= 60
                  ) {
                    fillClass =
                      "orange-fill";
                  }

                  return (

                    <div
                      className="shelter"
                      key={
                        shelter._id || index
                      }
                    >

                      <div className="shelter-title">

                        <strong>
                          {shelter.name}
                        </strong>

                        <span>
                          {percentage}%
                        </span>

                      </div>


                      <div className="progress">

                        <div
                          className={`progress-fill ${fillClass}`}
                          style={{
                            width: `${percentage}%`,
                          }}
                        ></div>

                      </div>


                      <small>
                        {occupancy} / {capacity} people
                        {" · "}
                        {shelter.status ||
                          "Available"}
                      </small>

                    </div>

                  );

                }
              )}

          </div>


          {/* =================================================
              RESPONDERS
          ================================================= */}

          <div className="panel">

            <div className="panel-header">

              <div>

                <h3>
                  Responder Status
                </h3>

                <p>
                  NGO response activity
                </p>

              </div>

              <button className="text-btn" onClick={() => openView("responders")}>
                View all →
              </button>

            </div>


            {ngosLoading && (
              <p className="panel-empty">Loading responders...</p>
            )}

            {!ngosLoading && ngos.length === 0 && (
              <p className="panel-empty">
                No NGOs registered yet. They appear after their first login.
              </p>
            )}

            {ngos.slice(0, 3).map((ngo) => {
              const busy = busyNgoIds.has(ngo._id);
              return (
                <div className="responder" key={ngo._id}>
                  <div className="responder-icon">🚑</div>

                  <div>
                    <strong>{ngo.name}</strong>
                    <span>
                      {[ngo.district, ngo.contactPerson].filter(Boolean).join(" · ") || "NGO"}
                    </span>
                  </div>

                  <b className={busy ? "on-way" : "accepted"}>
                    {busy ? "Responding" : "Available"}
                  </b>
                </div>
              );
            })}

          </div>

        </section>


        {/* ===================================================
            EMERGENCY ALERT ACTION
        =================================================== */}

        <section className="action-bar">

          <div>

            <strong>
              Need to broadcast an emergency alert?
            </strong>

            <p>
              Send an immediate warning to affected
              villages and responders.
            </p>

          </div>


          <button
            className="alert-button"
            onClick={openAlertModal}
          >
            🔊 Activate Emergency Alert
          </button>

        </section>


          </>
        )}

        {activeView === "alerts" && (
          <AlertsView
            alerts={alerts}
            loading={alertsLoading}
            error={alertsError}
            onNewAlert={openAlertModal}
            onRetransmitAlert={async (alertItem) => {
              await apiFetch(`/api/alerts/${alertItem._id}/retransmit`, { method: "POST" });
              fetchAlerts();
            }}
          />
        )}

        {activeView === "sos" && (
          <SOSView
            requests={allSOS}
            loading={sosLoading}
            error={sosError}
            filter={sosFilter}
            onFilterChange={setSosFilter}
            onAssignResponder={() => {
              fetchSOSRequests();
            }}
          />
        )}

        {activeView === "verifications" && <VerificationCenterView />}

        {activeView === "audit" && <AuditLogView />}

        {activeView === "map" && <MapView />}

        {activeView === "evacuation" && (
          <EvacuationView data={evacuation} loading={evacLoading} error={evacError} />
        )}

        {activeView === "shelters" && (
          <SheltersView
            shelters={shelters}
            loading={shelterLoading}
            error={shelterError}
            onChanged={fetchShelters}
          />
        )}

        {activeView === "responders" && (
          <RespondersView
            ngos={ngos}
            loading={ngosLoading}
            error={ngosError}
            sosRequests={sosRequests}
          />
        )}

        {/* ===================================================
            EMERGENCY ALERT MODAL
        =================================================== */}

        {showAlertModal && (

          <div className="alert-modal-overlay">

            <div className="alert-modal">

              <div className="alert-modal-header">

                <div>

                  <div className="alert-modal-icon">
                    🚨
                  </div>

                  <h2>
                    Emergency Alert
                  </h2>

                  <p>
                    Broadcast a warning to an affected
                    village.
                  </p>

                </div>


                <button
                  className="modal-close"
                  onClick={closeAlertModal}
                  disabled={alertLoading}
                >
                  ✕
                </button>

              </div>


              {/* DISTRICT (fixed to the officer's own district or selectable India-wide) */}

              <div className="form-group">

                {session?.user?.district ? (
                  <div className="alert-district-locked">
                    📍 {session.user.district}{session.user.state ? `, ${session.user.state}` : ""}
                  </div>
                ) : (
                  <LocationSelector
                    selectedState={alertState}
                    selectedDistrict={alertDistrict}
                    onChange={({ state, district }) => {
                      setAlertState(state);
                      setAlertDistrict(district);
                      setAlertVillage("");
                      setOtherVillage("");
                    }}
                    disabled={alertLoading}
                  />
                )}

              </div>


              {/* VILLAGE */}

              <div className="form-group">

                <label>
                  Affected Village
                </label>

                <select
                  value={alertVillage}
                  onChange={(e) => setAlertVillage(e.target.value)}
                  disabled={alertLoading}
                >
                  <option value="">
                    All villages in {alertDistrict}
                  </option>

                  {(alertAreas.villages[alertDistrict] || []).map((village) => (
                    <option key={village.name} value={village.name}>
                      {village.name} ({village.villagers} registered)
                    </option>
                  ))}

                  <option value={OTHER_VILLAGE}>
                    Other village (type name)
                  </option>
                </select>

                {alertVillage === OTHER_VILLAGE && (
                  <input
                    type="text"
                    className="alert-other-village"
                    value={otherVillage}
                    onChange={(e) => setOtherVillage(e.target.value)}
                    disabled={alertLoading}
                    placeholder="Village name"
                  />
                )}

              </div>


              {/* RISK LEVEL */}

              <div className="form-group">

                <label>
                  Risk Level
                </label>

                <select
                  value={alertRiskLevel}
                  onChange={(e) =>
                    setAlertRiskLevel(
                      e.target.value
                    )
                  }
                  disabled={alertLoading}
                >

                  <option value="Low">
                    Low
                  </option>

                  <option value="Moderate">
                    Moderate
                  </option>

                  <option value="High">
                    High
                  </option>

                  <option value="Severe">
                    Severe
                  </option>

                </select>

              </div>


              {/* SUCCESS */}

              {alertMessage && (

                <div className="alert-success">
                  ✓ {alertMessage}
                </div>

              )}


              {/* ERROR */}

              {alertError && (

                <div className="alert-error">
                  ⚠ {alertError}
                </div>

              )}


              {/* BUTTONS */}

              <div className="alert-modal-actions">

                <button
                  className="cancel-alert"
                  onClick={closeAlertModal}
                  disabled={alertLoading}
                >
                  Cancel
                </button>


                <button
                  className="confirm-alert"
                  onClick={triggerEmergencyAlert}
                  disabled={alertLoading}
                >

                  {alertLoading
                    ? "Sending..."
                    : "🚨 Trigger Alert"}

                </button>

              </div>

            </div>

          </div>

        )}

      </main>

    </div>
  );
}

export default App;