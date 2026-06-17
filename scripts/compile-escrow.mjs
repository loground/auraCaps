import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const ROOT = process.cwd();
const CONTRACT_NAME = "AuraCapsWagerEscrow";
const CONTRACT_PATH = path.join(ROOT, "contracts", `${CONTRACT_NAME}.sol`);
const ARTIFACT_DIR = path.join(ROOT, "artifacts");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, `${CONTRACT_NAME}.json`);

function readImport(importPath) {
  const candidates = [
    path.join(ROOT, importPath),
    path.join(ROOT, "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `File not found: ${importPath}` };
}

const source = fs.readFileSync(CONTRACT_PATH, "utf8");
const input = {
  language: "Solidity",
  sources: {
    [`contracts/${CONTRACT_NAME}.sol`]: { content: source },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
const errors = output.errors || [];
const fatalErrors = errors.filter((entry) => entry.severity === "error");

for (const entry of errors) {
  const prefix = entry.severity === "error" ? "error" : "warning";
  console.error(`${prefix}: ${entry.formattedMessage || entry.message}`);
}

if (fatalErrors.length > 0) {
  process.exit(1);
}

const compiled = output.contracts?.[`contracts/${CONTRACT_NAME}.sol`]?.[CONTRACT_NAME];
if (!compiled?.abi || !compiled?.evm?.bytecode?.object) {
  throw new Error(`Could not find compiled ${CONTRACT_NAME} output.`);
}

const artifact = {
  contractName: CONTRACT_NAME,
  sourceName: `contracts/${CONTRACT_NAME}.sol`,
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  compiler: {
    version: solc.version(),
    optimizer: { enabled: true, runs: 200 },
  },
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled ${CONTRACT_NAME}`);
console.log(`Artifact: ${ARTIFACT_PATH}`);
