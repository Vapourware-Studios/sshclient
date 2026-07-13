const TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

export function toneForId(id) {
  const str = String(id ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return TONES[Math.abs(hash) % TONES.length];
}

export function toneStyle(tone) {
  const background = tone.startsWith('#') ? tone : `var(--${tone})`;
  return {
    backgroundColor: background,
    color: '#fff',
  };
}
