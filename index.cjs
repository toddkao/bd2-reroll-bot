const { logWithStyle } = require('./components/log.cjs');
logWithStyle("Initialized Brown dust 2 reroll bot...", { bg: 'yellow', fg: 'black', bold: true });

const { waitForKeypress } = require('./components/keyboardListener.cjs');
const { pullForMe } = require("./components/find.cjs");
require('./components/initializeMissingDirectories.cjs');

(async () => {
  await pullForMe();
  await waitForKeypress();
})();
