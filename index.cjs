const { waitForKeypress } = require('./components/keyboardListener.cjs');
const { pullForMe } = require("./components/find.cjs");
require('./components/initializeMissingDirectories.cjs');

(async () => {
  await pullForMe();
  await waitForKeypress();
})();
