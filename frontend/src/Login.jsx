import { useEffect, useState } from "react";
import LocationSelector from "./components/LocationSelector";
import { DEFAULT_STATE } from "./config/locationConfig";
import { apiFetch } from "./api";
import { useI18n, UI_LANGUAGES } from "./i18n";
import "./styles/auth.css";

function Login({ onLogin }) {
  const { lang, setLanguage, t } = useI18n();

  // Top-level Mode: "citizen" | "org"
  const [authMode, setAuthMode] = useState("citizen");

  // Citizen flow state: "phone" | "register"
  const [citizenStep, setCitizenStep] = useState("phone");
  const [phoneOnlyDemo, setPhoneOnlyDemo] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [village, setVillage] = useState("");
  const [citizenState, setCitizenState] = useState(DEFAULT_STATE);
  const [citizenDistrict, setCitizenDistrict] = useState("");

  // Organization state: "login" | "register"
  const [orgView, setOrgView] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Org registration fields
  const [orgType, setOrgType] = useState("NGO");
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [orgPhone, setOrgPhone] = useState("");
  const [orgPassword, setOrgPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [orgState, setOrgState] = useState(DEFAULT_STATE);
  const [orgDistrict, setOrgDistrict] = useState("");
  const [blockCode, setBlockCode] = useState("");
  const [panchayatId, setPanchayatId] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/api/config/public")
      .then((config) => {
        if (active) setPhoneOnlyDemo(config.citizenAuthMode === "phone_only");
      })
      .catch((configError) => {
        console.error("Authentication configuration fetch failed:", configError);
        if (active) {
          setError("Could not load authentication settings. Citizen login will require OTP.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setError("");
    setSuccessMsg("");
    setCitizenStep("phone");
    setOrgView("login");
  };

  const showOtpDeliveryStatus = (result) => {
    if (result.sms === "live") {
      setSuccessMsg(t("auth.otpSent") || "Verification code sent to your phone.");
      return;
    }

    if (result.demoOtp) {
      setSuccessMsg(
        t("auth.otpDemoCode", { code: result.demoOtp }) ||
          `Demo mode: no SMS was sent. Use this OTP: ${result.demoOtp}`
      );
      return;
    }

    setError(
      t("auth.otpNotSent") ||
        "OTP was not sent by SMS. Configure Twilio and enable OTP_SMS_ENABLED in the backend."
    );
  };

  // =========================================================
  // Citizen login uses OTP except in an explicitly configured demo environment.
  // =========================================================
  const handleCitizenContinue = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError(t("auth.errors.invalidPhone") || "Please enter a valid 10-digit Indian mobile number (e.g. 9876543210)");
      return;
    }

    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      if (!phoneOnlyDemo) {
        const result = await apiFetch("/api/auth/request-otp", {
          method: "POST",
          body: JSON.stringify({ phone: digits }),
        });
        setOtpRequested(true);
        setVerificationCode("");
        setCitizenStep(result.isNewUser ? "register" : "otp");
        showOtpDeliveryStatus(result);
        return;
      }

      // 1. Lookup account status
      const lookup = await apiFetch("/api/auth/citizen/lookup", {
        method: "POST",
        body: JSON.stringify({ phone: digits }),
      });

      if (lookup.accountType === "organization") {
        // Switch to Org mode with friendly notice
        setAuthMode("org");
        setOrgView("login");
        setError("This number is registered to an official responder or authority account. Please sign in with your official email and password.");
        setLoading(false);
        return;
      }

      if (lookup.exists) {
        // Direct citizen login
        const loginData = await apiFetch("/api/auth/citizen/login", {
          method: "POST",
          body: JSON.stringify({ phone: digits }),
        });

        if (loginData && loginData.token && loginData.user) {
          onLogin({ role: loginData.user.role, token: loginData.token, user: loginData.user });
        } else {
          setError("Failed to sign in. Please try again.");
        }
      } else {
        // Account does not exist -> transition to registration step
        setCitizenStep("register");
      }
    } catch (err) {
      if (err.data?.code === "USE_ORG_LOGIN" || err.data?.code === "USE_EMAIL_LOGIN") {
        setAuthMode("org");
        setOrgView("login");
        setError("This number belongs to an organization account. Please sign in using your official email and password.");
      } else {
        setError(err.message || t("auth.errors.networkError") || "Network error. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCitizenRegister = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError(t("auth.errors.invalidPhone") || "Please enter a valid 10-digit Indian mobile number");
      return;
    }
    if (!name.trim() || name.trim().length < 2) {
      setError(t("auth.errors.nameRequired") || "Please enter your full name");
      return;
    }
    if (!citizenState) {
      setError(t("auth.errors.stateRequired") || "Please select your state");
      return;
    }
    if (!citizenDistrict) {
      setError(t("auth.errors.districtRequired") || "Please select your district");
      return;
    }

    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      if (!phoneOnlyDemo) {
        if (!otpRequested) {
          const result = await apiFetch("/api/auth/request-otp", {
            method: "POST",
            body: JSON.stringify({ phone: digits }),
          });
          setOtpRequested(true);
          showOtpDeliveryStatus(result);
          return;
        }

        const data = await apiFetch("/api/auth/verify-otp", {
          method: "POST",
          body: JSON.stringify({
            phone: digits,
            code: verificationCode,
            name: name.trim(),
            state: citizenState,
            district: citizenDistrict,
            village: village.trim(),
          }),
        });
        onLogin({ role: data.user.role, token: data.token, user: data.user });
        return;
      }

      const data = await apiFetch("/api/auth/citizen/register", {
        method: "POST",
        body: JSON.stringify({
          phone: digits,
          name: name.trim(),
          state: citizenState,
          district: citizenDistrict,
          village: village.trim(),
        }),
      });

      if (data && data.token && data.user) {
        onLogin({ role: data.user.role, token: data.token, user: data.user });
      } else {
        setError("Account created but failed to complete session. Please sign in.");
        setCitizenStep("phone");
      }
    } catch (err) {
      setError(err.message || t("auth.errors.networkError") || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCitizenOtpLogin = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(digits) || !/^\d{6}$/.test(verificationCode)) {
      setError(t("auth.errors.invalidCode") || "Enter the 6-digit code sent to your phone.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ phone: digits, code: verificationCode }),
      });
      onLogin({ role: data.user.role, token: data.token, user: data.user });
    } catch (err) {
      setError(err.message || t("auth.errors.networkError") || "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // ORG EMAIL + PASSWORD LOGIN
  // =========================================================
  const handleOrgLogin = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError(t("auth.errors.emailRequired") || "Please enter a valid email address");
      return;
    }
    if (!password) {
      setError(t("auth.errors.passwordRequired") || "Please enter your password");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      onLogin({ role: data.user.role, token: data.token, user: data.user });
    } catch (err) {
      if (err.data?.code === "ACCOUNT_LOCKED" || err.message?.includes("locked")) {
        setError(err.message || "Account is temporarily locked. Please try again later.");
      } else if (err.status === 401 || err.status === 403) {
        setError("Invalid email or password");
      } else if (!navigator.onLine) {
        setError(t("auth.errors.networkError") || "Network offline. Please check your connection.");
      } else {
        setError(err.message || t("auth.errors.networkError") || "Authentication failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // ORG REGISTRATION FLOW
  // =========================================================
  const handleOrgRegister = async () => {
    if (!orgType) {
      setError(t("auth.errors.orgTypeRequired") || "Please select organization type");
      return;
    }
    if (!orgName.trim()) {
      setError(t("auth.errors.orgNameRequired") || "Please enter organization name");
      return;
    }
    if (!contactName.trim()) {
      setError(t("auth.errors.contactNameRequired") || "Please enter representative name");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError(t("auth.errors.emailRequired") || "Please enter a valid email address");
      return;
    }
    const cleanPhone = orgPhone.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setError(t("auth.errors.invalidPhone") || "Please enter a valid 10-digit mobile number");
      return;
    }
    if (!orgPassword || orgPassword.length < 8) {
      setError(t("auth.errors.passwordRequired") || "Password must be at least 8 characters long");
      return;
    }
    if (orgPassword !== confirmPassword) {
      setError(t("auth.errors.passwordMismatch") || "Passwords do not match");
      return;
    }
    if (!orgState) {
      setError(t("auth.errors.stateRequired") || "Please select state");
      return;
    }
    if (!orgDistrict) {
      setError(t("auth.errors.districtRequired") || "Please select district");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await apiFetch("/api/auth/register-org", {
        method: "POST",
        body: JSON.stringify({
          orgType,
          orgName: orgName.trim(),
          contactName: contactName.trim(),
          email: email.trim(),
          phone: cleanPhone,
          password: orgPassword,
          stateCode: orgState,
          districtCode: orgDistrict,
          blockCode: blockCode.trim(),
          panchayatId: panchayatId.trim(),
          registrationNumber: registrationNumber.trim(),
        }),
      });

      if (data && data.token && data.user) {
        onLogin({ role: data.user.role, token: data.token, user: data.user });
      } else {
        setSuccessMsg(data.message || "Registration submitted. An administrator will verify your credentials shortly.");
        setOrgView("login");
      }
    } catch (err) {
      setError(err.message || t("auth.errors.networkError") || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event, action) => {
    if (event.key === "Enter") action();
  };

  const handleInputFocus = (e) => {
    if (e && e.target && typeof e.target.scrollIntoView === "function") {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="auth-v2" lang={lang}>
      {/* FIXED HEADER */}
      <header className="auth-header">
        <div className="auth-header-inner">
          <div className="auth-header-brand">
            <img
              src="/logo_hackathon.jpeg"
              alt="Sahayta Setu logo"
              className="auth-header-logo"
              width="32"
              height="32"
            />
            <div className="auth-brand-text">
              <span className="auth-brand-title">Sahayta Setu</span>
              <span className="auth-brand-subtitle">{t("auth.platformLabel")}</span>
            </div>
          </div>

          <div className="auth-header-actions">
            {UI_LANGUAGES && UI_LANGUAGES.length > 1 && (
              <div className="auth-lang-switch">
                <select
                  className="auth-lang-select"
                  value={lang}
                  onChange={(e) => setLanguage(e.target.value)}
                  aria-label={t("common.language")}
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </div>
            )}

            <a href="tel:112" className="auth-call-pill">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{t("auth.call112")}</span>
            </a>
          </div>
        </div>
      </header>

      {/* MAIN AUTH SECTION */}
      <main className="auth-main">
        <div className="auth-bg-decor" aria-hidden="true">
          <div className="auth-bg-blob-1" />
          <div className="auth-bg-blob-2" />
          <div className="auth-bg-blob-3" />
        </div>

        <div className="auth-content-container">
          {/* LEFT COLUMN: BRAND & PILLARS */}
          <div className="auth-left-col">
            <div className="auth-badges-row">
              <span className="auth-badge-pill">
                <span className="auth-badge-dot" />
                {t("auth.badgeOffline")}
              </span>
              <span className="auth-badge-pill">
                <span className="auth-badge-dot" />
                {t("auth.badgeResponders")}
              </span>
            </div>

            <h1 className="auth-hero-title">{t("auth.heroTitle")}</h1>
            <p className="auth-hero-tagline">{t("auth.heroTagline")}</p>

            <div className="auth-pillars-grid">
              <div className="auth-pillar-card">
                <div className="auth-pillar-top">
                  <div className="auth-pillar-icon-tile amber">⚡</div>
                  <span className="auth-pillar-tag">{t("auth.pillars.offlineSosTag")}</span>
                </div>
                <h3 className="auth-pillar-title">{t("auth.pillars.offlineSosTitle")}</h3>
                <p className="auth-pillar-desc">{t("auth.pillars.offlineSosDesc")}</p>
              </div>

              <div className="auth-pillar-card">
                <div className="auth-pillar-top">
                  <div className="auth-pillar-icon-tile blue">📍</div>
                  <span className="auth-pillar-tag">{t("auth.pillars.locationTag")}</span>
                </div>
                <h3 className="auth-pillar-title">{t("auth.pillars.locationTitle")}</h3>
                <p className="auth-pillar-desc">{t("auth.pillars.locationDesc")}</p>
              </div>

              <div className="auth-pillar-card">
                <div className="auth-pillar-top">
                  <div className="auth-pillar-icon-tile emerald">🛡️</div>
                  <span className="auth-pillar-tag">{t("auth.pillars.respondersTag")}</span>
                </div>
                <h3 className="auth-pillar-title">{t("auth.pillars.respondersTitle")}</h3>
                <p className="auth-pillar-desc">{t("auth.pillars.respondersDesc")}</p>
              </div>

              <div className="auth-pillar-card">
                <div className="auth-pillar-top">
                  <div className="auth-pillar-icon-tile indigo">▦</div>
                  <span className="auth-pillar-tag">{t("auth.pillars.dashboardsTag")}</span>
                </div>
                <h3 className="auth-pillar-title">{t("auth.pillars.dashboardsTitle")}</h3>
                <p className="auth-pillar-desc">{t("auth.pillars.dashboardsDesc")}</p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: AUTH CARD */}
          <div className="auth-right-col">
            <div className="auth-card">
              <div className="auth-card-top-bar" aria-hidden="true" />

              {/* TWO-OPTION SEGMENTED TOGGLE (Citizens vs NGO / Authority) */}
              <div
                style={{
                  display: "flex",
                  background: "#f1f5f9",
                  padding: "4px",
                  borderRadius: "12px",
                  marginBottom: "20px",
                  gap: "4px",
                }}
                role="tablist"
                aria-label="Login user type"
              >
                <button
                  type="button"
                  role="tab"
                  id="tab-citizen"
                  aria-selected={authMode === "citizen"}
                  aria-controls="panel-citizen"
                  onClick={() => switchAuthMode("citizen")}
                  style={{
                    flex: 1,
                    minHeight: "48px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    cursor: "pointer",
                    background: authMode === "citizen" ? "#ffffff" : "transparent",
                    color: authMode === "citizen" ? "#091426" : "#64748b",
                    boxShadow: authMode === "citizen" ? "0 2px 4px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  👨‍🌾 {t("auth.citizenTab")}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-org"
                  aria-selected={authMode === "org"}
                  aria-controls="panel-org"
                  onClick={() => switchAuthMode("org")}
                  style={{
                    flex: 1,
                    minHeight: "48px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    cursor: "pointer",
                    background: authMode === "org" ? "#ffffff" : "transparent",
                    color: authMode === "org" ? "#091426" : "#64748b",
                    boxShadow: authMode === "org" ? "0 2px 4px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  🏢 {t("auth.orgTab")}
                </button>
              </div>

              {/* Card Header */}
              <div className="auth-card-header">
                <span className="auth-badge-label">{t("auth.secureAccess")}</span>
                <h2 className="auth-card-title">
                  {authMode === "citizen"
                    ? citizenStep === "phone"
                      ? t("auth.welcomeBack")
                      : t("auth.createAccount")
                    : orgView === "login"
                    ? "Authority & Responder Sign In"
                    : "Register Organization"}
                </h2>
                <p className="auth-card-subtitle">
                  {authMode === "citizen"
                    ? citizenStep === "phone"
                      ? t("auth.citizenLoginSubtitle")
                      : t("auth.citizenRegisterSubtitle")
                    : orgView === "login"
                    ? t("auth.orgLoginSubtitle")
                    : "Official disaster response credentials will be reviewed by platform administrator."}
                </p>
              </div>

              {/* ===================================================
                  CITIZEN MODE (OTP except explicitly configured demo)
              =================================================== */}
              {authMode === "citizen" && (
                <div id="panel-citizen" role="tabpanel" aria-labelledby="tab-citizen">
                  {/* STEP 1: PHONE INPUT */}
                  {citizenStep === "phone" && (
                    <>
                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="mobile">
                          {t("auth.mobileNumberLabel")}
                        </label>
                        <div className={`auth-phone-field ${error ? "has-error" : ""}`}>
                          <span className="auth-phone-prefix">+91</span>
                          <input
                            id="mobile"
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            autoComplete="tel"
                            placeholder={t("auth.mobileNumberPlaceholder")}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={(e) => handleKeyDown(e, handleCitizenContinue)}
                            onFocus={handleInputFocus}
                            aria-invalid={Boolean(error)}
                            className="auth-input-base"
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>

                      {error && (
                        <div className="auth-error-alert" role="alert" aria-live="polite" style={{ marginBottom: "16px" }}>
                          <span className="auth-error-icon" aria-hidden="true">⚠️</span>
                          <span>{error}</span>
                        </div>
                      )}

                      <button
                        className="auth-submit-btn"
                        onClick={handleCitizenContinue}
                        disabled={loading}
                        type="button"
                        style={{ minHeight: "48px" }}
                      >
                        {loading ? (
                          <>
                            <span className="auth-btn-spinner" aria-hidden="true" />
                            <span>Signing In...</span>
                          </>
                        ) : (
                          <>
                            <span>{t("auth.continue") || "Continue"}</span>
                            <span aria-hidden="true">→</span>
                          </>
                        )}
                      </button>

                      <div style={{ textAlign: "center", marginTop: "16px" }}>
                        <button
                          type="button"
                          className="auth-text-btn"
                          onClick={() => {
                            setError("");
                            setOtpRequested(false);
                            setCitizenStep("register");
                          }}
                          style={{ fontSize: "0.875rem", color: "#2563eb", fontWeight: 600, minHeight: "40px" }}
                        >
                          {t("auth.newHereCreateAccount") || "New here? Create an account"} →
                        </button>
                      </div>
                    </>
                  )}

                  {/* STEP 2: REGISTRATION DETAILS */}
                  {citizenStep === "register" && (
                    <div className="auth-register-container" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="reg-citizen-phone">
                          {t("auth.mobileNumberLabel")}
                        </label>
                        <div className="auth-phone-field">
                          <span className="auth-phone-prefix">+91</span>
                          <input
                            id="reg-citizen-phone"
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            autoComplete="tel"
                            placeholder={t("auth.mobileNumberPlaceholder")}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                            onFocus={handleInputFocus}
                            className="auth-input-base"
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>

                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="name">
                          {t("auth.nameLabelVillager")}
                        </label>
                        <div className="auth-input-box">
                          <input
                            id="name"
                            type="text"
                            autoComplete="name"
                            placeholder={t("auth.namePlaceholder")}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onFocus={handleInputFocus}
                            className="auth-input-base"
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>

                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="village">
                          {t("auth.villageLabel")}
                        </label>
                        <div className="auth-input-box">
                          <input
                            id="village"
                            type="text"
                            placeholder={t("auth.villagePlaceholder")}
                            value={village}
                            onChange={(e) => setVillage(e.target.value)}
                            onFocus={handleInputFocus}
                            className="auth-input-base"
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>

                      <LocationSelector
                        selectedState={citizenState}
                        selectedDistrict={citizenDistrict}
                        onChange={({ state, district: dist }) => {
                          setCitizenState(state);
                          setCitizenDistrict(dist);
                        }}
                        required={true}
                      />

                      {otpRequested && !phoneOnlyDemo && (
                        <div className="auth-input-group">
                          <label className="auth-section-label" htmlFor="citizen-code">
                            {t("auth.codeLabel")}
                          </label>
                          <input
                            id="citizen-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder={t("auth.codePlaceholder")}
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={(e) => handleKeyDown(e, handleCitizenRegister)}
                            onFocus={handleInputFocus}
                            className="auth-input-base"
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      )}

                      {successMsg && (
                        <div className="auth-success-alert" role="status" aria-live="polite">
                          {successMsg}
                        </div>
                      )}

                      {error && (
                        <div className="auth-error-alert" role="alert" aria-live="polite" style={{ marginBottom: "16px" }}>
                          <span className="auth-error-icon" aria-hidden="true">⚠️</span>
                          <span>{error}</span>
                        </div>
                      )}

                      <button
                        className="auth-submit-btn"
                        onClick={handleCitizenRegister}
                        disabled={loading}
                        type="button"
                        style={{ minHeight: "48px" }}
                      >
                        {loading ? (
                          <>
                            <span className="auth-btn-spinner" aria-hidden="true" />
                            <span>Creating Account...</span>
                          </>
                        ) : (
                          <>
                            <span>
                              {!phoneOnlyDemo && otpRequested
                                ? (t("auth.verifyOtp") || "Verify OTP and create account")
                                : !phoneOnlyDemo
                                  ? (t("auth.sendOtp") || "Send OTP")
                                  : (t("auth.createAccount") || "Create Account")}
                            </span>
                            <span aria-hidden="true">→</span>
                          </>
                        )}
                      </button>

                      <div style={{ textAlign: "center", marginTop: "12px" }}>
                        <button
                          type="button"
                          className="auth-text-btn"
                          onClick={() => {
                            setCitizenStep("phone");
                            setError("");
                          }}
                          style={{ minHeight: "44px" }}
                        >
                          ← {t("auth.alreadyHaveAccount") || "Already have an account? Sign in"}
                        </button>
                      </div>
                    </div>
                  )}

                  {citizenStep === "otp" && (
                    <div className="auth-register-container" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="citizen-login-code">
                          {t("auth.codeLabel")}
                        </label>
                        <input
                          id="citizen-login-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder={t("auth.codePlaceholder")}
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={(e) => handleKeyDown(e, handleCitizenOtpLogin)}
                          onFocus={handleInputFocus}
                          className="auth-input-base"
                          style={{ minHeight: "48px" }}
                        />
                      </div>
                      {successMsg && (
                        <div className="auth-success-alert" role="status" aria-live="polite">
                          {successMsg}
                        </div>
                      )}
                      {error && (
                        <div className="auth-error-alert" role="alert" aria-live="polite">
                          <span className="auth-error-icon" aria-hidden="true">⚠️</span>
                          <span>{error}</span>
                        </div>
                      )}
                      <button
                        className="auth-submit-btn"
                        onClick={handleCitizenOtpLogin}
                        disabled={loading}
                        type="button"
                        style={{ minHeight: "48px" }}
                      >
                        {loading ? t("auth.verifying") : t("auth.verifyAndContinue", { role: "citizen" })}
                      </button>
                      <button
                        type="button"
                        className="auth-text-btn"
                        onClick={() => {
                          setCitizenStep("phone");
                          setOtpRequested(false);
                          setVerificationCode("");
                          setError("");
                          setSuccessMsg("");
                        }}
                        style={{ minHeight: "44px" }}
                      >
                        ← {t("auth.changeNumber")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ===================================================
                  NGO / AUTHORITY MODE: SIGN IN VIEW (Email + Password)
              =================================================== */}
              {authMode === "org" && orgView === "login" && (
                <div id="panel-org" role="tabpanel" aria-labelledby="tab-org">
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="org-email">
                      {t("auth.emailLabel")}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="org-email"
                        type="email"
                        autoComplete="email"
                        placeholder={t("auth.emailPlaceholder")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, handleOrgLogin)}
                        onFocus={handleInputFocus}
                        className="auth-input-base"
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="org-password">
                      {t("auth.passwordLabel")}
                    </label>
                    <div className="auth-input-box" style={{ display: "flex", alignItems: "center" }}>
                      <input
                        id="org-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder={t("auth.passwordPlaceholder")}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, handleOrgLogin)}
                        onFocus={handleInputFocus}
                        className="auth-input-base"
                        style={{ minHeight: "48px", flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: "0 12px",
                          cursor: "pointer",
                          color: "#64748b",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          minHeight: "48px",
                          display: "flex",
                          alignItems: "center",
                        }}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="auth-error-alert" role="alert" aria-live="polite" style={{ marginBottom: "16px" }}>
                      <span className="auth-error-icon" aria-hidden="true">⚠️</span>
                      <span>{error}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", fontSize: "0.85rem" }}>
                      {successMsg}
                    </div>
                  )}

                  <button
                    className="auth-submit-btn"
                    onClick={handleOrgLogin}
                    disabled={loading}
                    type="button"
                    style={{ minHeight: "48px" }}
                  >
                    {loading ? (
                      <>
                        <span className="auth-btn-spinner" aria-hidden="true" />
                        <span>Signing In...</span>
                      </>
                    ) : (
                      <>
                        <span>{t("auth.loginButton")}</span>
                        <span aria-hidden="true">→</span>
                      </>
                    )}
                  </button>

                  <div style={{ textAlign: "center", marginTop: "18px" }}>
                    <button
                      type="button"
                      className="auth-text-btn"
                      onClick={() => {
                        setOrgView("register");
                        setError("");
                      }}
                      style={{ fontSize: "0.9rem", color: "#2563eb", fontWeight: 600, minHeight: "48px" }}
                    >
                      {t("auth.registerOrgLink")} →
                    </button>
                  </div>
                </div>
              )}

              {/* ===================================================
                  NGO / AUTHORITY MODE: REGISTER VIEW
              =================================================== */}
              {authMode === "org" && orgView === "register" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Org Type */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="org-type">
                      {t("auth.orgTypeLabel")}
                    </label>
                    <select
                      id="org-type"
                      className="auth-input-base"
                      value={orgType}
                      onChange={(e) => setOrgType(e.target.value)}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", minHeight: "48px" }}
                    >
                      <option value="NGO">Non-Governmental Organization (NGO)</option>
                      <option value="PANCHAYAT">Local Authority</option>
                      <option value="DISTRICT_AUTHORITY">District Disaster Authority</option>
                    </select>
                  </div>

                  {/* Org Name */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="org-name">
                      {t("auth.orgNameLabel")}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="org-name"
                        type="text"
                        className="auth-input-base"
                        placeholder={t("auth.orgNamePlaceholder")}
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  {/* Representative Name */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="contact-name">
                      {t("auth.contactNameLabel")}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="contact-name"
                        type="text"
                        className="auth-input-base"
                        placeholder={t("auth.contactNamePlaceholder")}
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  {/* Official Email */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="reg-email">
                      {t("auth.emailLabel")}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        className="auth-input-base"
                        placeholder="officer@org.gov.in"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  {/* Official Phone */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="reg-phone">
                      {t("auth.officialPhoneLabel")}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="reg-phone"
                        type="tel"
                        autoComplete="tel"
                        maxLength={10}
                        className="auth-input-base"
                        placeholder="10-digit phone"
                        value={orgPhone}
                        onChange={(e) => setOrgPhone(e.target.value.replace(/\D/g, ""))}
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  {/* Password & Confirm */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div className="auth-input-group">
                      <label className="auth-section-label" htmlFor="reg-pwd">
                        {t("auth.passwordLabel")}
                      </label>
                      <div className="auth-input-box">
                        <input
                          id="reg-pwd"
                          type={showRegPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className="auth-input-base"
                          placeholder="Min 8 chars"
                          value={orgPassword}
                          onChange={(e) => setOrgPassword(e.target.value)}
                          style={{ minHeight: "48px" }}
                        />
                      </div>
                    </div>
                    <div className="auth-input-group">
                      <label className="auth-section-label" htmlFor="reg-conf">
                        {t("auth.confirmPasswordLabel")}
                      </label>
                      <div className="auth-input-box">
                        <input
                          id="reg-conf"
                          type={showRegPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className="auth-input-base"
                          placeholder="Confirm"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          style={{ minHeight: "48px" }}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: "right", marginTop: "-6px", marginBottom: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      style={{ background: "none", border: "none", color: "#64748b", fontSize: "0.8rem", cursor: "pointer" }}
                    >
                      {showRegPassword ? "Hide passwords" : "Show passwords"}
                    </button>
                  </div>

                  {/* Location Selector */}
                  <LocationSelector
                    selectedState={orgState}
                    selectedDistrict={orgDistrict}
                    onChange={({ state, district: dist }) => {
                      setOrgState(state);
                      setOrgDistrict(dist);
                    }}
                    required={true}
                  />

                  {/* Local Authority registration fields */}
                  {orgType === "PANCHAYAT" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="reg-block">
                          {t("auth.blockLabel") || "Block"}
                        </label>
                        <div className="auth-input-box">
                          <input
                            id="reg-block"
                            type="text"
                            className="auth-input-base"
                            placeholder={t("auth.blockPlaceholder") || "e.g. Sahaspur"}
                            value={blockCode}
                            onChange={(e) => setBlockCode(e.target.value)}
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>
                      <div className="auth-input-group">
                        <label className="auth-section-label" htmlFor="reg-panch">
                          {t("auth.panchayatLabel") || "Authority ID"}
                        </label>
                        <div className="auth-input-box">
                          <input
                            id="reg-panch"
                            type="text"
                            className="auth-input-base"
                            placeholder={t("auth.panchayatPlaceholder") || "e.g. GP-MALDEVTA"}
                            value={panchayatId}
                            onChange={(e) => setPanchayatId(e.target.value)}
                            style={{ minHeight: "48px" }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Registration Number */}
                  <div className="auth-input-group">
                    <label className="auth-section-label" htmlFor="reg-num">
                      {t("auth.regNumberLabel") || "Registration / Authorization ID"}
                    </label>
                    <div className="auth-input-box">
                      <input
                        id="reg-num"
                        type="text"
                        className="auth-input-base"
                        placeholder={t("auth.regNumberPlaceholder") || "Govt / NGO Darpan ID"}
                        value={registrationNumber}
                        onChange={(e) => setRegistrationNumber(e.target.value)}
                        style={{ minHeight: "48px" }}
                      />
                    </div>
                  </div>

                  {/* Honest Review Note */}
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "12px 14px", borderRadius: "8px", fontSize: "0.825rem", color: "#92400e" }}>
                    ⚠️ {t("auth.honestReviewNote") || "Official accounts are subject to administrative review before operational authorization is granted."}
                  </div>

                  {error && (
                    <div className="auth-error-alert" role="alert" aria-live="polite">
                      <span className="auth-error-icon" aria-hidden="true">⚠️</span>
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    className="auth-submit-btn"
                    onClick={handleOrgRegister}
                    disabled={loading}
                    type="button"
                    style={{ minHeight: "48px" }}
                  >
                    {loading ? "Submitting Registration..." : (t("auth.registerSubmitBtn") || "Submit Registration")}
                  </button>

                  <div style={{ textAlign: "center", marginTop: "14px" }}>
                    <button
                      type="button"
                      className="auth-text-btn"
                      onClick={() => {
                        setOrgView("login");
                        setError("");
                      }}
                      style={{ minHeight: "48px" }}
                    >
                      ← {t("auth.backToLogin")}
                    </button>
                  </div>
                </div>
              )}

              {/* SECURITY PRIVACY NOTE */}
              <div className="auth-privacy-strip" style={{ marginTop: "20px" }}>
                <span className="auth-privacy-icon" aria-hidden="true">🔒</span>
                <span>{t("auth.securityNote")}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="auth-footer">
        <p className="auth-footer-text">{t("auth.footerText")}</p>
      </footer>
    </div>
  );
}

export default Login;
