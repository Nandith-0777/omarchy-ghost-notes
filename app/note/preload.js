const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notes", {
  runtime: () => ipcRenderer.invoke("app:runtime"),
  update: (payload) => ipcRenderer.send("note:update", payload),
  getState: (id) => ipcRenderer.invoke("note:getState", id),
  setCollapsed: (id, collapsed) =>
    ipcRenderer.invoke("note:setCollapsed", { id, collapsed }),
  resize: (id, phase, x, y) =>
    ipcRenderer.send("note:resize", { id, phase, x, y }),
  drag: (id, phase, x, y) => ipcRenderer.send("note:drag", { id, phase, x, y }),
  dragBubble: (id, phase) => ipcRenderer.send("note:dragBubble", { id, phase }),
  close: (id) => ipcRenderer.send("note:close", id),
  newNote: () => ipcRenderer.send("note:new"),
  setIgnoreMouse: (id, ignore, recover) =>
    ipcRenderer.send("note:setIgnoreMouse", { id, ignore, recover }),
  setPinned: (id, pinned) => ipcRenderer.send("note:setPinned", { id, pinned }),
  imagesDir: () => ipcRenderer.invoke("note:imagesDir"),
  saveImage: (id, type, bytes) =>
    ipcRenderer.invoke("note:saveImage", { id, type, bytes }),
  onToggleGhost: (cb) => ipcRenderer.on("note:toggleGhost", cb),
  onPointerPosition: (cb) =>
    ipcRenderer.on("note:pointerPosition", (_event, point) => cb(point)),
});
