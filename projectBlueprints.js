const glob = require('glob');
const fs = require('fs-extra');
const { join, parse, dirname } = require('path');
const get = require('lodash/get');
const identity = require('lodash/identity');
const requiredParam = require('./requiredParam');

const projectBlueprints = ({
  terraformRoot = requiredParam('terraformRoot'),
  stateBucket = requiredParam('stateBucket'),
  stateBucketRegion = requiredParam('stateBucketRegion'),
  role = requiredParam('role'),
}) => {
  const blueprintRootDir = join(terraformRoot, 'Blueprints');
  const liveRootDir = join(terraformRoot, 'Live');
  const environmentsRootDir = join(terraformRoot, 'Environments');

  const envs = ['stage', 'prod'];

  const getOutputs = (str) => {
    const matches = [];
    const re = /^output\s"(\w+)".*$/gm;
    let res = re.exec(str);
    while (res !== null) {
      matches.push(get(res, 1, null));
      res = re.exec(str);
    }
    return matches.filter(identity);
  };

  const getDependencies = ({ env, content }) => {
    const dependencies = [];
    const re = /^data\s"terraform_remote_state".*\{\n((?:.*?|\n)*?)key\s*=\s*"(.+)"\n/gim;
    let res = re.exec(content);
    while (res !== null) {
      dependencies.push(
        get(res, 2, '').replace(/\$\{var\.environment\}/g, env)
      );
      res = re.exec(content);
    }
    return dependencies.filter(identity);
  };

  const makeTfModule = ({ key, env, moduleName, moduleRoot }) => `

terraform {
  required_version = "> 0.11.0"

  backend "s3" {
    bucket  = "${stateBucket}"
    key     = "${key}"
    region  = "${stateBucketRegion}"
    encrypt = true
  }
}

provider "aws" {
  region = "${stateBucketRegion}"

  assume_role {
    role_arn = "${role}"
  }
}

module "${moduleName}" {
  source = "${moduleRoot}"
  ${env ? `environment = "${env}"` : ''}
}

`;

  const makeOutputs = ({ outputs, moduleName }) =>
    outputs.reduce(
      (current, output) => `
${current}
output "${output}" {
  value = "\${module.${moduleName}.${output}}"
}
`,
      ''
    );

  const getLocations = (file, root) => {
    const moduleRoot = dirname(file);
    const moduleName = parse(moduleRoot).name;

    const liveFolder = join(liveRootDir, moduleRoot.replace(root, ''));

    const keyBase = liveFolder.replace(terraformRoot, '');

    return {
      keyBase,
      moduleName,
      liveFolder,
      moduleRoot,
    };
  };

  glob.sync(join(blueprintRootDir, '**/main.tf')).forEach((file) => {
    const { keyBase, moduleName, liveFolder, moduleRoot } = getLocations(
      file,
      blueprintRootDir
    );
    const tfFiles = glob.sync(join(parse(file).dir, '*.tf'));
    const tfFilesContent = tfFiles.reduce(
      (content, tfFilePath) => `${content}\n${fs.readFileSync(tfFilePath)}`,
      ''
    );
    const outputs = getOutputs(tfFilesContent);
    envs.forEach((env) => {
      const targetFolder = join(liveFolder, env);
      const key = join(keyBase, env, 'terraform.tfstate').replace(/^\//, '');
      let content = makeTfModule({
        env,
        moduleName,
        moduleRoot,
        key,
      });
      content += makeOutputs({ outputs, moduleName });
      const deps = getDependencies({ env, content: tfFilesContent });
      fs.ensureDirSync(targetFolder);
      fs.writeFileSync(join(targetFolder, 'main.tf'), content);
      fs.writeFileSync(
        join(targetFolder, 'dependencies.json'),
        JSON.stringify(deps, null, 2)
      );
    });
  });

  glob.sync(join(environmentsRootDir, '**/main.tf')).forEach((file) => {
    const env = parse(dirname(file)).name;
    const { keyBase, moduleName, liveFolder, moduleRoot } = getLocations(
      join(dirname(file), '../main.tf'),
      environmentsRootDir
    );
    const tfFiles = glob.sync(join(parse(file).dir, '*.tf'));
    const tfFilesContent = tfFiles.reduce(
      (content, tfFilePath) => `${content}\n${fs.readFileSync(tfFilePath)}`,
      ''
    );
    const outputs = getOutputs(tfFilesContent);
    const targetFolder = join(liveFolder, env);
    const key = join(keyBase, env, 'terraform.tfstate').replace(/^\//, '');
    let content = makeTfModule({
      moduleName,
      moduleRoot: join(moduleRoot, env),
      key,
    });
    content += makeOutputs({ outputs, moduleName });
    const deps = getDependencies({ env, content: tfFilesContent });
    fs.ensureDirSync(targetFolder);
    fs.writeFileSync(join(targetFolder, 'main.tf'), content);
    fs.writeFileSync(
      join(targetFolder, 'dependencies.json'),
      JSON.stringify(deps, null, 2)
    );
  });
};

module.exports = projectBlueprints;
