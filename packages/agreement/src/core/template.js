/**
 * Deterministic contract-template compilation (P2-2a-1).
 * Pure: no I/O, no clock, no randomness.
 *
 * Variables: {{partyA.name}}, {{partyB.email}}, ... for
 * name, nameEn, contactPerson, legalRepresentative, email, phone, address,
 * addressEn.
 *
 * Values are escaped for a Markdown context before insertion, so a contact
 * named "A *B* <C>" cannot inject emphasis or HTML into the contract.
 */

const VAR = /\{\{\s*(party[AB])\.(name|nameEn|contactPerson|legalRepresentative|email|phone|address|addressEn)\s*\}\}/g;

export function escapeTemplateValue(value) {
  return String(value == null ? "" : value)
    .replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1");
}

export function compileTemplate(template, parties = {}) {
  const missing = [];
  const used = [];
  const body = String(template == null ? "" : template).replace(VAR, (match, party, field) => {
    const key = party + "." + field;
    used.push(key);
    const value = parties && parties[party] ? parties[party][field] : undefined;
    if (value == null || String(value).trim() === "") {
      missing.push(key);
      return match;
    }
    return escapeTemplateValue(value);
  });
  const leftover = [];
  const re = /\{\{[^}]*\}\}/g;
  let m;
  while ((m = re.exec(body))) leftover.push(m[0]);
  return {
    body,
    missing: [...new Set(missing)],
    used: [...new Set(used)],
    leftover: [...new Set(leftover)],
  };
}

export function hasUnfilledVariables(text) {
  return /\{\{[^}]*\}\}/.test(String(text == null ? "" : text));
}
