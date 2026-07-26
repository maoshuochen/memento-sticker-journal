import { cp, mkdir, rm } from 'node:fs/promises';

const output = new URL('../public/', import.meta.url);
const sitesOutput = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await rm(sitesOutput, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(new URL('./server/', sitesOutput), { recursive: true });
await cp(new URL('../index.html', import.meta.url), new URL('./index.html', output));
await cp(new URL('../styles.css', import.meta.url), new URL('./styles.css', output));
await cp(new URL('../app.js', import.meta.url), new URL('./app.js', output));
await cp(new URL('../assets/', import.meta.url), new URL('./assets/', output), { recursive: true });
await cp(new URL('../assets/og.png', import.meta.url), new URL('./og.png', output));
await cp(output, new URL('./client/', sitesOutput), { recursive: true });
await cp(new URL('../worker/index.js', import.meta.url), new URL('./server/index.js', sitesOutput));
