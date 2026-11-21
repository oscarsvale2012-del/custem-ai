// The list of backend methods the renderer may call. Anything not listed
// here cannot be reached from the UI.
const METHODS = [
  "publicState", "saveSettings",
  "addProvider", "updateProvider", "removeProvider", "testProvider",
  "addAgent", "updateAgent", "removeAgent", "agentAction", "createDefaultTeam",
  "addServer", "updateServer", "removeServer", "connectServer", "disconnectServer", "refreshServer", "setToolPolicy",
  "detectStudios", "addProject", "updateProject", "removeProject", "setActiveProject", "refreshGame",
  "listFiles", "readFile", "getChange", "undoChange", "snapshotProject",
  "savePrompt", "deletePrompt", "toggleFavorite", "improvePrompt",
  "build", "createTask", "cancelTask", "retryTask", "clearFinishedTasks", "resolveApproval",
  "sendChat", "clearChat",
];

async function dispatch(backend, method, args) {
  if (!METHODS.includes(method)) throw new Error("Unknown method " + method);
  return backend[method](...(Array.isArray(args) ? args : []));
}

module.exports = { METHODS, dispatch };
