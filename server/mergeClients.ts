import { db } from "./db";
import { clients, bills, orders, clientTransactions, billPayments } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function mergeClientAccounts(sourceClientId: number, targetClientId: number) {
  try {
    const [sourceClient] = await db.select().from(clients).where(eq(clients.id, sourceClientId));
    const [targetClient] = await db.select().from(clients).where(eq(clients.id, targetClientId));

    if (!sourceClient || !targetClient) {
      throw new Error("One or both clients not found");
    }

    await db.update(bills).set({ clientId: targetClientId, customerName: targetClient.name }).where(eq(bills.clientId, sourceClientId));
    await db.update(orders).set({ clientId: targetClientId, customerName: targetClient.name }).where(eq(orders.clientId, sourceClientId));
    await db.update(clientTransactions).set({ clientId: targetClientId }).where(eq(clientTransactions.clientId, sourceClientId));
    await db.update(billPayments).set({ clientId: targetClientId }).where(eq(billPayments.clientId, sourceClientId));

    const newAmount = (parseFloat(targetClient.amount || "0") + parseFloat(sourceClient.amount || "0")).toFixed(2);
    const newDeposit = (parseFloat(targetClient.deposit || "0") + parseFloat(sourceClient.deposit || "0")).toFixed(2);
    const newBalance = (parseFloat(targetClient.balance || "0") + parseFloat(sourceClient.balance || "0")).toFixed(2);

    const updateData: any = { amount: newAmount, deposit: newDeposit, balance: newBalance };

    const targetType = ((targetClient as any).clientType || 'regular').trim().toLowerCase();
    if (targetType === 'broker') {
      const targetAddresses: string[] = (targetClient as any).brokerAddresses || [];
      const addressesToAdd: string[] = [];

      const sourceAddress = (sourceClient.address || '').trim().toUpperCase();
      if (sourceAddress && sourceAddress !== '-' && sourceAddress !== '0') {
        if (!targetAddresses.some(a => a.toUpperCase() === sourceAddress)) {
          addressesToAdd.push(sourceAddress);
        }
      }

      const sourceType = ((sourceClient as any).clientType || 'regular').trim().toLowerCase();
      if (sourceType === 'broker') {
        const sourceBrokerAddresses: string[] = (sourceClient as any).brokerAddresses || [];
        for (const addr of sourceBrokerAddresses) {
          const normalized = addr.trim().toUpperCase();
          if (normalized && !targetAddresses.some(a => a.toUpperCase() === normalized) && !addressesToAdd.some(a => a === normalized)) {
            addressesToAdd.push(normalized);
          }
        }
      }

      if (addressesToAdd.length > 0) {
        updateData.brokerAddresses = [...targetAddresses, ...addressesToAdd];
      }
    }

    await db.update(clients).set(updateData).where(eq(clients.id, targetClientId));
    await db.delete(clients).where(eq(clients.id, sourceClientId));

    console.log(`[MERGE] Client #${sourceClientId} (${sourceClient.name}) merged into Client #${targetClientId} (${targetClient.name})${targetType === 'broker' ? ' [Broker - addresses merged]' : ''}`);

    return { success: true, mergedInto: targetClientId };
  } catch (error) {
    console.error("Merge error:", error);
    throw error;
  }
}
