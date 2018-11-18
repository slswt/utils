const md5 = (what) =>
  crypto
    .createHash('md5')
    .update(what)
    .digest('hex');
module.exports = md5;
