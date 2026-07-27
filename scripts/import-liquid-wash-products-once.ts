import { and, eq, or } from "drizzle-orm";
import { laundryBusinesses, products } from "@shared/schema";
import {
  db,
  runWithPlatformDatabase,
  runWithTenantDatabase,
} from "../server/db";
import { laundryItems } from "../server/seed";

const workspaceSlug = String(process.argv[2] || "").trim();

if (!workspaceSlug) {
  throw new Error(
    "Usage: tsx scripts/import-liquid-wash-products-once.ts <workspace-slug>",
  );
}

const workspace = await runWithPlatformDatabase(async () => {
  const [record] = await db
    .select({
      id: laundryBusinesses.id,
      name: laundryBusinesses.name,
      slug: laundryBusinesses.slug,
    })
    .from(laundryBusinesses)
    .where(eq(laundryBusinesses.slug, workspaceSlug))
    .limit(1);

  return record;
});

if (!workspace) {
  throw new Error(`Workspace "${workspaceSlug}" was not found`);
}

const result = await runWithTenantDatabase(workspace.id, async () => {
  let imported = 0;
  let skipped = 0;

  for (const item of laundryItems) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.businessId, workspace.id),
          or(
            eq(products.sku, item.sku),
            eq(products.name, item.name),
          ),
        ),
      )
      .limit(1);

    if (existing) {
      skipped += 1;
      continue;
    }

    const normalPrice = Number.parseFloat(item.price);
    await db.insert(products).values({
      ...item,
      businessId: workspace.id,
      dryCleanPrice: (normalPrice * 1.5).toFixed(2),
      ironOnlyPrice: (normalPrice * 0.5).toFixed(2),
    });
    imported += 1;
  }

  return { imported, skipped };
});

console.log(
  JSON.stringify({
    workspace: workspace.slug,
    sourceProducts: laundryItems.length,
    ...result,
  }),
);
