const { spawn } = require("node:child_process");
const electronPath = require("electron");

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const electronProcess = spawn(electronPath, ["."], {
  env: environment,
  stdio: "inherit"
});

electronProcess.on("exit", (exitCode) => {
  process.exit(exitCode ?? 0);
});
