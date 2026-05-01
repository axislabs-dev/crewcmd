const { app, BrowserWindow, shell } = require("electron");

const DEFAULT_SERVER_URL = "http://localhost:3000";

function resolveServerUrl() {
  const rawUrl = process.env.CREWCMD_DESKTOP_SERVER_URL || DEFAULT_SERVER_URL;
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid CREWCMD_DESKTOP_SERVER_URL: ${rawUrl}`);
  }

  const isHttps = url.protocol === "https:";
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (!isHttps && !isLocalHttp) {
    throw new Error("CrewCmd desktop only accepts HTTPS or localhost HTTP server URLs");
  }

  return url.toString();
}

function isSameOrigin(targetUrl, serverOrigin) {
  try {
    return new URL(targetUrl).origin === serverOrigin;
  } catch {
    return false;
  }
}

async function createWindow() {
  const serverUrl = resolveServerUrl();
  const serverOrigin = new URL(serverUrl).origin;

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "CrewCmd",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, serverOrigin)) return { action: "allow" };
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, serverOrigin)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => undefined);
  });

  await mainWindow.loadURL(serverUrl);
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error(error);
        app.quit();
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
