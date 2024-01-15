// Error
function throwError() {
  throw new Error('Some error');
}
const args = process.argv.slice(2); // Extract command-line arguments, excluding the first two (node and script path)

if (args.length > 0 && args[0].toLowerCase() === 'error') {
  throwError();
}
