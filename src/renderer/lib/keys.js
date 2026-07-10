export const KEY_TYPE_OPTIONS = [
  { type: 'ed25519', label: 'ED25519', bits: [], defaultBits: null },
  { type: 'ecdsa', label: 'ECDSA', bits: [256, 384, 521], defaultBits: 256 },
  { type: 'rsa', label: 'RSA', bits: [2048, 3072, 4096], defaultBits: 3072 },
];

export function keyTypeLabel(key) {
  const option = KEY_TYPE_OPTIONS.find((o) => o.type === key.type);
  const label = option?.label ?? key.type;
  return key.bits ? `${label}-${key.bits}` : label;
}
