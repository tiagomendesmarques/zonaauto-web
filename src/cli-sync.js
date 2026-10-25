// Sincronização manual: `npm run sync` (útil para testar a leitura do Standvirtual).
const { scrapeInventory } = require('./scraper');
const fs = require('fs');
const path = require('path');

scrapeInventory()
  .then(({ stand, cars }) => {
    const file = path.join(__dirname, '..', 'data', 'inventory.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date(), stand, cars }, null, 2));
    console.log(`Guardadas ${cars.length} viaturas em ${file}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
