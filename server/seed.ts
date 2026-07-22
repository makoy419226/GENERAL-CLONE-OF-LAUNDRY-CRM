import { db } from "./db";
import { clients, users, bills } from "@shared/schema";
import { storage } from "./storage";
import { eq } from "drizzle-orm";
import { normalizePhoneForStorage, stripPhoneToDigits } from "@shared/phone";

const laundryItems = [
  // Arabic Clothes
  {
    name: "Kandoora/Thob",
    description: "Traditional men's robe",
    price: "8.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "KAN-001",
  },
  {
    name: "Ghutra",
    description: "Traditional head covering",
    price: "5.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "GHU-001",
  },
  {
    name: "Agal",
    description: "Traditional head rope",
    price: "3.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "AGA-001",
  },
  {
    name: "Bisht",
    description: "Traditional cloak",
    price: "25.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "BIS-001",
  },
  {
    name: "Abaya",
    description: "Traditional ladies robe",
    price: "12.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "ABA-001",
  },
  {
    name: "Shela",
    description: "Traditional scarf/shawl",
    price: "5.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "SHE-001",
  },
  {
    name: "Jalabiya",
    description: "Traditional loose dress",
    price: "10.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "JAL-001",
  },
  {
    name: "Niqab",
    description: "Face veil",
    price: "4.00",
    category: "Arabic Clothes",
    stockQuantity: 0,
    sku: "NIQ-001",
  },
  
  // Men's Clothes
  {
    name: "Shirt/Blouse",
    description: "Formal shirt or blouse",
    price: "4.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "SHI-001",
  },
  {
    name: "T-Shirt",
    description: "T-shirt wash or dry clean",
    price: "3.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "TSH-001",
  },
  {
    name: "Jeans Pant/Trouser",
    description: "Jeans or trousers",
    price: "4.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "JEA-001",
  },
  {
    name: "Track Pant",
    description: "Track pant wash or dry clean",
    price: "4.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "TRA-001",
  },
  {
    name: "Jacket",
    description: "Jacket",
    price: "8.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "JAC-001",
  },
  {
    name: "Sweater",
    description: "Sweater/pullover",
    price: "6.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "SWE-001",
  },
  {
    name: "Short",
    description: "Shorts",
    price: "3.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "SHO-001",
  },
  {
    name: "Suit/Coat",
    description: "Suit or coat wash or dry clean",
    price: "30.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "SUI-001",
  },
  {
    name: "Polo Shirt",
    description: "Polo shirt wash",
    price: "4.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "POL-001",
  },
  {
    name: "Hoodie",
    description: "Hooded sweatshirt",
    price: "7.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "HOO-001",
  },
  {
    name: "Formal Pants",
    description: "Formal dress pants",
    price: "5.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "FOR-001",
  },
  {
    name: "Wezar/Lungi",
    description: "Traditional wrap garment",
    price: "4.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "WEZ-001",
  },
  {
    name: "Fanela/Vest",
    description: "Undershirt/vest",
    price: "2.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "FAN-001",
  },
  {
    name: "Underwear",
    description: "Undergarment",
    price: "2.00",
    category: "Men's Clothes",
    stockQuantity: 0,
    sku: "UND-001",
  },
  
  // Ladies' Clothes
  {
    name: "Ladies Bras",
    description: "Ladies undergarment",
    price: "3.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "BRA-001",
  },
  {
    name: "Ladies Suit",
    description: "Ladies formal suit",
    price: "15.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "LAD-001",
  },
  {
    name: "Saree",
    description: "Traditional Indian garment",
    price: "45.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "SAR-001",
  },
  {
    name: "Salawar Qamees",
    description: "Traditional outfit",
    price: "8.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "SAL-001",
  },
  {
    name: "Ladies Pusthan",
    description: "Traditional ladies dress",
    price: "12.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "PUS-001",
  },
  {
    name: "Party Dress (Female)",
    description: "Ladies party dress",
    price: "30.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "PAR-001",
  },
  {
    name: "Skirt",
    description: "Ladies skirt",
    price: "5.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "SKI-001",
  },
  {
    name: "Blouse",
    description: "Ladies blouse",
    price: "4.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "BLO-001",
  },
  {
    name: "Evening Gown",
    description: "Formal evening dress",
    price: "50.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "EVE-001",
  },
  {
    name: "Kaftan",
    description: "Traditional loose dress",
    price: "15.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "KAF-001",
  },
  {
    name: "Lehenga",
    description: "Traditional Indian skirt outfit",
    price: "60.00",
    category: "Ladies' Clothes",
    stockQuantity: 0,
    sku: "LEH-001",
  },
  
  // Baby Clothes
  {
    name: "Baby T-Shirt",
    description: "Baby t-shirt wash",
    price: "2.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-001",
  },
  {
    name: "Baby Pant",
    description: "Baby pant wash",
    price: "2.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-002",
  },
  {
    name: "Baby Cloth",
    description: "Baby cloth wash",
    price: "2.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-003",
  },
  {
    name: "Baby Dress",
    description: "Baby dress wash",
    price: "3.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-004",
  },
  {
    name: "Baby Romper",
    description: "Baby one-piece outfit",
    price: "2.50",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-005",
  },
  {
    name: "Baby Blanket",
    description: "Baby blanket wash",
    price: "5.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-006",
  },
  {
    name: "Baby Jacket",
    description: "Baby jacket wash",
    price: "3.00",
    category: "Baby Clothes",
    stockQuantity: 0,
    sku: "BAB-007",
  },
  
  // Linens
  {
    name: "Pillow Cover",
    description: "Pillow case cover",
    price: "3.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "PIL-001",
  },
  {
    name: "Pillow",
    description: "Full pillow cleaning",
    price: "8.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "PIL-002",
  },
  {
    name: "Bed Sheet (Single)",
    description: "Single bed sheet",
    price: "6.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "BED-001",
  },
  {
    name: "Bed Sheet (Double)",
    description: "Double bed sheet",
    price: "8.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "BED-002",
  },
  {
    name: "Bed Sheet (King)",
    description: "King size bed sheet",
    price: "10.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "BED-003",
  },
  {
    name: "Duvet Cover",
    description: "Duvet/comforter cover",
    price: "12.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "DUV-001",
  },
  {
    name: "Towel (Small)",
    description: "Hand towel",
    price: "3.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "TOW-001",
  },
  {
    name: "Towel (Large)",
    description: "Bath towel",
    price: "5.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "TOW-002",
  },
  {
    name: "Blanket (Single)",
    description: "Single blanket",
    price: "20.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "BLA-001",
  },
  {
    name: "Blanket (Double)",
    description: "Double blanket",
    price: "30.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "BLA-002",
  },
  {
    name: "Comforter (Small)",
    description: "Small comforter/duvet",
    price: "30.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "COM-001",
  },
  {
    name: "Comforter (Large)",
    description: "Large comforter/duvet",
    price: "40.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "COM-002",
  },
  {
    name: "Table Cloth (Small)",
    description: "Small table cloth",
    price: "6.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "TAB-001",
  },
  {
    name: "Table Cloth (Large)",
    description: "Large table cloth",
    price: "10.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "TAB-002",
  },
  {
    name: "Curtain (per meter)",
    description: "Window curtains per meter",
    price: "8.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "CUR-001",
  },
  {
    name: "Mattress Cover",
    description: "Mattress protector cover",
    price: "15.00",
    category: "Linens",
    stockQuantity: 0,
    sku: "MAT-001",
  },
  
  // General Items
  {
    name: "Coveral",
    description: "Full body coverall",
    price: "10.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "COV-001",
  },
  {
    name: "Military Dress",
    description: "Military uniform",
    price: "15.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "MIL-001",
  },
  {
    name: "Party Dress (Male)",
    description: "Men's party dress",
    price: "30.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "PAR-002",
  },
  {
    name: "Socks (pair)",
    description: "Pair of socks",
    price: "2.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SOC-001",
  },
  {
    name: "Cap/Hat",
    description: "Head cap or hat",
    price: "3.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "CAP-001",
  },
  {
    name: "Tie",
    description: "Necktie",
    price: "4.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "TIE-001",
  },
  {
    name: "Scarf",
    description: "Fashion scarf",
    price: "5.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SCA-001",
  },
  {
    name: "Gloves (pair)",
    description: "Pair of gloves",
    price: "4.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "GLO-001",
  },
  {
    name: "Belt",
    description: "Leather belt cleaning",
    price: "5.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "BEL-001",
  },
  
  // General Items (Shoes, Carpets, etc.)
  {
    name: "Shoes (Regular)",
    description: "Regular shoe cleaning",
    price: "15.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SHO-001",
  },
  {
    name: "Shoes (Premium)",
    description: "Premium shoe cleaning & polish",
    price: "25.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SHO-002",
  },
  {
    name: "Sandals",
    description: "Sandal cleaning",
    price: "10.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SAN-001",
  },
  {
    name: "Boots",
    description: "Boot cleaning",
    price: "20.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "BOO-001",
  },
  {
    name: "Sneakers",
    description: "Sneaker cleaning",
    price: "18.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SNE-001",
  },
  {
    name: "Carpet (per SQ MTR)",
    description: "Carpet cleaning per square meter",
    price: "12.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "CAR-001",
    isSqmPriced: true,
    sqmPrice: "12.00",
  },
  {
    name: "Rug (Small)",
    description: "Small rug cleaning",
    price: "25.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "RUG-001",
  },
  {
    name: "Rug (Medium)",
    description: "Medium rug cleaning",
    price: "40.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "RUG-002",
  },
  {
    name: "Rug (Large)",
    description: "Large rug cleaning",
    price: "60.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "RUG-003",
  },
  {
    name: "Prayer Mat",
    description: "Prayer mat cleaning",
    price: "8.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "PRA-001",
  },
  {
    name: "Bag/Purse",
    description: "Bag or purse cleaning",
    price: "20.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "BAG-001",
  },
  {
    name: "Leather Jacket",
    description: "Leather jacket cleaning",
    price: "35.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "LEA-001",
  },
  {
    name: "Sofa Cover (per seat)",
    description: "Sofa cover per seat",
    price: "12.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "SOF-001",
  },
  {
    name: "Car Seat Cover",
    description: "Car seat cover cleaning",
    price: "15.00",
    category: "General Items",
    stockQuantity: 0,
    sku: "CAR-002",
  },
];

