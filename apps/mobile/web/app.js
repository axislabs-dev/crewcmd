const STORAGE_KEY = "crewcmd.mobile.bootstrap";
const CONFIG_PATH = "./brand.generated.json";

const state = {
  brand: null,
  bootstrap: null,
  connectionStatus: "Bootstrap the app with a QR payload or config link to begin."
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

async function loadBrand() {
  const response = await fetch(CONFIG_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load ${CONFIG_PATH}`);
  }

  return response.json();
}

async function getPreferencesPlugin() {
  const plugin = window.Capacitor?.Plugins?.Preferences;
  if (plugin && typeof plugin.get === "function" && typeof plugin.set === "function") {
    return plugin;
  }

  return null;
}

async function getAppPlugin() {
  const plugin = window.Capacitor?.Plugins?.App;
  if (plugin && typeof plugin.addListener === "function") {
    return plugin;
  }

  return null;
}

async function getBrowserPlugin() {
  const plugin = window.Capacitor?.Plugins?.Browser;
  if (plugin && typeof plugin.open === "function") {
    return plugin;
  }

  return null;
}

async function getHapticsPlugin() {
  const plugin = window.Capacitor?.Plugins?.Haptics;
  if (plugin && typeof plugin.impact === "function") {
    return plugin;
  }

  return null;
}

async function readStoredBootstrap() {
  const preferences = await getPreferencesPlugin();
  if (preferences) {
    const result = await preferences.get({ key: STORAGE_KEY });
    return result.value ? JSON.parse(result.value) : null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function writeStoredBootstrap(payload) {
  const serialized = JSON.stringify(payload);
  const preferences = await getPreferencesPlugin();

  if (preferences) {
    await preferences.set({ key: STORAGE_KEY, value: serialized });
  } else {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  }
}

async function clearStoredBootstrap() {
  const preferences = await getPreferencesPlugin();

  if (preferences) {
    await preferences.remove({ key: STORAGE_KEY });
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function decodePayloadToken(payloadToken) {
  const normalized = payloadToken.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = window.atob(padded);
  return JSON.parse(decoded);
}

function parseBootstrapInput(rawValue) {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("No bootstrap payload provided.");
  }

  if (value.startsWith("{")) {
    return JSON.parse(value);
  }

  try {
    const url = new URL(value);
    const payloadToken = url.searchParams.get("payload");
    if (!payloadToken) {
      throw new Error("Missing payload query parameter.");
    }

    return decodePayloadToken(payloadToken);
  } catch (error) {
    throw new Error(`Unable to parse bootstrap input: ${error.message}`);
  }
}

function normalizeBootstrapPayload(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Bootstrap payload must be an object.");
  }

  const serverUrl = String(input.serverUrl || "").trim();
  if (!serverUrl) {
    throw new Error("Bootstrap payload is missing serverUrl.");
  }

  const url = new URL(serverUrl);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("serverUrl must use http or https.");
  }

  return {
    version: input.version ?? 1,
    orgName: String(input.orgName || "CrewCmd"),
    profileId: String(input.profileId || "default"),
    serverUrl: url.toString().replace(/\/$/, ""),
    environmentLabel: String(input.environmentLabel || "Configured"),
    lockToSingleServer: Boolean(input.lockToSingleServer),
    tailscaleRequired: Boolean(input.tailscaleRequired),
    branding: {
      displayName: String(input.branding?.displayName || state.brand?.displayName || "CrewCmd Mobile"),
      primaryColor: String(input.branding?.primaryColor || state.brand?.primaryColor || "#0A7B83"),
      secondaryColor: String(input.branding?.secondaryColor || state.brand?.secondaryColor || "#F7B500")
    },
    support: {
      email: String(input.support?.email || state.brand?.supportEmail || "support@example.com")
    }
  };
}

function setStatus(message, isError = false) {
  state.connectionStatus = message;
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function applyThemeColors(source) {
  if (!source) return;
  document.documentElement.style.setProperty("--accent", source.primaryColor);
  document.documentElement.style.setProperty("--accent-strong", source.primaryColor);
  document.documentElement.style.setProperty("--signal", source.secondaryColor);
}

function updateUI() {
  const bootstrap = state.bootstrap;
  const brand = state.brand;
  const activeBrand = bootstrap?.branding ?? brand;

  elements.appName.textContent = activeBrand?.displayName || "CrewCmd Mobile";
  elements.orgName.textContent = bootstrap?.orgName || brand?.orgName || "Not configured";
  elements.serverUrl.textContent = bootstrap?.serverUrl || brand?.defaultBaseUrl || "No server selected";
  elements.profileId.textContent = bootstrap?.profileId || brand?.profileId || "Not configured";
  elements.environmentChip.textContent = bootstrap?.environmentLabel || brand?.environmentLabel || "Unconfigured";
  elements.supportLine.textContent = `Support: ${(bootstrap?.support?.email || brand?.supportEmail || "support@example.com")}`;
  elements.lockChip.textContent = bootstrap?.lockToSingleServer || brand?.lockToSingleServer ? "Locked" : "Multi-server";
  elements.networkHint.textContent = bootstrap?.tailscaleRequired || brand?.tailscaleRequired
    ? "Requires Tailscale reachability"
    : "Reachable over standard network access";
  elements.openCrewCmd.disabled = !Boolean(bootstrap?.serverUrl || brand?.defaultBaseUrl);
  elements.manualPanel.classList.toggle("hidden", !brand?.allowManualServerOverride && !bootstrap?.allowManualServerOverride);
  elements.bootstrapInput.placeholder = `${brand?.deepLinkScheme || "crewcmd"}://bootstrap?payload=...`;
  applyThemeColors(activeBrand || brand);
}

async function pulseHaptic(style = "Medium") {
  const haptics = await getHapticsPlugin();
  if (!haptics) return;

  try {
    await haptics.impact({ style });
  } catch {
    // Ignore haptic failures in browser preview.
  }
}

async function persistBootstrap(payload) {
  state.bootstrap = payload;
  await writeStoredBootstrap(payload);
  updateUI();
}

async function applyBootstrapPayload(rawInput) {
  const parsed = parseBootstrapInput(rawInput);
  const normalized = normalizeBootstrapPayload(parsed);
  await persistBootstrap(normalized);
  setStatus(`Connected to ${normalized.serverUrl}.`, false);
  await pulseHaptic("Heavy");
}

function getActiveServerUrl() {
  return state.bootstrap?.serverUrl || state.brand?.defaultBaseUrl || "";
}

async function openCrewCmd() {
  const serverUrl = getActiveServerUrl();
  if (!serverUrl) {
    setStatus("No CrewCmd server is configured yet.", true);
    return;
  }

  const targetUrl = `${serverUrl}/chat`;
  const browser = await getBrowserPlugin();

  try {
    if (browser) {
      await browser.open({ url: targetUrl, presentationStyle: "fullscreen" });
    } else {
      window.location.assign(targetUrl);
    }

    setStatus(`Opening ${targetUrl}`, false);
  } catch (error) {
    setStatus(`Unable to open CrewCmd: ${error.message}`, true);
  }
}

async function testConnection() {
  const serverUrl = getActiveServerUrl();
  if (!serverUrl) {
    setStatus("Configure a server first.", true);
    return;
  }

  setStatus("Testing server health…", false);

  try {
    const response = await fetch(`${serverUrl}/api/health`, { method: "GET", mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setStatus(`Server healthy at ${serverUrl}`, false);
    await pulseHaptic("Light");
  } catch (error) {
    setStatus(`Health check failed: ${error.message}`, true);
  }
}

async function clearBootstrap() {
  await clearStoredBootstrap();
  state.bootstrap = null;
  elements.bootstrapInput.value = "";
  elements.manualServerInput.value = "";
  updateUI();
  setStatus("Bootstrap cleared. Apply a new QR payload or link.", false);
}

async function applyManualServer() {
  const manualServer = elements.manualServerInput.value.trim();
  if (!manualServer) {
    setStatus("Enter a server URL first.", true);
    return;
  }

  const payload = normalizeBootstrapPayload({
    orgName: state.bootstrap?.orgName || state.brand?.orgName || "CrewCmd",
    profileId: state.bootstrap?.profileId || state.brand?.profileId || "manual",
    serverUrl: manualServer,
    environmentLabel: state.bootstrap?.environmentLabel || state.brand?.environmentLabel || "Manual override",
    lockToSingleServer: false,
    tailscaleRequired: state.bootstrap?.tailscaleRequired ?? state.brand?.tailscaleRequired ?? false,
    branding: {
      displayName: state.bootstrap?.branding?.displayName || state.brand?.displayName || "CrewCmd Mobile",
      primaryColor: state.bootstrap?.branding?.primaryColor || state.brand?.primaryColor || "#0A7B83",
      secondaryColor: state.bootstrap?.branding?.secondaryColor || state.brand?.secondaryColor || "#F7B500"
    },
    support: {
      email: state.bootstrap?.support?.email || state.brand?.supportEmail || "support@example.com"
    }
  });

  await persistBootstrap(payload);
  setStatus(`Manual server override saved for ${payload.serverUrl}`, false);
}

function bindEvents() {
  elements.applyBootstrap.addEventListener("click", async () => {
    try {
      await applyBootstrapPayload(elements.bootstrapInput.value);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.clearBootstrap.addEventListener("click", () => {
    clearBootstrap().catch((error) => setStatus(error.message, true));
  });

  elements.testConnection.addEventListener("click", () => {
    testConnection().catch((error) => setStatus(error.message, true));
  });

  elements.openCrewCmd.addEventListener("click", () => {
    openCrewCmd().catch((error) => setStatus(error.message, true));
  });

  elements.applyManualServer.addEventListener("click", () => {
    applyManualServer().catch((error) => setStatus(error.message, true));
  });
}

async function wireDeepLinks() {
  const app = await getAppPlugin();
  if (!app) return;

  await app.addListener("appUrlOpen", async ({ url }) => {
    if (!url) return;

    try {
      await applyBootstrapPayload(url);
    } catch (error) {
      setStatus(`Deep link failed: ${error.message}`, true);
    }
  });
}

async function handleInitialUrl() {
  const url = new URL(window.location.href);
  const payloadToken = url.searchParams.get("payload");
  if (!payloadToken) return;

  try {
    await applyBootstrapPayload(`${state.brand?.deepLinkScheme || "crewcmd"}://bootstrap?payload=${payloadToken}`);
  } catch (error) {
    setStatus(`Bootstrap from launch URL failed: ${error.message}`, true);
  }
}

function cacheElements() {
  elements.appName = $("app-name");
  elements.orgName = $("org-name");
  elements.serverUrl = $("server-url");
  elements.profileId = $("profile-id");
  elements.networkHint = $("network-hint");
  elements.environmentChip = $("environment-chip");
  elements.connectionStatus = $("connection-status");
  elements.supportLine = $("support-line");
  elements.lockChip = $("lock-chip");
  elements.openCrewCmd = $("open-crewcmd");
  elements.testConnection = $("test-connection");
  elements.bootstrapInput = $("bootstrap-input");
  elements.applyBootstrap = $("apply-bootstrap");
  elements.clearBootstrap = $("clear-bootstrap");
  elements.manualPanel = $("manual-panel");
  elements.manualServerInput = $("manual-server-input");
  elements.applyManualServer = $("apply-manual-server");
}

async function boot() {
  cacheElements();
  state.brand = await loadBrand();
  state.bootstrap = await readStoredBootstrap();
  bindEvents();
  await wireDeepLinks();
  await handleInitialUrl();
  updateUI();
  setStatus(state.connectionStatus, false);
}

boot().catch((error) => {
  console.error(error);
  const fallback = $("connection-status");
  if (fallback) {
    fallback.textContent = `Failed to load mobile shell: ${error.message}`;
    fallback.style.color = "var(--danger)";
  }
});
