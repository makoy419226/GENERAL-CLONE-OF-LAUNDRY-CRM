import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function insertOrders(ordersJson: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      INSERT INTO orders (id, client_id, order_number, items, total_amount, paid_amount, status, 
        entry_date, entry_by, washing_done, washing_date, washing_by, 
        packing_done, packing_date, packing_by, delivered, delivery_date, delivery_by, 
        delivery_type, urgent, discount_percent, discount_amount, final_amount, 
        payment_method, customer_name, tips, tag_done, tag_date, tag_by, 
        bill_id, stock_deducted, service_type)
      SELECT 
        (r->>'id')::int, (r->>'client_id')::int, r->>'order_number', r->>'items',
        (r->>'total_amount')::numeric, (r->>'paid_amount')::numeric, r->>'status',
        (r->>'entry_date')::timestamp, r->>'entry_by', (r->>'washing_done')::boolean,
        CASE WHEN r->>'washing_date' IS NOT NULL THEN (r->>'washing_date')::timestamp ELSE NULL END,
        r->>'washing_by', (r->>'packing_done')::boolean,
        CASE WHEN r->>'packing_date' IS NOT NULL THEN (r->>'packing_date')::timestamp ELSE NULL END,
        r->>'packing_by', (r->>'delivered')::boolean,
        CASE WHEN r->>'delivery_date' IS NOT NULL THEN (r->>'delivery_date')::timestamp ELSE NULL END,
        r->>'delivery_by', r->>'delivery_type', (r->>'urgent')::boolean,
        (r->>'discount_percent')::numeric, (r->>'discount_amount')::numeric,
        (r->>'final_amount')::numeric, r->>'payment_method', r->>'customer_name',
        (r->>'tips')::numeric, (r->>'tag_done')::boolean,
        CASE WHEN r->>'tag_date' IS NOT NULL THEN (r->>'tag_date')::timestamp ELSE NULL END,
        r->>'tag_by', (r->>'bill_id')::int, (r->>'stock_deducted')::boolean, r->>'service_type'
      FROM json_array_elements($1::json) AS r
      ON CONFLICT (id) DO NOTHING
    `, [ordersJson]);
    console.log(`Inserted ${result.rowCount} orders`);
  } finally {
    client.release();
  }
}

async function main() {
  const fs = await import('fs');
  const dataFile = process.argv[2] || 'scripts/orders-data.json';
  const data = fs.readFileSync(dataFile, 'utf-8');
  await insertOrders(data);
  
  const seqResult = await pool.query("SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders))");
  console.log('Sequence reset to:', seqResult.rows[0].setval);
  
  await pool.end();
}

main().catch(console.error);
