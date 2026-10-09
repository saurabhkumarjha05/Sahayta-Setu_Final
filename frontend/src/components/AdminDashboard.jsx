import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../api";
import { getSocket } from "../utils/socketClient";
import LocationSelector from "./LocationSelector";
import { DEFAULT_STATE } from "../config/locationConfig";
import "./AdminDashboard.css";

export default function AdminDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "organizations" | "citizens" | "shelters" | "audit" | "account"
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);

  // Platform Statistics
  const [stats, setStats] = useState({
    totalOrganizations: 0,
    pendingOrganizations: 0,
    verifiedOrganizations: 0,
    totalCitizens: 0,
    activeShelters: 0,
    totalIncidents: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Organizations
  const [entities, setEntities] = useState([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState(null);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [promptDialog, setPromptDialog] = useState(null); // { type: 'reject' | 'suspend', title: '', placeholder: '', onConfirm: fn }
  const [promptText, setPromptText] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  const [tempPasswordResult, setTempPasswordResult] = useState(null);

  // Citizens
  const [citizens, setCitizens] = useState([]);
  const [citizensLoading, setCitizensLoading] = useState(false);
  const [citizenSearch, setCitizenSearch] = useState("");

  // Shelters
  const [shelters, setShelters] = useState([]);
  const [sheltersLoading, setSheltersLoading] = useState(false);
  const [showAddShelterModal, setShowAddShelterModal] = useState(false);
  const [newShelterName, setNewShelterName] = useState("");
  const [newShelterType, setNewShelterType] = useState("SHELTER");
  const [newShelterAddress, setNewShelterAddress] = useState("");
  const [newShelterState, setNewShelterState] = useState(DEFAULT_STATE);
  const [newShelterDistrict, setNewShelterDistrict] = useState("");
  const [newShelterCapacity, setNewShelterCapacity] = useState(100);
  const [newShelterContact, setNewShelterContact] = useState("");
  const [newShelterLat, setNewShelterLat] = useState("30.3165");
  const [newShelterLng, setNewShelterLng] = useState("78.0322");

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Top banner toast ref
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 8000);
  }, []);

  // Fetch stats from backend
  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch("/api/admin/stats");
      if (data) {
        setStats({
          totalOrganizations: data.totalOrganizations ?? 0,
          pendingOrganizations: data.pendingOrganizations ?? 0,
          verifiedOrganizations: data.verifiedOrganizations ?? 0,
          totalCitizens: data.totalCitizens ?? 0,
          activeShelters: data.activeShelters ?? 0,
          totalIncidents: data.totalIncidents ?? 0,
        });
      }
    } catch (err) {
      console.warn("Could not load admin stats:", err.message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch organizations
  const fetchEntities = useCallback(async () => {
    try {
      setEntitiesLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (typeFilter !== "ALL") params.append("type", typeFilter);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const data = await apiFetch(`/api/admin/entities?${params.toString()}`);
      setEntities(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load organizations:", err);
    } finally {
      setEntitiesLoading(false);
    }
  }, [statusFilter, typeFilter, searchQuery]);

  // Fetch citizens
  const fetchCitizens = useCallback(async () => {
    try {
      setCitizensLoading(true);
      const params = citizenSearch.trim() ? `?search=${encodeURIComponent(citizenSearch.trim())}` : "";
      const data = await apiFetch(`/api/admin/citizens${params}`);
      setCitizens(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load citizens:", err);
    } finally {
      setCitizensLoading(false);
    }
  }, [citizenSearch]);

  // Fetch shelters
  const fetchShelters = useCallback(async () => {
    try {
      setSheltersLoading(true);
      const data = await apiFetch("/api/shelters");
      setShelters(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load shelters:", err);
    } finally {
      setSheltersLoading(false);
    }
  }, []);

  // Fetch audit logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      setAuditLoading(true);
      const data = await apiFetch("/api/audit-logs");
      setAuditLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // Initial load & Socket setup
  useEffect(() => {
    const initialLoad = setTimeout(() => {
      fetchStats();
      fetchEntities();
    }, 0);

    const socket = getSocket();
    if (!socket) return () => clearTimeout(initialLoad);

    const connectedTimer = socket.connected
      ? setTimeout(() => setLiveConnected(true), 0)
      : null;

    const onConnect = () => setLiveConnected(true);
    const onDisconnect = () => setLiveConnected(false);

    const onNewOrg = (data) => {
      showToast(`🔔 New organization registered: ${data?.organizationName || 'New Entity'} (${data?.organizationType || 'NGO'})`);
      fetchStats();
      fetchEntities();
    };

    const onOrgUpdated = (data) => {
      fetchStats();
      fetchEntities();
      if (selectedEntity && selectedEntity._id === data?._id) {
        setSelectedEntity(prev => ({ ...prev, ...data }));
      }
    };

    const onPendingCount = (count) => {
      setStats(prev => ({ ...prev, pendingOrganizations: count }));
    };

    const onResourceChange = () => {
      fetchShelters();
      fetchStats();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("admin:entity-registered", onNewOrg);
    socket.on("admin:entity-updated", onOrgUpdated);
    socket.on("admin:pending-count", onPendingCount);
    socket.on("resource:created", onResourceChange);
    socket.on("resource:updated", onResourceChange);
    socket.on("resource:closed", onResourceChange);

    return () => {
      clearTimeout(initialLoad);
      if (connectedTimer) clearTimeout(connectedTimer);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("admin:entity-registered", onNewOrg);
      socket.off("admin:entity-updated", onOrgUpdated);
      socket.off("admin:pending-count", onPendingCount);
      socket.off("resource:created", onResourceChange);
      socket.off("resource:updated", onResourceChange);
      socket.off("resource:closed", onResourceChange);
    };
  }, [fetchStats, fetchEntities, fetchShelters, selectedEntity, showToast]);

  // Periodic 30s background sync
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      if (activeTab === "organizations") fetchEntities();
      if (activeTab === "citizens") fetchCitizens();
      if (activeTab === "shelters") fetchShelters();
      if (activeTab === "audit") fetchAuditLogs();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, fetchStats, fetchEntities, fetchCitizens, fetchShelters, fetchAuditLogs]);

  // Trigger tab data fetch
  useEffect(() => {
    const tabFetch = setTimeout(() => {
      if (activeTab === "citizens") fetchCitizens();
      if (activeTab === "shelters") fetchShelters();
      if (activeTab === "audit") fetchAuditLogs();
      if (activeTab === "organizations") fetchEntities();
    }, 0);
    return () => clearTimeout(tabFetch);
  }, [activeTab, fetchCitizens, fetchShelters, fetchAuditLogs, fetchEntities]);

  // Entity Actions
  const handleApprove = async (entityId) => {
    if (!confirm("Are you sure you want to approve and verify this organization for live disaster operations?")) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/admin/entities/${entityId}/approve`, { method: "POST" });
      showToast("✓ Organization approved and verified successfully.");
      fetchEntities();
      fetchStats();
      setSelectedEntity(null);
    } catch (err) {
      alert(err.message || "Failed to approve organization");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReject = (entity) => {
    setPromptText("");
    setPromptDialog({
      type: "reject",
      title: `Reject Application: ${entity.organizationName}`,
      placeholder: "Provide reason for rejection (e.g. invalid credentials or missing documentation)...",
      onConfirm: async (reason) => {
        setActionLoading(true);
        try {
          await apiFetch(`/api/admin/entities/${entity._id}/reject`, {
            method: "POST",
            body: JSON.stringify({ reason }),
          });
          showToast("✕ Organization application rejected.");
          fetchEntities();
          fetchStats();
          setSelectedEntity(null);
          setPromptDialog(null);
        } catch (err) {
          alert(err.message || "Failed to reject organization");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleOpenSuspend = (entity) => {
    setPromptText("");
    setPromptDialog({
      type: "suspend",
      title: `Suspend Organization: ${entity.organizationName}`,
      placeholder: "Reason for temporary suspension...",
      onConfirm: async (reason) => {
        setActionLoading(true);
        try {
          await apiFetch(`/api/admin/entities/${entity._id}/suspend`, {
            method: "POST",
            body: JSON.stringify({ reason }),
          });
          showToast("⏸️ Organization suspended.");
          fetchEntities();
          fetchStats();
          setSelectedEntity(null);
          setPromptDialog(null);
        } catch (err) {
          alert(err.message || "Failed to suspend organization");
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleRevoke = async (entityId) => {
    if (!confirm("Are you sure you want to revoke authorization for this organization?")) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/admin/entities/${entityId}/revoke`, { method: "POST" });
      showToast("🚫 Authorization revoked.");
      fetchEntities();
      fetchStats();
      setSelectedEntity(null);
    } catch (err) {
      alert(err.message || "Failed to revoke authorization");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReinstate = async (entityId) => {
    if (!confirm("Reinstate this organization to Active status?")) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/admin/entities/${entityId}/reinstate`, { method: "POST" });
      showToast("🔄 Organization reinstated.");
      fetchEntities();
      fetchStats();
      setSelectedEntity(null);
    } catch (err) {
      alert(err.message || "Failed to reinstate organization");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (entityId) => {
    if (!confirm("Generate a temporary password for this organization account? The user will be required to change it upon next login.")) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/admin/entities/${entityId}/reset-password`, { method: "POST" });
      setTempPasswordResult(res.temporaryPassword);
      showToast("🔑 Temporary password generated successfully.");
    } catch (err) {
      alert(err.message || "Failed to reset password");
    } finally {
      setActionLoading(false);
    }
  };

  // Add Shelter
  const handleCreateShelter = async (e) => {
    e.preventDefault();
    if (!newShelterName.trim()) {
      alert("Please enter shelter name");
      return;
    }
    if (!newShelterDistrict) {
      alert("Please select district");
      return;
    }
    setActionLoading(true);
    try {
      await apiFetch("/api/shelters", {
        method: "POST",
        body: JSON.stringify({
          name: newShelterName.trim(),
          type: newShelterType,
          address: newShelterAddress.trim(),
          state: newShelterState,
          district: newShelterDistrict,
          capacity: Number(newShelterCapacity) || 100,
          publicContact: newShelterContact.trim(),
          location: {
            lat: parseFloat(newShelterLat) || 30.3165,
            lng: parseFloat(newShelterLng) || 78.0322,
          },
        }),
      });
      showToast("✓ Shelter created and verified successfully.");
      setShowAddShelterModal(false);
      setNewShelterName("");
      setNewShelterAddress("");
      setNewShelterContact("");
      fetchShelters();
      fetchStats();
    } catch (err) {
      alert(err.message || "Failed to create shelter");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloseShelter = async (shelterId) => {
    if (!confirm("Are you sure you want to mark this facility as CLOSED?")) return;
    try {
      await apiFetch(`/api/shelters/${shelterId}/close`, { method: "POST" });
      showToast("Facility marked as closed.");
      fetchShelters();
      fetchStats();
    } catch (err) {
      alert(err.message || "Failed to close shelter");
    }
  };

  return (
    <div className="admin-layout">
      {/* ===================================================
          LEFT SCROLLABLE SIDEBAR (100dvh, Sticky Header/Footer)
      =================================================== */}
      <aside className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}>
        {/* Sticky Header */}
        <div className="admin-sidebar-header">
          <div className="admin-brand">
            <img
              src="/icon-192.svg"
              alt="Sahayta Setu Shield Logo"
              className="admin-brand-logo"
            />
            <div>
              <div className="admin-brand-title">Sahayta Setu</div>
              <div className="admin-brand-badge">Super Admin Console</div>
            </div>
          </div>

          <div className="admin-live-strip">
            <span>
              <span className={`admin-live-dot ${liveConnected ? "" : "reconnecting"}`} />
              {liveConnected ? "Realtime Live" : "Polling Sync"}
            </span>
            <span style={{ fontSize: "0.7rem", color: "#64748b" }}>v2.4.0</span>
          </div>
        </div>

        {/* Scrollable Navigation Area */}
        <nav className="admin-sidebar-nav">
          <button
            type="button"
            className={`admin-nav-item ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("overview");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>📊</span>
              <span>Overview</span>
            </div>
          </button>

          <button
            type="button"
            className={`admin-nav-item ${activeTab === "organizations" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("organizations");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>🏢</span>
              <span>Organizations & Responders</span>
            </div>
            {stats.pendingOrganizations > 0 && (
              <span className="admin-nav-badge">{stats.pendingOrganizations}</span>
            )}
          </button>

          <button
            type="button"
            className={`admin-nav-item ${activeTab === "citizens" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("citizens");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>👨‍🌾</span>
              <span>Citizens Directory</span>
            </div>
          </button>

          <button
            type="button"
            className={`admin-nav-item ${activeTab === "shelters" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("shelters");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>🏠</span>
              <span>Shelters & Relief</span>
            </div>
          </button>

          <button
            type="button"
            className={`admin-nav-item ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("audit");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>📜</span>
              <span>Audit Trail</span>
            </div>
          </button>

          <button
            type="button"
            className={`admin-nav-item ${activeTab === "account" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("account");
              setSidebarOpen(false);
            }}
          >
            <div className="admin-nav-item-content">
              <span>👤</span>
              <span>Admin Profile</span>
            </div>
          </button>
        </nav>

        {/* Sticky Footer */}
        <div className="admin-sidebar-footer">
          <div className="admin-user-profile">
            <div className="admin-avatar">
              {(user?.name || user?.email || "SA").substring(0, 2).toUpperCase()}
            </div>
            <div className="admin-user-info">
              <div className="admin-user-name">{user?.name || "Platform Admin"}</div>
              <div className="admin-user-role">{user?.email || "superadmin@sahaytasetu.gov.in"}</div>
            </div>
          </div>

          <button type="button" onClick={onLogout} className="admin-logout-btn">
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ===================================================
          MAIN WORKSPACE AREA
      =================================================== */}
      <main className="admin-main">
        {/* Mobile Top Header */}
        <div className="admin-topbar-mobile">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ background: "none", border: "none", color: "#fff", fontSize: "1.4rem", cursor: "pointer", padding: "4px" }}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            <span style={{ fontWeight: 700, fontSize: "1rem" }}>Sahayta Setu Admin</span>
          </div>
          <span style={{ fontSize: "0.75rem", background: "rgba(59,130,246,0.2)", padding: "3px 8px", borderRadius: "4px", color: "#93c5fd" }}>
            Super Admin
          </span>
        </div>

        <div className="admin-content-wrapper">
          {/* Toast Banner */}
          {toastMessage && (
            <div className="admin-toast-banner" role="alert">
              <span>{toastMessage}</span>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* =================================================
              TAB 1: OVERVIEW
          ================================================= */}
          {activeTab === "overview" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Platform Operations Overview</h1>
                  <p className="admin-page-subtitle">
                    Real-time monitoring of registered disaster response authorities, NGOs, verified shelters, and citizen safety.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={fetchStats} className="admin-btn admin-btn-secondary">
                    🔄 Refresh Stats
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("PENDING");
                      setActiveTab("organizations");
                    }}
                    className="admin-btn admin-btn-primary"
                  >
                    🏢 Review Pending ({stats.pendingOrganizations})
                  </button>
                </div>
              </div>

              {/* KPI Stats Grid */}
              <div className="admin-stats-grid">
                <div className={`admin-stat-card ${stats.pendingOrganizations > 0 ? "alert" : ""}`}>
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Pending Review</span>
                    <span className="admin-stat-icon">⏳</span>
                  </div>
                  <div className="admin-stat-value">
                    {statsLoading ? "..." : stats.pendingOrganizations}
                  </div>
                  <div className="admin-stat-desc">Awaiting administrator authorization</div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Verified Organizations</span>
                    <span className="admin-stat-icon">🛡️</span>
                  </div>
                  <div className="admin-stat-value">
                    {statsLoading ? "..." : stats.verifiedOrganizations}
                  </div>
                  <div className="admin-stat-desc">Active Panchayats & NGOs</div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Registered Citizens</span>
                    <span className="admin-stat-icon">👨‍🌾</span>
                  </div>
                  <div className="admin-stat-value">
                    {statsLoading ? "..." : stats.totalCitizens}
                  </div>
                  <div className="admin-stat-desc">Authentic phone-verified villagers</div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Active Facilities</span>
                    <span className="admin-stat-icon">🏠</span>
                  </div>
                  <div className="admin-stat-value">
                    {statsLoading ? "..." : stats.activeShelters}
                  </div>
                  <div className="admin-stat-desc">Shelters, Medical & Relief points</div>
                </div>

                <div className="admin-stat-card">
                  <div className="admin-stat-top">
                    <span className="admin-stat-label">Active Incidents</span>
                    <span className="admin-stat-icon">🚨</span>
                  </div>
                  <div className="admin-stat-value">
                    {statsLoading ? "..." : stats.totalIncidents}
                  </div>
                  <div className="admin-stat-desc">Live SOS reports in triage</div>
                </div>
              </div>

              {/* Quick Shortcuts */}
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "1.05rem", color: "#0f172a" }}>Platform Governance Principles</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", fontSize: "0.85rem", color: "#475569" }}>
                  <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <strong style={{ color: "#0f172a", display: "block", marginBottom: "4px" }}>🔒 Real Data Integrity</strong>
                    All mock and seed records have been purged. Only live user submissions and authorized platform facilities exist in the database.
                  </div>
                  <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <strong style={{ color: "#0f172a", display: "block", marginBottom: "4px" }}>✓ Truthful Verification Labeling</strong>
                    Verified resources are explicitly marked as "Verified by Sahayta Setu's authorized platform administrator" to maintain complete operational transparency.
                  </div>
                  <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <strong style={{ color: "#0f172a", display: "block", marginBottom: "4px" }}>⚡ Realtime Dispatch Protocol</strong>
                    Socket.IO broadcasts ensure that responders, control rooms, and administrators synchronize status updates within 50 milliseconds.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================
              TAB 2: ORGANIZATIONS & RESPONDERS MANAGEMENT
          ================================================= */}
          {activeTab === "organizations" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Organization & Responder Management</h1>
                  <p className="admin-page-subtitle">
                    Authorize, reject, suspend, or reset credentials for Gram Panchayats, District Authorities, and NGOs.
                  </p>
                </div>
                <button type="button" onClick={fetchEntities} className="admin-btn admin-btn-secondary">
                  🔄 Refresh List
                </button>
              </div>

              {/* Controls Bar */}
              <div className="admin-controls-bar">
                <div className="admin-filter-tabs">
                  {["ALL", "PENDING", "VERIFIED", "SUSPENDED", "REJECTED"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`admin-filter-tab ${statusFilter === st ? "active" : ""}`}
                      onClick={() => setStatusFilter(st)}
                    >
                      {st} {st === "PENDING" && stats.pendingOrganizations > 0 ? `(${stats.pendingOrganizations})` : ""}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
                    aria-label="Filter by organization type"
                  >
                    <option value="ALL">All Entity Types</option>
                    <option value="NGO">NGOs</option>
                    <option value="PANCHAYAT">Gram Panchayats</option>
                    <option value="DISTRICT_AUTHORITY">District Authorities</option>
                  </select>

                  <div className="admin-search-box">
                    <span style={{ marginRight: "6px", color: "#64748b" }}>🔍</span>
                    <input
                      type="text"
                      className="admin-search-input"
                      placeholder="Search name, phone, district..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Organization Table */}
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Organization / Authority</th>
                      <th>Type</th>
                      <th>Contact Person</th>
                      <th>Jurisdiction</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entitiesLoading && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          ⏳ Loading organizations...
                        </td>
                      </tr>
                    )}

                    {!entitiesLoading && entities.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          No organizations found matching the criteria.
                        </td>
                      </tr>
                    )}

                    {!entitiesLoading && entities.map((ent) => {
                      const isPending = ent.verificationStatus === "PENDING";
                      const isVerified = ent.verificationStatus === "VERIFIED";
                      const isSuspended = ent.activeStatus === "SUSPENDED";
                      const isRejected = ent.verificationStatus === "REJECTED";

                      return (
                        <tr
                          key={ent._id}
                          className="clickable"
                          onClick={() => setSelectedEntity(ent)}
                        >
                          <td>
                            <strong style={{ display: "block", color: "#0f172a" }}>
                              {ent.organizationName || ent.name}
                            </strong>
                            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                              Reg ID: {ent.registrationNumber || "N/A"}
                            </span>
                          </td>
                          <td>
                            <span className="type-pill">
                              {ent.organizationType || ent.role?.toUpperCase() || "NGO"}
                            </span>
                          </td>
                          <td>
                            <div>{ent.representativeName || ent.contactPerson || "Officer"}</div>
                            <small style={{ color: "#64748b" }}>{ent.phone || ent.email}</small>
                          </td>
                          <td>
                            <div>{ent.district || "All Districts"}{ent.state ? `, ${ent.state}` : ""}</div>
                            {ent.panchayatId && (
                              <small style={{ color: "#64748b" }}>GP: {ent.panchayatId}</small>
                            )}
                          </td>
                          <td>
                            <span
                              className={`status-pill ${
                                isSuspended
                                  ? "suspended"
                                  : isPending
                                  ? "pending"
                                  : isVerified
                                  ? "verified"
                                  : isRejected
                                  ? "rejected"
                                  : "pending"
                              }`}
                            >
                              {isSuspended ? "SUSPENDED" : ent.verificationStatus || "PENDING"}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-btn admin-btn-secondary"
                              style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEntity(ent);
                              }}
                            >
                              Manage →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================
              TAB 3: CITIZENS DIRECTORY
          ================================================= */}
          {activeTab === "citizens" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Registered Citizens Directory</h1>
                  <p className="admin-page-subtitle">
                    Real, phone-verified villagers registered for emergency alerts and evacuation assistance.
                  </p>
                </div>
                <div className="admin-search-box">
                  <span style={{ marginRight: "6px", color: "#64748b" }}>🔍</span>
                  <input
                    type="text"
                    className="admin-search-input"
                    placeholder="Search name, phone, district..."
                    value={citizenSearch}
                    onChange={(e) => setCitizenSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Citizen Name</th>
                      <th>Phone Number</th>
                      <th>Location / Village</th>
                      <th>District & State</th>
                      <th>Registered Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {citizensLoading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          ⏳ Loading registered citizens...
                        </td>
                      </tr>
                    )}
                    {!citizensLoading && citizens.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          No registered citizens found.
                        </td>
                      </tr>
                    )}
                    {!citizensLoading && citizens.map((cit) => (
                      <tr key={cit._id || cit.id}>
                        <td>
                          <strong>{cit.name}</strong>
                        </td>
                        <td>{cit.phone ? `+91 ${cit.phone}` : "—"}</td>
                        <td>{cit.village || "—"}</td>
                        <td>{cit.district || "—"}{cit.state ? `, ${cit.state}` : ""}</td>
                        <td>{cit.createdAt ? new Date(cit.createdAt).toLocaleDateString() : "Active"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================
              TAB 4: SHELTERS & RELIEF POINTS
          ================================================= */}
          {activeTab === "shelters" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Shelters & Verified Relief Points</h1>
                  <p className="admin-page-subtitle">
                    Authorized safe evacuation facilities labeled: "Verified by Sahayta Setu's authorized platform administrator".
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={fetchShelters} className="admin-btn admin-btn-secondary">
                    🔄 Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddShelterModal(true)}
                    className="admin-btn admin-btn-primary"
                  >
                    ➕ Add Facility
                  </button>
                </div>
              </div>

              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Facility Name</th>
                      <th>Type</th>
                      <th>Jurisdiction</th>
                      <th>Capacity / Occupancy</th>
                      <th>Status</th>
                      <th>Contact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheltersLoading && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          ⏳ Loading shelters...
                        </td>
                      </tr>
                    )}
                    {!sheltersLoading && shelters.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          No registered shelters found. Use "Add Facility" to list a verified relief center.
                        </td>
                      </tr>
                    )}
                    {!sheltersLoading && shelters.map((sh) => (
                      <tr key={sh._id || sh.id}>
                        <td>
                          <strong>{sh.name}</strong>
                          <div style={{ fontSize: "0.72rem", color: "#15803d" }}>
                            ✓ Verified by Sahayta Setu's authorized platform administrator
                          </div>
                        </td>
                        <td>
                          <span className="type-pill">{sh.type || "SHELTER"}</span>
                        </td>
                        <td>{sh.district || "—"}{sh.state ? `, ${sh.state}` : ""}</td>
                        <td>
                          {sh.currentOccupancy ?? sh.occupancy ?? 0} / {sh.capacity || "—"}
                        </td>
                        <td>
                          <span className={`status-pill ${sh.status === "ACTIVE" ? "verified" : sh.status === "FULL" ? "pending" : "rejected"}`}>
                            {sh.status || "ACTIVE"}
                          </span>
                        </td>
                        <td>{sh.publicContact || sh.phone || "112"}</td>
                        <td>
                          {sh.status !== "CLOSED" && (
                            <button
                              type="button"
                              onClick={() => handleCloseShelter(sh._id || sh.id)}
                              className="admin-btn admin-btn-danger"
                              style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                            >
                              Close Facility
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================
              TAB 5: AUDIT TRAIL
          ================================================= */}
          {activeTab === "audit" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Immutable Security & Operations Audit Trail</h1>
                  <p className="admin-page-subtitle">
                    Cryptographic and tamper-evident event log recording user registrations, administrator authorizations, and critical dispatches.
                  </p>
                </div>
                <button type="button" onClick={fetchAuditLogs} className="admin-btn admin-btn-secondary">
                  🔄 Refresh
                </button>
              </div>

              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Target</th>
                      <th>Jurisdiction</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLoading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          ⏳ Loading audit logs...
                        </td>
                      </tr>
                    )}
                    {!auditLoading && auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                          No audit events recorded yet.
                        </td>
                      </tr>
                    )}
                    {!auditLoading && auditLogs.map((log) => (
                      <tr key={log._id || log.timestamp}>
                        <td>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "#f1f5f9", color: "#334155" }}>
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <strong>{log.actorName || log.actorId}</strong>
                          <small style={{ display: "block", color: "#64748b" }}>Role: {log.actorRole}</small>
                        </td>
                        <td>
                          {log.targetType} ({log.targetId || "—"})
                        </td>
                        <td>{log.jurisdiction?.district || "Global"}</td>
                        <td>{new Date(log.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =================================================
              TAB 6: ADMIN PROFILE
          ================================================= */}
          {activeTab === "account" && (
            <div>
              <div className="admin-page-header">
                <div>
                  <h1 className="admin-page-title">Super Administrator Account</h1>
                  <p className="admin-page-subtitle">
                    System governance and root security credentials.
                  </p>
                </div>
              </div>

              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "24px", maxWidth: "600px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
                  <div style={{ width: "54px", height: "54px", borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", fontWeight: 700 }}>
                    SA
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>{user?.name || "Platform Super Administrator"}</h3>
                    <p style={{ margin: "2px 0 0", color: "#64748b", fontSize: "0.85rem" }}>{user?.email || "superadmin@sahaytasetu.gov.in"}</p>
                  </div>
                </div>

                <div className="drawer-detail-grid" style={{ marginBottom: "20px" }}>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Role</span>
                    <span className="drawer-detail-value">SUPER_ADMIN</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Scope</span>
                    <span className="drawer-detail-value">National Disaster Network</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Auth Mode</span>
                    <span className="drawer-detail-value">Phone-First Citizen / Email Org</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Status</span>
                    <span className="drawer-detail-value" style={{ color: "#16a34a" }}>Active & Verified</span>
                  </div>
                </div>

                <button type="button" onClick={onLogout} className="admin-btn admin-btn-danger" style={{ width: "100%" }}>
                  Sign Out of Console
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===================================================
          ORGANIZATION DETAIL DRAWER (Slide-Over Panel)
      =================================================== */}
      {selectedEntity && (
        <div className="drawer-backdrop" onClick={() => setSelectedEntity(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>
                  {selectedEntity.organizationName || selectedEntity.name}
                </h3>
                <span className="type-pill" style={{ marginTop: "4px" }}>
                  {selectedEntity.organizationType || selectedEntity.role?.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntity(null)}
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div className="drawer-body">
              {tempPasswordResult && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "12px", borderRadius: "8px", fontSize: "0.88rem" }}>
                  <strong>Temporary Password Generated:</strong>
                  <div style={{ fontFamily: "monospace", fontSize: "1.1rem", fontWeight: 700, margin: "6px 0", color: "#0f172a", background: "#fff", padding: "6px 10px", borderRadius: "4px", border: "1px solid #cbd5e1" }}>
                    {tempPasswordResult}
                  </div>
                  <small>Please securely communicate this password to the representative. They must change it upon login.</small>
                </div>
              )}

              <div className="drawer-section">
                <span className="drawer-section-title">Credentials & Contact</span>
                <div className="drawer-detail-grid">
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Representative</span>
                    <span className="drawer-detail-value">{selectedEntity.representativeName || selectedEntity.contactPerson || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Official Email</span>
                    <span className="drawer-detail-value">{selectedEntity.email || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Official Phone</span>
                    <span className="drawer-detail-value">{selectedEntity.phone || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Registration ID</span>
                    <span className="drawer-detail-value">{selectedEntity.registrationNumber || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="drawer-section">
                <span className="drawer-section-title">Operational Jurisdiction</span>
                <div className="drawer-detail-grid">
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">State</span>
                    <span className="drawer-detail-value">{selectedEntity.state || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">District</span>
                    <span className="drawer-detail-value">{selectedEntity.district || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Block Code</span>
                    <span className="drawer-detail-value">{selectedEntity.blockCode || "—"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Panchayat ID</span>
                    <span className="drawer-detail-value">{selectedEntity.panchayatId || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="drawer-section">
                <span className="drawer-section-title">Status & Timestamps</span>
                <div className="drawer-detail-grid">
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Verification Status</span>
                    <span className="drawer-detail-value">{selectedEntity.verificationStatus || "PENDING"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Account Status</span>
                    <span className="drawer-detail-value">{selectedEntity.activeStatus || "ACTIVE"}</span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Registered At</span>
                    <span className="drawer-detail-value">
                      {selectedEntity.createdAt ? new Date(selectedEntity.createdAt).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="drawer-detail-item">
                    <span className="drawer-detail-label">Verified By</span>
                    <span className="drawer-detail-value">{selectedEntity.verifiedBy || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Review & Administration Action Buttons */}
            <div className="drawer-footer">
              {selectedEntity.verificationStatus === "PENDING" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => handleApprove(selectedEntity._id)}
                    disabled={actionLoading}
                    className="admin-btn admin-btn-success"
                  >
                    ✓ Approve & Verify
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenReject(selectedEntity)}
                    disabled={actionLoading}
                    className="admin-btn admin-btn-danger"
                  >
                    ✕ Reject Application
                  </button>
                </div>
              )}

              {selectedEntity.verificationStatus === "VERIFIED" && selectedEntity.activeStatus !== "SUSPENDED" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => handleOpenSuspend(selectedEntity)}
                    disabled={actionLoading}
                    className="admin-btn admin-btn-warning"
                  >
                    ⏸️ Suspend
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(selectedEntity._id)}
                    disabled={actionLoading}
                    className="admin-btn admin-btn-danger"
                  >
                    🚫 Revoke Authorization
                  </button>
                </div>
              )}

              {(selectedEntity.activeStatus === "SUSPENDED" || selectedEntity.verificationStatus === "REJECTED") && (
                <button
                  type="button"
                  onClick={() => handleReinstate(selectedEntity._id)}
                  disabled={actionLoading}
                  className="admin-btn admin-btn-success"
                  style={{ width: "100%" }}
                >
                  🔄 Reinstate to Active
                </button>
              )}

              <button
                type="button"
                onClick={() => handleResetPassword(selectedEntity._id)}
                disabled={actionLoading}
                className="admin-btn admin-btn-secondary"
                style={{ width: "100%" }}
              >
                🔑 Reset Temporary Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          PROMPT DIALOG (Reason for Reject / Suspend)
      =================================================== */}
      {promptDialog && (
        <div className="drawer-backdrop" style={{ zIndex: 100, alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "12px", width: "100%", maxWidth: "480px", padding: "24px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem", color: "#0f172a" }}>{promptDialog.title}</h3>
            <textarea
              rows={4}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={promptDialog.placeholder}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.88rem", marginBottom: "16px", resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setPromptDialog(null)}
                className="admin-btn admin-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => promptDialog.onConfirm(promptText.trim())}
                disabled={!promptText.trim() || actionLoading}
                className={`admin-btn ${promptDialog.type === "reject" ? "admin-btn-danger" : "admin-btn-warning"}`}
              >
                Confirm {promptDialog.type === "reject" ? "Rejection" : "Suspension"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          ADD SHELTER MODAL
      =================================================== */}
      {showAddShelterModal && (
        <div className="drawer-backdrop" style={{ zIndex: 100, alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "12px", width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto", padding: "24px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>Add Verified Shelter / Relief Center</h3>
              <button
                type="button"
                onClick={() => setShowAddShelterModal(false)}
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateShelter} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>FACILITY TYPE</label>
                <select
                  value={newShelterType}
                  onChange={(e) => setNewShelterType(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                >
                  <option value="SHELTER">Emergency Evacuation Shelter</option>
                  <option value="MEDICAL">Medical Emergency Center / Hospital</option>
                  <option value="RELIEF_POINT">Relief Distribution Point</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>FACILITY NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maldevta Govt School Evacuation Camp"
                  value={newShelterName}
                  onChange={(e) => setNewShelterName(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>STREET ADDRESS / LANDMARK</label>
                <input
                  type="text"
                  placeholder="e.g. Near Primary Health Centre, Raipur Road"
                  value={newShelterAddress}
                  onChange={(e) => setNewShelterAddress(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                />
              </div>

              <LocationSelector
                selectedState={newShelterState}
                selectedDistrict={newShelterDistrict}
                onChange={({ state, district }) => {
                  setNewShelterState(state);
                  setNewShelterDistrict(district);
                }}
                required={true}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>TOTAL CAPACITY</label>
                  <input
                    type="number"
                    min="10"
                    value={newShelterCapacity}
                    onChange={(e) => setNewShelterCapacity(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>PUBLIC CONTACT PHONE</label>
                  <input
                    type="tel"
                    placeholder="10-digit number or 112"
                    value={newShelterContact}
                    onChange={(e) => setNewShelterContact(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>LATITUDE</label>
                  <input
                    type="text"
                    value={newShelterLat}
                    onChange={(e) => setNewShelterLat(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>LONGITUDE</label>
                  <input
                    type="text"
                    value={newShelterLng}
                    onChange={(e) => setNewShelterLng(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => setShowAddShelterModal(false)}
                  className="admin-btn admin-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="admin-btn admin-btn-primary"
                >
                  {actionLoading ? "Creating..." : "Create Verified Facility"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
