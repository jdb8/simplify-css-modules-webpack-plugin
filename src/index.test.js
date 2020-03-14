/**
 * @jest-environment node
 */
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const webpack = require("webpack");
const rimraf = require("rimraf");
const merge = require("webpack-merge");

const SimplifyCssModulesPlugin = require("./");

const testingDir = path.join(__dirname, "..", "testing");
const testingConfig = require("../testing/webpack.config");

const cwd = process.cwd();

beforeEach(() => {
  process.chdir(testingDir);
});

afterEach(() => {
  process.chdir(cwd);
  rimraf.sync(path.join(testingDir, "dist"));
});

async function runTestingBuild(config = testingConfig) {
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) {
        console.error(err.stack || err);
        if (err.details) {
          console.error(err.details);
        }
        reject(err);
      }

      const info = stats.toJson();

      if (stats.hasErrors()) {
        console.error(info.errors);
        reject(info.errors);
      }

      if (stats.hasWarnings()) {
        console.warn(info.warnings);
      }

      resolve();
    });
  });
}

it("doesn't crash", async () => {
  await runTestingBuild();
});

it("prints out a class name", async () => {
  await runTestingBuild();
  const outputJS = fs.readFileSync(
    path.join(testingDir, "dist", "main.js"),
    "utf8"
  );
  const vmScript = new vm.Script(outputJS);
  const mockConsoleLog = jest.fn();
  const context = { console: { log: mockConsoleLog } };
  vmScript.runInNewContext(context);
  expect(mockConsoleLog).toHaveBeenCalledWith(expect.any(String));
});

it.each([true, false])(
  "removes unused references from CSS with noMangle = %s",
  async noMangle => {
    expect.assertions(2);
    const config = merge(testingConfig, {});
    config.plugins[0] = new SimplifyCssModulesPlugin({ noMangle });

    console.log({ config });

    await runTestingBuild(config);

    const outputJS = fs.readFileSync(
      path.join(testingDir, "dist", "main.js"),
      "utf8"
    );
    const outputCSS = fs.readFileSync(
      path.join(testingDir, "dist", "main.css"),
      "utf8"
    );

    console.log({ outputCSS, outputJS });

    expect(outputJS).not.toMatch("unused");
    expect(outputCSS).not.toMatch(/color:\s?red/);
  }
);
