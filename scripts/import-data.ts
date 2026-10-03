// Copy existing AvA history into the shared data folder, on request only.
// Usage: node --import tsx scripts/import-data.ts --from <old data dir> [--to <new data dir>]
// --to defaults to the folder every plugin uses (package.json config.dataDir). The source is never modified.
import {resolve} from 'node:path';
import {importData} from '../src/data-import.js';
import {installedDataRoot} from '../src/paths.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const from=option('--from');if(!from)throw new Error('Pass --from <old data dir>, for example .ava-data.');
const to=option('--to')??installedDataRoot(resolve('.'));
console.log(JSON.stringify(await importData(resolve(from),resolve(to)),null,2));