export async function seedDatabase() {
  console.log("Checking and seeding database...");

  // Always ensure all laundry items exist - delete old products and insert new ones
  const existingProducts = await storage.getProducts();

  // Only seed if no products exist at all
  if (existingProducts.length === 0) {
    console.log("Seeding products with UAE laundry items...");

    // Insert all laundry items with calculated prices
    for (const item of laundryItems) {
      const normalPrice = parseFloat(item.price);
      const itemWithPrices = {
        ...item,
        dryCleanPrice: (normalPrice * 1.5).toFixed(2),
        ironOnlyPrice: (normalPrice * 0.5).toFixed(2),
      };
      await storage.createProduct(itemWithPrices);
    }

    console.log(`Seeded ${laundryItems.length} laundry items successfully.`);
  } else {
    console.log(
      `Products already seeded: ${existingProducts.length} items found.`,
    );
  }
  // Normalize legacy phone numbers into international format, using UAE +971 by default
  await migratePhoneNumbers();
  
  // Fix delivered orders with missing deliveredByWorkerId
  await fixDeliveredOrdersWorkerId();
  
  // Consolidate categories (merge "Shoes, Carpets & More" and "Shop Items" into "General Items")
  await migrateCategories();

  // Fix carpet products: ensure sqm pricing flags are set correctly
  await migrateCarpetSqmPricing();

  // Uppercase all client names and addresses
  await migrateClientNamesToUppercase();
}

