const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("manager", {
  list: () => ipcRenderer.invoke("manager:list"),
  open: (id) => ipcRenderer.send("manager:open", id),
  hide: (id) => ipcRenderer.send("manager:hide", id),
  delete: (id) => ipcRenderer.send("manager:delete", { id, confirmed: true }),
  rename: (id, title) => ipcRenderer.send("manager:rename", { id, title }),
  newNote: () => ipcRenderer.send("manager:new"),
  onChanged: (cb) =>
    ipcRenderer.on("manager:notesChanged", (e, snapshot) => cb(snapshot)),
  version: () => ipcRenderer.invoke("manager:version"),
  shortcuts: () => ipcRenderer.invoke("manager:shortcuts"),
  recordShortcut: (active) =>
    ipcRenderer.invoke("manager:recordShortcut", active),
  onRecordingCancelled: (cb) =>
    ipcRenderer.on("manager:recordingCancelled", () => cb()),
  setShortcut: (id, accelerator) =>
    ipcRenderer.invoke("manager:setShortcut", { id, accelerator }),
  resetShortcut: (id) => ipcRenderer.invoke("manager:resetShortcut", id),
  onShowShortcuts: (cb) => ipcRenderer.on("manager:showShortcuts", () => cb()),
  setWorkspace: (id) => ipcRenderer.send("manager:setWorkspace", id),
  setListScope: (id) => ipcRenderer.send("manager:setListScope", id),
  createWorkspace: (name) => ipcRenderer.send("manager:createWorkspace", name),
  renameWorkspace: (id, name) =>
    ipcRenderer.send("manager:renameWorkspace", { id, name }),
  workspaceDeletion: (id) =>
    ipcRenderer.invoke("manager:workspaceDeletion", id),
  deleteWorkspace: (id) =>
    ipcRenderer.send("manager:deleteWorkspace", { id, confirmed: true }),
  moveNote: (id, workspaceId) =>
    ipcRenderer.send("manager:moveNote", { id, workspaceId }),
  exportAll: () => ipcRenderer.invoke("manager:export"),
  importNotes: () => ipcRenderer.invoke("manager:import"),
  setTheme: (mode) => ipcRenderer.send("manager:setTheme", mode),
  setAccent: (id) => ipcRenderer.send("manager:setAccent", id),
  setSidebarOpen: (isOpen) =>
    ipcRenderer.send("manager:setSidebarOpen", !!isOpen),
  openHelp: () => ipcRenderer.send("manager:openHelp"),
});
