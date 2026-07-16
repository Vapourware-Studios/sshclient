export function isIpAddress(value) {
  if (!value) return false;
  const v = value.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return true;
  return v.includes(':') && /^[0-9a-fA-F:]+$/.test(v);
}
