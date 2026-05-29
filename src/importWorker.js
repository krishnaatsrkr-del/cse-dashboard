const { parentPort, workerData } = require("worker_threads");

const { importResultsWorkbook } = require("./ingestion");

if (!parentPort) {
  throw new Error("Import worker requires a parent port");
}

(async () => {
  try {
    const payload = await importResultsWorkbook(workerData.filePath);
    parentPort.postMessage({ ok: true, payload });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        message: error?.message || String(error),
        code: error?.code || null,
      },
    });
  }
})();
