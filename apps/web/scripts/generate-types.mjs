import { resolve } from "node:path";

import { compileFromFile } from "json-schema-to-typescript";
import { mkdir, writeFile } from "node:fs/promises";

const schemaPath = resolve("../../contracts/generated/news_graph.schema.json");
const outputPath = resolve("src/generated/newsTraceContracts.ts");

const output = await compileFromFile(schemaPath, {
  additionalProperties: false,
  bannerComment: [
    "/* eslint-disable */",
    "/*",
    " * Generated from contracts/generated/news_graph.schema.json.",
    " * Do not edit by hand: run `npm run generate:types` from apps/web.",
    " */",
  ].join("\n"),
  declareExternallyReferenced: true,
  enableConstEnums: false,
  format: true,
  style: { singleQuote: true },
});

await mkdir(resolve("src/generated"), { recursive: true });
await writeFile(outputPath, output, "utf8");
console.log(`wrote ${outputPath}`);
