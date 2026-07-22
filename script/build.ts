import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const allowlist = [
  "@google/generative-ai",
  "axios",
  "bcryptjs",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "dotenv",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pdfkit",
  "pg",
  "resend",
  "stripe",
  "uuid",
  "ws",
  "exceljs",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.dirname": "__dirname",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  const attachedAssetsDir = path.resolve("attached_assets");
  const distAssetsDir = path.resolve("dist", "attached_assets");
  if (existsSync(attachedAssetsDir)) {
    await mkdir(distAssetsDir, { recursive: true });
    await cp(attachedAssetsDir, distAssetsDir, { recursive: true });
    console.log("copied attached_assets → dist/attached_assets");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
