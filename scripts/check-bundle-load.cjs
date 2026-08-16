const Module = require("node:module");

const registeredCommands = new Map();
const vscodeStub = {
  commands: {
    registerCommand(command, callback) {
      registeredCommands.set(command, callback);
      return { dispose() {} };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require("../dist/extension.js");
const context = { subscriptions: [], extensionPath: process.cwd() };
extension.activate(context);

for (const command of [
  "compressImage.compressImage",
  "compressImage.resize256",
  "compressImage.resize512",
  "compressImage.resize1080",
]) {
  if (!registeredCommands.has(command)) {
    throw new Error(`Bundle did not register ${command} during activation`);
  }
}

console.log("Bundle load and command registration check passed.");
