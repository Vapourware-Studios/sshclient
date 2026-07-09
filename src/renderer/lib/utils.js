// cn() — tiny helper every shadcn/ui component uses.
// It merges Tailwind class strings and resolves conflicts
// (e.g. cn('p-2', 'p-4') → 'p-4', the later one wins).
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
