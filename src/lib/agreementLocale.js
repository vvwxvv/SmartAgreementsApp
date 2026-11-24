/** Same rule as HuJiemingApp: a record carries `language`; `*En` holds the
 *  English copy; reading falls back to the base field. */
export function localized(record, key, lang) {
  if (!record) return "";
  const useEn = (lang || record.language || record.lang) === "en";
  return (useEn ? record[`${key}En`] : record[key]) || record[key] || "";
}
