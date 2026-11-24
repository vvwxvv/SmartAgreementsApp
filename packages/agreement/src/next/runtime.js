import { createAgreementService } from "../core/service.js";
import { createPdfRenderer, findChromium } from "../core/pdf.js";

const runtimes = new WeakMap();

/** One service instance per config object — never a module-level singleton. */
export function runtimeFor(config) {
  let rt = runtimes.get(config);
  if (rt) return rt;

  const storage = async () => {
    const adapter = typeof config.storage === "function" ? await config.storage() : config.storage;
    if (!adapter) throw new Error("agreement config: storage() returned nothing");
    return adapter;
  };

  const service = createAgreementService({
    storage,
    baseUrl: config.baseUrl,
    secrets: config.secrets,
    tsa: config.tsa,
  });

  const pdf =
    config.pdf ||
    createPdfRenderer({
      baseUrl: (req) => (typeof config.baseUrl === "function" ? config.baseUrl(req) : config.baseUrl),
      printKey: service.printKey,
      chromium: config.chromium || findChromium,
    });

  rt = { service, pdf };
  runtimes.set(config, rt);
  return rt;
}
