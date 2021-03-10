import { ANSI_COLORS, ANSI_REG } from './colors';
import PercyLogger from './logger';

export default class BrowserLogger extends PercyLogger {
  write(level, message) {
    let out = ['warn', 'error'].includes(level) ? level : 'log';
    let colors = [];

    message = message.replace(ANSI_REG, (_, ansi) => {
      colors.push(`color:${ANSI_COLORS[ansi] || 'inherit'}`);
      return '%c';
    });

    console[out](message, ...colors);
  }
}
