/**
 * @jest-environment node
 */
const path = require("path");
const fs = require("fs");

const webpack = require("webpack");
const rimraf = require("rimraf");
const { JSDOM } = require("jsdom");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const generateConfig = require("../testing/generate-config");

const SimplifyCssModulesPlugin = require("./");

const testingDir = path.join(__dirname, "..", "testing");

const cwd = process.cwd();

beforeEach(() => {
  rimraf.sync(path.join(testingDir, "dist"));
  process.chdir(testingDir);
});

afterEach(() => {
  process.chdir(cwd);
  rimraf.sync(path.join(testingDir, "dist"));
});

async function runTestingBuild(config = generateConfig()) {
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) {
        console.error(err.stack || err);
        if (err.details) {
          console.error(err.details);
        }
        return reject(err);
      }

      const info = stats.toJson();

      if (stats.hasErrors()) {
        console.error(info.errors);
        return reject(info.errors);
      }

      if (stats.hasWarnings()) {
        console.warn(info.warnings);
      }

      return resolve(info);
    });
  });
}

it("generates a mapping file on disk if option supplied", async () => {
  expect.assertions(1);

  const config = generateConfig(
    new SimplifyCssModulesPlugin({
      mappingFilePath: path.join(testingDir, "dist", "mappings.json")
    })
  );

  await runTestingBuild(config);
  expect(
    JSON.parse(fs.readFileSync(path.join(testingDir, "dist", "mappings.json")))
  ).toBeTruthy();
});

it("reuses existing classname mappings from disk", async () => {
  expect.assertions(2);

  const config = generateConfig(
    new SimplifyCssModulesPlugin({
      mappingFilePath: path.join(testingDir, "dist", "mappings.json")
    })
  );

  fs.mkdirSync(path.join(testingDir, "dist"));
  fs.writeFileSync(
    path.join(testingDir, "dist", "mappings.json"),
    JSON.stringify({
      [`${SimplifyCssModulesPlugin.magicPrefix}used`]: "my-disk-hashed-classname"
    })
  );

  await runTestingBuild(config);
  const outputMainJS = fs.readFileSync(
    path.join(testingDir, "dist", "main.js"),
    "utf8"
  );
  const outputMainCss = fs.readFileSync(
    path.join(testingDir, "dist", "main.css"),
    "utf8"
  );
  expect(outputMainJS).toMatch("my-disk-hashed-classname");
  expect(outputMainCss).toMatch("my-disk-hashed-classname");
});

it("does not delete classes if prune = false", async () => {
  const config = generateConfig(
    new SimplifyCssModulesPlugin({ prune: false, mangle: false })
  );
  await runTestingBuild(config);
  const outputMainCss = fs.readFileSync(
    path.join(testingDir, "dist", "main.css"),
    "utf8"
  );
  expect(outputMainCss).toMatch("unused");
});

it("generates a new contenthash for changed files", async () => {
  const noPluginConfig = generateConfig(() => {});
  const pluginConfig = generateConfig();

  [pluginConfig, noPluginConfig].forEach(config => {
    config.output = {
      filename: "[name].[contenthash].js",
      chunkFilename: "[name].[contenthash].chunk.js"
    };
    config.plugins = config.plugins.map(plugin => {
      if (plugin.constructor.name !== "MiniCssExtractPlugin") {
        return plugin;
      }

      return new MiniCssExtractPlugin({
        filename: "[name].[contenthash].css",
        chunkFilename: "[name].[contenthash].chunk.css"
      });
    });
  });

  const noPluginStats = await runTestingBuild(noPluginConfig);
  const pluginStats = await runTestingBuild(pluginConfig);

  pluginStats.assetsByChunkName.main.forEach(fileName => {
    expect(noPluginStats.assetsByChunkName.main).not.toContain(fileName);
  });

  pluginStats.assetsByChunkName.foo.forEach(fileName => {
    expect(noPluginStats.assetsByChunkName.foo).not.toContain(fileName);
  });
});

it("does not match classes over-eagerly", async () => {
  const config = generateConfig(
    new SimplifyCssModulesPlugin({ mangle: false })
  );
  await runTestingBuild(config);
  const outputMainJs = fs.readFileSync(
    path.join(testingDir, "dist", "main.js"),
    "utf8"
  );

  // We should not get confused between 'someClass' and 'someClassWithASharedPrefix'
  expect(outputMainJs).toContain('"_someClassWithASharedPrefix"');
  expect(outputMainJs).toContain('"_someClass"');
});

it("ignores emitted binary assets from file-loader", async () => {
  // The build shouldn't blow up if we see a file-loader emitted asset, even if
  // it's js - only process files that are part of the actual chunk
  const config = generateConfig();
  config.module.rules.push({
    test: /vendor.js$/,
    use: [
      {
        loader: "file-loader"
      }
    ]
  });

  await runTestingBuild(config);
});

describe.each([true, false])("with mangle = %s", mangle => {
  let outputMainJs, outputMainCss, outputFooJs, outputFooCss;
  let allFiles;

  beforeEach(async () => {
    const config = generateConfig(new SimplifyCssModulesPlugin({ mangle }));
    await runTestingBuild(config);
    outputMainJs = fs.readFileSync(
      path.join(testingDir, "dist", "main.js"),
      "utf8"
    );
    outputFooJs = fs.readFileSync(
      path.join(testingDir, "dist", "foo.js"),
      "utf8"
    );
    outputMainCss = fs.readFileSync(
      path.join(testingDir, "dist", "main.css"),
      "utf8"
    );
    outputFooCss = fs.readFileSync(
      path.join(testingDir, "dist", "foo.css"),
      "utf8"
    );
    allFiles = [outputMainJs, outputMainCss, outputFooJs, outputFooCss];
  });

  it("prints out class names", () => {
    const mockConsoleLog = jest.fn();
    const { window } = new JSDOM("", {
      runScripts: "dangerously"
    });
    window.alert = () => {};
    window.console.log = mockConsoleLog;
    window.eval(outputMainJs);

    expect(mockConsoleLog).toHaveBeenCalledTimes(2);
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.any(String));
    expect(mockConsoleLog).not.toHaveBeenCalledWith(undefined);
    expect(mockConsoleLog).not.toHaveBeenCalledWith(null);
  });

  it("removes unused references from CSS", () => {
    expect(outputMainJs).not.toMatch("unused");
    expect(outputMainCss).not.toMatch(/color:\s?red/);
    expect(outputFooJs).not.toMatch("hi-there-not-used");
    expect(outputFooCss).not.toMatch(/color:\s?purple/);
  });

  it("removes all magic prefixes", () => {
    // Sanity check that we haven't left anything behind
    allFiles.forEach(file =>
      expect(file).not.toMatch(SimplifyCssModulesPlugin.magicPrefix)
    );
  });

  it("preserves non-module selectors", () => {
    expect(outputMainCss).toMatch(".global");
    expect(outputMainCss).toMatch("#cool-id");
  });
});
