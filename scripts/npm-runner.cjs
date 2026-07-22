const path = require("path");
const { spawn } = require("child_process");

function normalizePath(value) {
  return (value || "")
    .replace(/^Microsoft\.PowerShell\.Core\\FileSystem::/i, "")
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "");
}

function getProjectRoot() {
  const packageJsonPath = normalizePath(process.env.npm_package_json);

  if (packageJsonPath) {
    return path.dirname(packageJsonPath);
  }

  return path.resolve(__dirname, "..");
}

function resolvePackagePath(projectRoot, packageName, relativePath) {
  return path.join(projectRoot, "node_modules", packageName, relativePath);
}

const projectRoot = getProjectRoot();
// When invoked as `node ./scripts/npm-runner.cjs`, argv[1] is this file.
// Preserve only user-supplied arguments passed after the npm script name.
const forwardedArgs = process.argv.slice(2);
const scriptName = process.env.npm_lifecycle_event;

process.chdir(projectRoot);

function getCommand(name) {
  switch (name) {
    case "dev":
      return {
        file: process.execPath,
        args: [
          resolvePackagePath(projectRoot, "tsx", "dist/cli.mjs"),
          "watch",
          path.join(projectRoot, "server", "index.ts"),
        ],
      };
    case "build":
      return {
        file: process.execPath,
        args: [
          resolvePackagePath(projectRoot, "tsx", "dist/cli.mjs"),
          path.join(projectRoot, "script", "build.ts"),
        ],
      };
    case "start":
      return {
        file: process.execPath,
        args: [path.join(projectRoot, "dist", "index.cjs")],
        env: {
          NODE_ENV: process.env.NODE_ENV || "production",
        },
      };
    case "check":
      return {
        file: process.execPath,
        args: [resolvePackagePath(projectRoot, "typescript", "bin/tsc")],
      };
    case "db:generate":
      return {
        file: process.execPath,
        args: [resolvePackagePath(projectRoot, "drizzle-kit", "bin.cjs"), "generate"],
      };
    case "db:migrate":
      return {
        file: process.execPath,
        args: [resolvePackagePath(projectRoot, "drizzle-kit", "bin.cjs"), "migrate"],
      };
    case "db:push":
      return {
        file: process.execPath,
        args: [resolvePackagePath(projectRoot, "drizzle-kit", "bin.cjs"), "push"],
      };
    case "db:studio":
      return {
        file: process.execPath,
        args: [resolvePackagePath(projectRoot, "drizzle-kit", "bin.cjs"), "studio"],
      };
    default:
      return null;
  }
}

const command = getCommand(scriptName);

if (!command) {
  console.error(`Unsupported npm script: ${scriptName}`);
  process.exit(1);
}

const child = spawn(command.file, [...command.args, ...forwardedArgs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...command.env,
  },
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
