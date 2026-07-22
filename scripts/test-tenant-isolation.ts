import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  clients,
  laundryBusinesses,
  productCategorySettings,
  users,
} from "@shared/schema";
import {
  db,
  runWithPlatformDatabase,
  runWithTenantDatabase,
} from "../server/db";
import { storage } from "../server/storage";

function errorChainIncludes(error: unknown, expected: string) {
  let current = error;
  while (current instanceof Error) {
    if (current.message.includes(expected)) return true;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

async function main() {
  const runId = Date.now().toString(36);
  const adminUsernameA = `isolation-admin-a-${runId}`;
  const adminUsernameB = `isolation-admin-b-${runId}`;
  const [businessA, businessB] = await runWithPlatformDatabase(async () =>
    db
      .insert(laundryBusinesses)
      .values([
        { name: "Isolation Test A", slug: `isolation-test-a-${runId}` },
        { name: "Isolation Test B", slug: `isolation-test-b-${runId}` },
      ])
      .returning(),
  );

  await runWithPlatformDatabase(async () => {
    await db.insert(users).values([
      {
        username: adminUsernameA,
        password: "test-password-a",
        role: "admin",
        name: "Admin A",
        businessId: businessA.id,
      },
      {
        username: adminUsernameB,
        password: "test-password-b",
        role: "admin",
        name: "Admin B",
        businessId: businessB.id,
      },
    ]);
  });

  const clientA = await runWithTenantDatabase(businessA.id, async () => {
    const [created] = await db
      .insert(clients)
      .values({ name: "Tenant A Client" })
      .returning();
    assert.equal(created.businessId, businessA.id);
    return created;
  });

  const clientB = await runWithTenantDatabase(businessB.id, async () => {
    const [created] = await db
      .insert(clients)
      .values({ name: "Tenant B Client" })
      .returning();
    assert.equal(created.businessId, businessB.id);
    return created;
  });

  await runWithTenantDatabase(businessA.id, async () => {
    const visibleClients = await storage.getClients();
    assert.deepEqual(visibleClients.map((client) => client.id), [clientA.id]);

    const otherTenantRead = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientB.id));
    assert.equal(otherTenantRead.length, 0);

    const changedOtherTenant = await db
      .update(clients)
      .set({ name: "Cross-tenant update" })
      .where(eq(clients.id, clientB.id))
      .returning();
    assert.equal(changedOtherTenant.length, 0);

    const deletedOtherTenant = await db
      .delete(clients)
      .where(eq(clients.id, clientB.id))
      .returning();
    assert.equal(deletedOtherTenant.length, 0);

    const visibleUsers = await db.select().from(users);
    assert.deepEqual(
      visibleUsers.map((user) => user.username),
      [adminUsernameA],
    );

    const visibleBusinesses = await db.select().from(laundryBusinesses);
    assert.deepEqual(visibleBusinesses.map((business) => business.id), [businessA.id]);

    await assert.rejects(
      db.insert(clients).values({
        name: "Forged Tenant Client",
        businessId: businessB.id,
      }),
      (error) => errorChainIncludes(error, "does not match tenant scope"),
    );

    await assert.rejects(
      db.insert(users).values({
        username: "forged-platform-owner",
        password: "test-password",
        role: "super_admin",
        name: "Forged Owner",
      }),
      (error) =>
        errorChainIncludes(error, "cannot create or modify a platform-owner account"),
    );

    const [settings] = await db
      .insert(productCategorySettings)
      .values({ customCategories: ["Tenant A Only"] })
      .returning();
    assert.equal(settings.businessId, businessA.id);
  });

  await runWithTenantDatabase(businessB.id, async () => {
    const visibleClients = await storage.getClients();
    assert.deepEqual(visibleClients.map((client) => client.id), [clientB.id]);
    assert.equal(visibleClients[0]?.name, "Tenant B Client");

    const [settings] = await db
      .insert(productCategorySettings)
      .values({ customCategories: ["Tenant B Only"] })
      .returning();
    assert.equal(settings.businessId, businessB.id);

    const visibleSettings = await db.select().from(productCategorySettings);
    assert.deepEqual(visibleSettings[0]?.customCategories, ["Tenant B Only"]);
  });

  await runWithPlatformDatabase(async () => {
    const platformClients = (await db.select().from(clients)).filter(
      (client) =>
        client.businessId === businessA.id || client.businessId === businessB.id,
    );
    assert.equal(platformClients.length, 2);

    await assert.rejects(
      db.insert(clients).values({ name: "Ownerless Platform Client" }),
      (error) => errorChainIncludes(error, "require an explicit business_id"),
    );
  });

  const unscopedClients = await db.select().from(clients);
  assert.equal(unscopedClients.length, 0);

  console.log("Tenant isolation checks passed for businesses A and B.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
