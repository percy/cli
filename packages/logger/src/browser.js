import { ANSI_COLORS, ANSI_REG } from './utils.js';
import PercyLogger from './logger.js';

export class PercyBrowserLogger extends PercyLogger {
  write(level, message) {
    let out = ['warn', 'error'].includes(level) ? level : 'log';
    let colors = [];

    message = message.replace(ANSI_REG, (_, ansi) => {
      colors.push(`color:${ANSI_COLORS[ansi] || 'inherit'}`);
      return '%c';
    });

    console[out](message, ...colors);
  }

  progress() {
    console.error('The log.progress() method is not supported in browsers');
  }
}

export default PercyBrowserLogger;
