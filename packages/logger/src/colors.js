const LINE_REGEXP = /^.*$/gm;

function colorize(code, str) {
  return str.replace(LINE_REGEXP, line => (
    `\u001b[${code}m${line}\u001b[39m`
  ));
}

export default {
  red: str => colorize(31, str),
  yellow: str => colorize(33, str),
  blue: str => colorize(34, str),
  magenta: str => colorize(35, str)
};
