/* Serves the site through the emulated router on a fixed port, for looking at
 * it: node test/dev.mjs */
import { createServer } from './serve.mjs';
const port = Number(process.env.PORT ?? 4321);
createServer().listen(port, () => console.log('http://localhost:' + port));
