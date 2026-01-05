const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let serverProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      contextIsolation: true
    }
  });

  win.loadURL("http://localhost:3000");
}

app.whenReady().then(() => {
  // запускаємо локальний сервер
  serverProcess = spawn(process.execPath, [path.join(__dirname, "server.js")]);

  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});
