let input = "";
for await (const chunk of process.stdin) input += chunk;

let sbom;
try {
  sbom = JSON.parse(input);
} catch {
  console.error("CycloneDX SBOM was not valid JSON.");
  process.exit(1);
}

const components = Array.isArray(sbom.components) ? sbom.components : [];
const dependencies = Array.isArray(sbom.dependencies) ? sbom.dependencies : [];
const root = sbom.metadata?.component;
const errors = [];

if (sbom.bomFormat !== "CycloneDX") errors.push("bomFormat must be CycloneDX");
if (sbom.specVersion !== "1.5") errors.push("specVersion must be 1.5");
if (root?.purl !== "pkg:npm/openrct2-classroom-web@0.1.0") errors.push("root component is missing or incorrect");
if (!root?.licenses?.some(({ license }) => license?.id === "GPL-3.0-or-later")) {
  errors.push("root GPL-3.0-or-later license is missing");
}
if (!components.some((component) => component.name === "jszip" && component.version === "3.10.1")) {
  errors.push("pinned production dependency jszip@3.10.1 is missing");
}
if (components.length < 1 || dependencies.length < 1) errors.push("component/dependency graph is empty");
if (components.some((component) => !component["bom-ref"])) errors.push("one or more components lack bom-ref identifiers");

if (errors.length > 0) {
  console.error("SBOM validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated CycloneDX ${sbom.specVersion} SBOM with ${components.length} components and ${dependencies.length} dependency nodes.`);
