const logWithStyle = (message, { fg = '', bg = '', bold = false } = {}) => {
  const styles = [];

  if (bold) styles.push('\x1b[1m');
  if (fg) styles.push(colorCodes.fg[fg.toLowerCase()] || '');
  if (bg) styles.push(colorCodes.bg[bg.toLowerCase()] || '');

  const reset = '\x1b[0m';
  console.log(`${styles.join('')}${message}${reset}`);
}

const colorCodes = {
  fg: {
    black: '\x1b[38;5;232m', // darker "true black"
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
  },
  bg: {
    black: '\x1b[48;5;232m', // darker black background
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m'
  }
};

module.exports = { logWithStyle };