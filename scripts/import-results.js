const { importResultsWorkbook } = require("../src/ingestion");
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/import-results.js <excel-file-path>");
    process.exit(1);
  }

  try {
    const result = await importResultsWorkbook(filePath);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
  }
}

main();
