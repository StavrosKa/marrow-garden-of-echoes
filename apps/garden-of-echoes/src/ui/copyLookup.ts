// Reads the text of a garden copy key (requirement 14.1). The keys are dotted paths of GARDEN_COPY, such as
// "whisper.select.blueDrop". A key that is missing is shown as the key itself, which the copy tests make impossible.
import { GARDEN_COPY } from '../copy/garden';

export function textOf(key: string): string {
  let node: unknown = GARDEN_COPY;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}