async function migrateCarpetSqmPricing() {
  try {
    const result = await db.execute(`
      UPDATE products 
      SET is_sqm_priced = true, 
          sqm_price = 12.00, 
          category = 'Shoes, Carpets & More'
      WHERE name ILIKE '%carpet%per sq%' 
        AND (is_sqm_priced = false OR is_sqm_priced IS NULL)
    `);
    console.log("Carpet sqm pricing migration completed");
  } catch (error) {
    console.error("Error migrating carpet sqm pricing:", error);
  }
}

async function migratePhoneNumbers() {
  try {
    let updatedClients = 0;
    let updatedBills = 0;
    const existingClients = await db.select({ id: clients.id, phone: clients.phone }).from(clients);
    for (const client of existingClients) {
      const currentPhone = String(client.phone || "").trim();
      if (!currentPhone || currentPhone === "0" || stripPhoneToDigits(currentPhone).length === 0) {
        continue;
      }

      const normalizedPhone = normalizePhoneForStorage(currentPhone);
      if (normalizedPhone && normalizedPhone !== currentPhone) {
        await db.update(clients).set({ phone: normalizedPhone }).where(eq(clients.id, client.id));
        updatedClients++;
      }
    }

    const existingBills = await db.select({ id: bills.id, customerPhone: bills.customerPhone }).from(bills);
    for (const bill of existingBills) {
      const currentPhone = String(bill.customerPhone || "").trim();
      if (!currentPhone || currentPhone === "0" || currentPhone === "-" || stripPhoneToDigits(currentPhone).length === 0) {
        continue;
      }

      const normalizedPhone = normalizePhoneForStorage(currentPhone);
      if (normalizedPhone && normalizedPhone !== currentPhone) {
        await db.update(bills).set({ customerPhone: normalizedPhone }).where(eq(bills.id, bill.id));
        updatedBills++;
      }
    }

    if (updatedClients > 0 || updatedBills > 0) {
      console.log(
        `Phone number migration completed (clients: ${updatedClients}, bills: ${updatedBills})`,
      );
    } else {
      console.log("Phone migration skipped or already normalized");
    }
  } catch (error) {
    console.log("Phone migration skipped or already normalized");
  }
}

