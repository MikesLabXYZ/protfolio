require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  await db.init();

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const client = await db.getPool().connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }
    console.log('Migrations complete.');
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
