import { spawn } from "node:child_process";

const migration = spawn("./node_modules/.bin/prisma", ["migrate", "deploy"], { stdio: "inherit", env: process.env });
const code = await new Promise((resolve) => migration.on("exit", resolve));
if (code !== 0) process.exit(typeof code === "number" ? code : 1);

const server = spawn("node", ["server.js"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.kill(signal));
server.on("exit", (exitCode) => process.exit(typeof exitCode === "number" ? exitCode : 1));