async function fixDeliveredOrdersWorkerId() {
  try {
    // Get all users to create a name->id mapping
    const allUsers = await db.select().from(users);
    
    // Fix delivered orders where deliveredByWorkerId is null but deliveryBy has a name
    // Match by name or username
    for (const user of allUsers) {
      const nameToMatch = user.name || user.username;
      if (!nameToMatch) continue;
      
      // Update orders where deliveryBy matches this user's name but deliveredByWorkerId is null
      await db.execute(`
        UPDATE orders 
        SET delivered_by_worker_id = ${user.id}
        WHERE delivered = true 
          AND delivered_by_worker_id IS NULL 
          AND delivery_by IS NOT NULL
          AND (LOWER(delivery_by) = LOWER('${nameToMatch.replace(/'/g, "''")}') 
               OR LOWER(delivery_by) = LOWER('${(user.username || '').replace(/'/g, "''")}'))
      `);
    }
    
    // Also fix packing orders where packingWorkerId is null but packingBy has a name
    for (const user of allUsers) {
      const nameToMatch = user.name || user.username;
      if (!nameToMatch) continue;
      
      await db.execute(`
        UPDATE orders 
        SET packing_worker_id = ${user.id}
        WHERE packing_done = true 
          AND packing_worker_id IS NULL 
          AND packing_by IS NOT NULL
          AND (LOWER(packing_by) = LOWER('${nameToMatch.replace(/'/g, "''")}') 
               OR LOWER(packing_by) = LOWER('${(user.username || '').replace(/'/g, "''")}'))
      `);
    }
    
    // Fix tagged orders where tagWorkerId is null but tagBy has a name
    for (const user of allUsers) {
      const nameToMatch = user.name || user.username;
      if (!nameToMatch) continue;
      
      await db.execute(`
        UPDATE orders 
        SET tag_worker_id = ${user.id}
        WHERE tag_done = true 
          AND tag_worker_id IS NULL 
          AND tag_by IS NOT NULL
          AND (LOWER(tag_by) = LOWER('${nameToMatch.replace(/'/g, "''")}') 
               OR LOWER(tag_by) = LOWER('${(user.username || '').replace(/'/g, "''")}'))
      `);
    }
    
    // Fix entry orders where entryByWorkerId is null but entryBy has a name
    for (const user of allUsers) {
      const nameToMatch = user.name || user.username;
      if (!nameToMatch) continue;
      
      await db.execute(`
        UPDATE orders 
        SET entry_by_worker_id = ${user.id}
        WHERE entry_by_worker_id IS NULL 
          AND entry_by IS NOT NULL
          AND (LOWER(entry_by) = LOWER('${nameToMatch.replace(/'/g, "''")}') 
               OR LOWER(entry_by) = LOWER('${(user.username || '').replace(/'/g, "''")}'))
      `);
    }
    
    console.log("Fixed delivered/packed/tagged/entry orders with missing worker IDs");
  } catch (error) {
    console.log("Worker ID migration skipped or error:", error);
  }
}

async function migrateCategories() {
  try {
    // Migrate "Shoes, Carpets & More" and "Shop Items" to "General Items"
    const result = await db.execute(`
      UPDATE products 
      SET category = 'General Items'
      WHERE category = 'Shoes, Carpets & More' OR category = 'Shop Items'
    `);
    
    console.log("Category migration completed (consolidated into 6 categories)");
  } catch (error) {
    console.log("Category migration skipped or error:", error);
  }
}

async function migrateClientNamesToUppercase() {
  try {
    await db.execute(`
      UPDATE clients 
      SET name = UPPER(name)
      WHERE name IS NOT NULL AND name != UPPER(name)
    `);
    await db.execute(`
      UPDATE clients 
      SET address = UPPER(address)
      WHERE address IS NOT NULL AND address != UPPER(address)
    `);
    await db.execute(`
      UPDATE orders 
      SET customer_name = UPPER(customer_name)
      WHERE customer_name IS NOT NULL AND customer_name != UPPER(customer_name)
    `);
    await db.execute(`
      UPDATE orders 
      SET delivery_address = UPPER(delivery_address)
      WHERE delivery_address IS NOT NULL AND delivery_address != UPPER(delivery_address)
    `);
    console.log("Client names/addresses uppercase migration completed");
  } catch (error) {
    console.error("Error migrating client names to uppercase:", error);
  }
}
