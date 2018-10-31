const fs = require('fs');
module.exports = (path, json) => {
  fs.writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
};
