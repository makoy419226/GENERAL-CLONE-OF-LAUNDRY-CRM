import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

const platformAliases: Record<string, string> = {
  darwin: "mac",
  linux: "linux",
  win32: "windows",
};

function getPlatformLocalEnvFiles(platform = process.platform): string[] {
  const names = new Set<string>();
  const alias = platformAliases[platform];

  if (alias) {
    names.add(alias);
  }

  names.add(platform);

  return Array.from(names, (name) => `.env.${name}.local`);
}

function getNodeEnvFiles(nodeEnv = process.env.NODE_ENV): string[] {
  const normalizedNodeEnv = String(nodeEnv || "").trim();

  return normalizedNodeEnv
    ? [`.env.${normalizedNodeEnv}.local`, `.env.${normalizedNodeEnv}`]
    : [];
}

function addUniquePath(paths: string[], seen: Set<string>, targetPath: string) {
  const resolvedPath = path.resolve(targetPath);

  if (seen.has(resolvedPath)) {
    return;
  }

  seen.add(resolvedPath);
  paths.push(resolvedPath);
}

function expandHomePath(targetPath: string): string {
  const normalizedPath = String(targetPath || "").trim();
  if (!normalizedPath) return "";

  if (normalizedPath === "~") {
    return os.homedir();
  }

  if (normalizedPath.startsWith("~/") || normalizedPath.startsWith("~\\")) {
    return path.join(os.homedir(), normalizedPath.slice(2));
  }

  return normalizedPath;
}

function getExplicitEnvFiles(): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const names = ["LIQUID_WASHES_ENV_FILE"];

  for (const name of names) {
    const rawValue = String(process.env[name] || "");
    const values = rawValue.split(path.delimiter);

    for (const value of values) {
      const expandedPath = expandHomePath(value);
      if (expandedPath) {
        addUniquePath(files, seen, expandedPath);
      }
    }
  }

  return files;
}

function getMachineEnvFiles(): string[] {
  return [];
}

function getEnvSearchRoots(cwd = process.cwd()): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  addUniquePath(roots, seen, cwd);

  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (entryPoint && fs.existsSync(entryPoint)) {
    addUniquePath(roots, seen, path.dirname(entryPoint));
  }

  return roots;
}

export function getEnvFilePaths(cwd = process.cwd()): string[] {
  const candidates = [
    ...getPlatformLocalEnvFiles(),
    ...getNodeEnvFiles(),
    ".env.local",
    ".env",
  ];
  const searchRoots = getEnvSearchRoots(cwd);
  const existingFiles: string[] = [];
  const seen = new Set<string>();

  for (const envFilePath of [...getExplicitEnvFiles(), ...getMachineEnvFiles()]) {
    const resolvedPath = path.resolve(envFilePath);

    if (seen.has(resolvedPath) || !fs.existsSync(resolvedPath)) {
      continue;
    }

    seen.add(resolvedPath);
    existingFiles.push(resolvedPath);
  }

  for (const candidate of candidates) {
    for (const root of searchRoots) {
      const resolvedPath = path.resolve(root, candidate);

      if (seen.has(resolvedPath) || !fs.existsSync(resolvedPath)) {
        continue;
      }

      seen.add(resolvedPath);
      existingFiles.push(resolvedPath);
    }
  }

  return existingFiles;
}

export function loadEnvironment(cwd = process.cwd()): string[] {
  const envFilePaths = getEnvFilePaths(cwd);
  const fallbackPaths = getEnvSearchRoots(cwd).map((root) =>
    path.resolve(root, ".env"),
  );
  const loadedPaths = envFilePaths.length > 0 ? envFilePaths : fallbackPaths;

  dotenv.config({
    path: loadedPaths,
    quiet: true,
  });

  const loaded = new Set(loadedPaths.map((envFilePath) => path.resolve(envFilePath)));
  const lateExplicitEnvFiles = getExplicitEnvFiles().filter((envFilePath) => {
    const resolvedPath = path.resolve(envFilePath);

    return !loaded.has(resolvedPath) && fs.existsSync(resolvedPath);
  });

  if (lateExplicitEnvFiles.length > 0) {
    dotenv.config({
      path: lateExplicitEnvFiles,
      override: true,
      quiet: true,
    });
  }

  return [...envFilePaths, ...lateExplicitEnvFiles];
}
