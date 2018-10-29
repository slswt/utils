const glob = require('glob');
const fs = require('fs');
const { join, dirname } = require('path');

const getDeploymentSchema = ({
  terraformRoot = requiredParam('terraformRoot'),
}) => {
  const files = [
    ...glob
      .sync(join(terraformRoot, 'Live/**/stage/main.tf'))
      .map((fname) => dirname(fname)),
  ];
  const dependent = [];
  let schema = files.reduce((content, file) => {
    const depPath = join(dirname(file), 'stage/dependencies.json');
    const dependencies = JSON.parse(fs.readFileSync(depPath));
    if (dependencies.length > 0) {
      dependent.push(file);
      return content;
    }
    return `${content}\ncd ${file}\n\nterraform init\n\nterraform apply -auto-approve\n`;
  }, '');

  schema += '\n### HAS DEPENDENCIES ###\n';

  schema += dependent.reduce(
    (content, file) =>
      `${content}\ncd ${file}\n\nterraform init\nterraform apply -auto-approve\n`,
    ''
  );

  console.log(schema);
};
