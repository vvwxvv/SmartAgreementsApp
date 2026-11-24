#!/usr/bin/env node
import { run } from "../src/cli/init.js";

run(process.argv.slice(2)).catch((e) => {
  console.error(`agreement: ${e.message}`);
  process.exit(1);
});
