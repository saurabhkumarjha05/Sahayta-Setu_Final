import { useState, useMemo, useEffect } from 'react';
import LocationSelector from './LocationSelector';
import GramPanchayatMap from './map/GramPanchayatMap';
import { apiFetch } from '../api';

/**
 * Authority Analytics Dashboard Component
 * Clean, database-driven emergency operations analytics interface with zero hardcoded values.
 */
export default function AuthorityAnalyticsDashboard({
  allSOS = [],
  shelters = [],
  evacuation = null,
  user = null,
  onRefresh = () => {},
  onNavigateView = () => {}
}) {
  // Filters State
  const [selectedState, setSelectedState] = useState(user?.state || 'Uttar Pradesh');
  const [selectedDistrict, setSelectedDistrict] = useState(user?.district || 'Gautam Buddha Nagar');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [dateRange, setDateRange] = useState('7d'); // 24h, 7d, 30d, all
  const [exportingPdf, setExportingPdf] = useState(false);
  const [referenceTime, setReferenceTime] = useState(null);

  // TinyFish AI Telemetry State
  const [tinyFishAlerts, setTinyFishAlerts] = useState([]);
  const [loadingTinyFish, setLoadingTinyFish] = useState(false);
  const [tinyFishError, setTinyFishError] = useState('');

  useEffect(() => {
    const refreshReferenceTime = () => setReferenceTime(Date.now());
    refreshReferenceTime();
    const interval = setInterval(refreshReferenceTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // Filtered dataset computation
  const filteredSOS = useMemo(() => {
    return allSOS.filter((item) => {
      // 1. Location filter
      if (selectedState && String(item.state || '').trim().toLowerCase() !== selectedState.toLowerCase()) return false;
      if (selectedDistrict && String(item.district || '').trim().toLowerCase() !== selectedDistrict.toLowerCase()) return false;
      // 2. Category filter
      if (categoryFilter !== 'ALL') {
        const cat = String(item.emergencyType || item.type || '').toLowerCase();
        if (!cat.includes(categoryFilter.toLowerCase())) return false;
      }
      // 3. Priority filter
      if (priorityFilter !== 'ALL') {
        const p = String(item.priority || 'HIGH').toUpperCase();
        if (p !== priorityFilter) return false;
      }
      // 4. Date range filter
      if (dateRange !== 'all' && referenceTime) {
        const itemDate = Date.parse(item.timestamp || item.createdAt || '');
        if (!Number.isFinite(itemDate)) return false;
        const diffHours = (referenceTime - itemDate) / (1000 * 3600);
        if (dateRange === '24h' && diffHours > 24) return false;
        if (dateRange === '7d' && diffHours > 24 * 7) return false;
        if (dateRange === '30d' && diffHours > 24 * 30) return false;
      }
      return true;
    });
  }, [allSOS, selectedState, selectedDistrict, categoryFilter, priorityFilter, dateRange, referenceTime]);

  // KPI Calculations
  const metrics = useMemo(() => {
    const totalIncidents = filteredSOS.length;
    const activeIncidents = filteredSOS.filter((s) => s.status !== 'Resolved').length;
    const criticalHighIncidents = filteredSOS.filter((s) => ['CRITICAL', 'HIGH'].includes(String(s.priority || 'HIGH').toUpperCase())).length;
    const awaitingVerification = filteredSOS.filter((s) => s.status === 'Pending' || s.verificationStatus === 'PENDING').length;
    const resolvedIncidents = filteredSOS.filter((s) => s.status === 'Resolved').length;

    // Shelter Metrics
    const totalCapacity = shelters.reduce((acc, s) => acc + (Number(s.capacity) || 0), 0);
    const currentOccupancy = shelters.reduce((acc, s) => acc + (Number(s.currentOccupancy || s.occupancy) || 0), 0);
    const availableCapacity = Math.max(0, totalCapacity - currentOccupancy);

    // Evacuation Analytics
    const activeEvacPlans = evacuation?.totals?.families ? 1 : 0;
    const totalEvacuees = evacuation?.totals?.totalMembers || 0;

    return {
      totalIncidents,
      activeIncidents,
      criticalHighIncidents,
      awaitingVerification,
      resolvedIncidents,
      availableShelters: shelters.filter((s) => s.status !== 'CLOSED').length,
      totalCapacity,
      currentOccupancy,
      availableCapacity,
      activeEvacPlans,
      totalEvacuees
    };
  }, [filteredSOS, shelters, evacuation]);

  // Category Distribution Computation
  const categoryStats = useMemo(() => {
    const counts = {};
    filteredSOS.forEach((s) => {
      const type = s.emergencyType || s.type || 'Other';
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [filteredSOS]);

  // Priority Distribution Computation
  const priorityStats = useMemo(() => {
    const dist = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    filteredSOS.forEach((s) => {
      const p = String(s.priority || 'HIGH').toUpperCase();
      if (dist[p] !== undefined) dist[p]++;
      else dist['HIGH']++;
    });
    return dist;
  }, [filteredSOS]);

  // Fetch TinyFish Intelligence on Demand
  const fetchTinyFishIntelligence = async () => {
    setLoadingTinyFish(true);
    setTinyFishError('');
    try {
      const res = await apiFetch(`/api/intelligence/tinyfish-alerts?state=${encodeURIComponent(selectedState)}&district=${encodeURIComponent(selectedDistrict)}`);
      setTinyFishAlerts(res.alerts || []);
    } catch (err) {
      console.warn('TinyFish intelligence fetch notice:', err.message);
      setTinyFishAlerts([]);
      setTinyFishError(err.message || 'Official source search is currently unavailable.');
    } finally {
      setLoadingTinyFish(false);
    }
  };

  // CSV Export Handler
  const handleExportCSV = () => {
    if (filteredSOS.length === 0) {
      alert('No incident data available to export with current filters.');
      return;
    }
    const headers = ['Incident ID', 'Type', 'Priority', 'Status', 'Village', 'District', 'State', 'Reported At'];
    const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = filteredSOS.map((s) => [
      s.clientIncidentId || s._id,
      s.emergencyType || s.type || 'Disaster',
      s.priority || 'HIGH',
      s.status || 'Active',
      s.village || '',
      s.district || '',
      s.state || '',
      s.timestamp || s.createdAt || ''
    ].map(escapeCell));

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent([headers.map(escapeCell).join(','), ...rows.map((e) => e.join(','))].join('\n'));
    const encodedUri = csvContent;
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `incident_analytics_${selectedDistrict}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Printable PDF Summary Report Handler
  const handlePrintPDF = () => {
    setExportingPdf(true);
    window.print();
    setTimeout(() => setExportingPdf(false), 1000);
  };

  return (
    <div className="authority-analytics-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '32px' }}>
      
      {/* 1. TOP CONTROL & FILTER BAR */}
      <div className="panel analytics-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 20px', backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ minWidth: '280px' }}>
            <LocationSelector
              selectedState={selectedState}
              selectedDistrict={selectedDistrict}
              onChange={({ state, district }) => {
                setSelectedState(state);
                setSelectedDistrict(district);
              }}
              showLabels={false}
            />
          </div>

          {/* Date Range Filter */}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 600, background: '#f8fafc' }}
          >
            <option value="24h">Past 24 Hours</option>
            <option value="7d">Past 7 Days</option>
            <option value="30d">Past 30 Days</option>
            <option value="all">All Historical Data</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 600, background: '#f8fafc' }}
          >
            <option value="ALL">All Categories</option>
            <option value="Medical">Medical</option>
            <option value="Flood">Flood / Waterlogging</option>
            <option value="Landslide">Landslide</option>
            <option value="Fire">Fire Outbreak</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 600, background: '#f8fafc' }}
          >
            <option value="ALL">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={fetchTinyFishIntelligence}
            disabled={loadingTinyFish}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #3b82f6', backgroundColor: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
          >
            {loadingTinyFish ? '📡 Searching official sources...' : '📡 Search official sources'}
          </button>
          <button
            onClick={handleExportCSV}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#475569', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
          >
            📥 Export CSV
          </button>
          <button
            onClick={handlePrintPDF}
            style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#0f172a', color: '#ffffff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
          >
            {exportingPdf ? 'Preparing…' : '🖨️ PDF Report'}
          </button>
          <button
            onClick={onRefresh}
            title="Refresh Live Data"
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#475569', cursor: 'pointer' }}
          >
            🔄
          </button>
        </div>
      </div>

      {/* 2. REALTIME METRICS & KPI CARDS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        
        {/* Card 1: Total Incidents */}
        <div className="panel stat-card" style={{ padding: '20px', borderRadius: '14px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Total Reported Incidents</span>
            <span style={{ fontSize: '1.2rem' }}>📊</span>
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>{metrics.totalIncidents}</h2>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
            <strong style={{ color: '#2563eb' }}>{metrics.activeIncidents} active</strong> · {metrics.resolvedIncidents} resolved
          </p>
        </div>

        {/* Card 2: Critical & High Priority */}
        <div className="panel stat-card" style={{ padding: '20px', borderRadius: '14px', backgroundColor: '#ffffff', border: '1px solid #fee2e2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase' }}>Critical & High Priority</span>
            <span style={{ fontSize: '1.2rem' }}>🚨</span>
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#dc2626', margin: '4px 0' }}>{metrics.criticalHighIncidents}</h2>
          <p style={{ fontSize: '0.8rem', color: '#991b1b', margin: 0 }}>
            {priorityStats.CRITICAL} Critical · {priorityStats.HIGH} High
          </p>
        </div>

        {/* Card 3: Awaiting Verification */}
        <div className="panel stat-card" style={{ padding: '20px', borderRadius: '14px', backgroundColor: '#ffffff', border: '1px solid #fef3c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#d97706', textTransform: 'uppercase' }}>Awaiting Triage / Action</span>
            <span style={{ fontSize: '1.2rem' }}>⏳</span>
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#b45309', margin: '4px 0' }}>{metrics.awaitingVerification}</h2>
          <p style={{ fontSize: '0.8rem', color: '#92400e', margin: 0 }}>
            Pending dispatch assignment
          </p>
        </div>

        {/* Card 4: Shelter Capacity & Availability */}
        <div className="panel stat-card" style={{ padding: '20px', borderRadius: '14px', backgroundColor: '#ffffff', border: '1px solid #dcfce7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase' }}>Shelter Capacity</span>
            <span style={{ fontSize: '1.2rem' }}>🏠</span>
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#15803d', margin: '4px 0' }}>{metrics.availableCapacity}</h2>
          <p style={{ fontSize: '0.8rem', color: '#166534', margin: 0 }}>
            Available spaces ({metrics.currentOccupancy} occupied / {metrics.totalCapacity} total)
          </p>
        </div>
      </div>

      {tinyFishError && <div role="alert" className="panel" style={{ padding: '12px 16px', color: '#9a3412', background: '#fff7ed' }}>{tinyFishError} Incident reporting and dashboards remain available.</div>}

      {/* 3. SOURCE-BACKED TINYFISH SEARCH RESULTS */}
      {tinyFishAlerts.length > 0 && (
        <div className="panel" style={{ backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', padding: '16px 20px', borderRadius: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, color: '#0369a1', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
              📡 Official-source search candidates · Human verification required
            </h4>
            <span style={{ fontSize: '0.75rem', color: '#0284c7', backgroundColor: '#e0f2fe', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
              {tinyFishAlerts.length} results · not confirmed incident alerts
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
            {tinyFishAlerts.map((a, i) => (
              <div key={i} style={{ backgroundColor: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e0f2fe' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0284c7', marginBottom: '4px' }}>{a.source}</div>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', display: 'block', marginBottom: '4px' }}>{a.title}</strong>
                <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 6px' }}>{a.description}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#64748b' }}>
                  <span>Search scope: {a.affectedAreaQuery}</span>
                  {a.publishedAt && <span>Published: {new Date(a.publishedAt).toLocaleString()}</span>}
                </div>
                <a href={a.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '8px', fontSize: '0.8rem' }}>
                  View source
                </a>
                </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. VISUAL ANALYTICS & CHARTS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
        
        {/* Category Breakdown Bar Visualization */}
        <div className="panel" style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', marginBottom: '16px' }}>
            🏷️ Incident Category Distribution
          </h3>
          {categoryStats.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
              No incidents reported matching the selected filters.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {categoryStats.map((item) => {
                const max = Math.max(...categoryStats.map((c) => c.count), 1);
                const pct = Math.round((item.count / max) * 100);
                return (
                  <div key={item.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      <span>{item.name}</span>
                      <span>{item.count} incident(s)</span>
                    </div>
                    <div style={{ height: '10px', backgroundColor: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#3b82f6', borderRadius: '5px', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Priority Breakdown Donut/Bar Visualization */}
        <div className="panel" style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', marginBottom: '16px' }}>
            ⚖️ Priority Level Distribution
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { level: 'CRITICAL', count: priorityStats.CRITICAL, color: '#dc2626', bg: '#fef2f2' },
              { level: 'HIGH', count: priorityStats.HIGH, color: '#ea580c', bg: '#fff7ed' },
              { level: 'MEDIUM', count: priorityStats.MEDIUM, color: '#d97706', bg: '#fefce8' },
              { level: 'LOW', count: priorityStats.LOW, color: '#16a34a', bg: '#f0fdf4' }
            ].map((p) => (
              <div key={p.level} style={{ backgroundColor: p.bg, border: `1px solid ${p.color}40`, padding: '14px', borderRadius: '10px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: p.color }}>{p.level}</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: p.color, marginTop: '4px' }}>{p.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. INTERACTIVE GEOGRAPHIC RISK MAP */}
      <div className="panel" style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              🗺️ Live Geographic Incident Clusters & Risk Map
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '2px 0 0' }}>
              Real-time map centered on {selectedDistrict}, {selectedState}
            </p>
          </div>
          <button onClick={() => onNavigateView('map')} style={{ fontSize: '0.82rem', fontWeight: 700, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
            Open Fullscreen Map →
          </button>
        </div>
        <div style={{ height: '420px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
          <GramPanchayatMap initialPropsState={selectedState} initialPropsDistrict={selectedDistrict} />
        </div>
      </div>
    </div>
  );
}
