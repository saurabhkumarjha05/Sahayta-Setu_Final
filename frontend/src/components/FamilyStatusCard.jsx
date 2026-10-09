import { useEffect, useState } from "react";
import { apiFetch } from "../api";

const GROUPS = [
  { field: "inShelter", icon: "🏠", label: "Went to a shelter" },
  { field: "withRelatives", icon: "👪", label: "At a relative's house / other village" },
  { field: "atHome", icon: "🏡", label: "Staying at home (not willing to move)" },
  { field: "elsewhere", icon: "❓", label: "Went somewhere, place not known" },
];

const EMPTY = { totalMembers: 1, inShelter: 0, withRelatives: 0, atHome: 0, elsewhere: 0, shelterId: "" };

// A number with − / + buttons
function Stepper({ value, onChange, min = 0, max = 100 }) {
  return (
    <div className="family-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        −
      </button>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => {
          const number = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
          onChange(Math.min(max, Math.max(min, number)));
        }}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        +
      </button>
    </div>
  );
}

// Villagers tell the Gram Panchayat where each member of their family went after an alert.
function FamilyStatusCard({ shelters }) {
  const [form, setForm] = useState(EMPTY);
  const [lastSaved, setLastSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Load the family's last report
  useEffect(() => {
    apiFetch("/api/evacuation/mine")
      .then((report) => {
        if (!report) return;
        setForm({
          totalMembers: report.totalMembers,
          inShelter: report.inShelter,
          withRelatives: report.withRelatives,
          atHome: report.atHome,
          elsewhere: report.elsewhere,
          shelterId: report.shelter || "",
        });
        setLastSaved(report.updatedAt);
      })
      .catch(() => {});
  }, []);

  const accounted = GROUPS.reduce((sum, group) => sum + form[group.field], 0);
  const notAccounted = form.totalMembers - accounted;

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
    setError("");
  };

  const save = async () => {
    if (notAccounted < 0) {
      setError(`That adds up to ${accounted}, but your family has ${form.totalMembers} members.`);
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const report = await apiFetch("/api/evacuation", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setLastSaved(report.updatedAt);
      setMessage("Saved. Your Gram Panchayat can now see where your family is.");
    } catch (err) {
      setError(err.status ? err.message : "Cannot reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="villager-panel family-card">
      <div className="villager-panel-heading">
        <div>
          <h3>Where is your family?</h3>
          <p>Tell your Gram Panchayat where everyone went, so no one is left behind.</p>
        </div>
        {lastSaved && (
          <span className="family-updated">
            Updated {new Date(lastSaved).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </div>

      <div className="family-row family-total">
        <span className="family-label">
          <span>👥</span>
          Members in my family
        </span>
        <Stepper value={form.totalMembers} onChange={setField("totalMembers")} min={1} />
      </div>

      {GROUPS.map((group) => (
        <div className="family-row" key={group.field}>
          <span className="family-label">
            <span>{group.icon}</span>
            {group.label}
          </span>
          <Stepper
            value={form[group.field]}
            onChange={setField(group.field)}
            max={form.totalMembers}
          />
        </div>
      ))}

      {form.inShelter > 0 && shelters.length > 0 && (
        <div className="family-row">
          <span className="family-label">
            <span>📍</span>
            Which shelter?
          </span>
          <select
            className="family-select"
            value={form.shelterId}
            onChange={(e) => setField("shelterId")(e.target.value)}
          >
            <option value="">Choose shelter</option>
            {shelters.map((shelter) => (
              <option key={shelter._id} value={shelter._id}>
                {shelter.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={`family-summary ${notAccounted < 0 ? "over" : notAccounted > 0 ? "missing" : "ok"}`}>
        {notAccounted === 0 && "✓ Everyone in your family is accounted for."}
        {notAccounted > 0 && `${notAccounted} member${notAccounted === 1 ? "" : "s"} not accounted for yet.`}
        {notAccounted < 0 && `That is ${-notAccounted} more than your family size.`}
      </div>

      {error && <p className="family-error">{error}</p>}
      {message && <p className="family-message">{message}</p>}

      <button type="button" className="family-save" onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save family status"}
      </button>
    </section>
  );
}

export default FamilyStatusCard;
