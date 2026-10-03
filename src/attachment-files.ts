import { AvAError } from './types.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_NAME = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|toml|ini|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|ps1|sql|log|diff|patch|cfg|conf)$/i;
export function attachmentKind(name: string, mediaType: string, data: Buffer): 'image' | 'text' {
  if (IMAGE_TYPES.has(mediaType)) {
    if (data.length > 8 * 1024 * 1024) throw new AvAError('FILE_TOO_LARGE', `${name} is larger than 8 MB.`);
    return 'image';
  }
  if (mediaType.startsWith('text/') || /^application\/(json|xml|javascript|x-yaml|yaml|toml|x-sh)$/.test(mediaType) || TEXT_NAME.test(name)) {
    if (data.length > 512 * 1024) throw new AvAError('FILE_TOO_LARGE', `${name} is larger than 512 KB. Text files are inlined into the prompt, so keep them small.`);
    if (data.includes(0)) throw new AvAError('UNSUPPORTED_FILE', `${name} isn't a text file.`);
    return 'text';
  }
  throw new AvAError('UNSUPPORTED_FILE', `${name}: attach images (PNG, JPEG, GIF, WebP) or text files. Other files can't be sent to the agents.`);
}
