const { assign, entries } = Object;

export const ANSI_REG = new RegExp((
  '[\\u001B\\u009B][[\\]()#;?]*((?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)' +
  '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
), 'g');

export const ANSI_COLORS = {
  '31m': 'red',
  '33m': 'yellow',
  '34m': 'blue',
  '35m': 'magenta',
  '90m': 'grey'
};

const LINE_REG = /^.*$/gm;

function colorize(code, str) {
  return str.replace(LINE_REG, line => (
    `\u001b[${code}${line}\u001b[39m`
  ));
}

export default entries(ANSI_COLORS)
  .reduce((colors, [code, name]) => {
    return assign(colors, {
      [name]: colorize.bind(null, code)
    });
  }, {});
