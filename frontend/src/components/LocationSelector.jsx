import { useEffect } from "react";
import {
  getStates,
  getDistrictsByState,
  getDistrictCoordinates,
} from "../data/indiaLocations";
import { DEFAULT_STATE, DEFAULT_STATE_CODE } from "../config/locationConfig";

// Re-export constants for easy access
export { DEFAULT_STATE, DEFAULT_STATE_CODE };

/**
 * Returns list of states with DEFAULT_STATE pinned at the top,
 * followed by the remaining states/UTs in alphabetical order.
 */
function getPinnedStates(defaultState = DEFAULT_STATE) {
  const allStates = getStates();
  const remaining = allStates.filter((s) => s.toLowerCase() !== defaultState.toLowerCase());
  return [defaultState, ...remaining];
}

function LocationSelector({
  selectedState = DEFAULT_STATE,
  selectedDistrict = "",
  onChange,
  disabled = false,
  showLabels = true,
  className = "",
  required = false
}) {
  const effectiveState = selectedState || DEFAULT_STATE;
  const states = getPinnedStates(DEFAULT_STATE);
  const districts = effectiveState ? getDistrictsByState(effectiveState) : [];

  // Notify parent on mount if parent did not have a selectedState
  useEffect(() => {
    if (!selectedState && onChange) {
      onChange({
        state: DEFAULT_STATE,
        district: selectedDistrict || "",
        coordinates: selectedDistrict ? getDistrictCoordinates(DEFAULT_STATE, selectedDistrict) : null
      });
    }
  }, [selectedState, selectedDistrict, onChange]);

  const handleStateChange = (e) => {
    const newState = e.target.value;
    // When state changes, district resets automatically
    if (onChange) {
      onChange({
        state: newState,
        district: "",
        coordinates: null,
      });
    }
  };

  const handleDistrictChange = (e) => {
    const newDistrict = e.target.value;
    const coords = newDistrict
      ? getDistrictCoordinates(effectiveState, newDistrict)
      : null;
    if (onChange) {
      onChange({
        state: effectiveState,
        district: newDistrict,
        coordinates: coords,
      });
    }
  };

  return (
    <div className={`location-selector-group ${className}`}>
      {/* STATE SELECTOR */}
      <div className="input-section location-field">
        {showLabels && <label htmlFor="state-select">STATE / UT</label>}
        <div className="input-wrapper">
          <select
            id="state-select"
            value={effectiveState}
            onChange={handleStateChange}
            disabled={disabled}
            required={required}
            className="location-dropdown"
          >
            {states.map((st) => (
              <option key={st} value={st}>
                {st} {st === DEFAULT_STATE ? "★" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* DISTRICT SELECTOR */}
      <div className="input-section location-field">
        {showLabels && <label htmlFor="district-select">DISTRICT</label>}
        <div className="input-wrapper">
          <select
            id="district-select"
            value={selectedDistrict}
            onChange={handleDistrictChange}
            disabled={disabled || !effectiveState}
            required={required}
            className="location-dropdown"
          >
            <option value="">
              {!effectiveState ? "-- Select State First --" : "-- Select District --"}
            </option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default LocationSelector;
