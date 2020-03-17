/**
 * @jest-environment node
 */
const path = require("path");
const fs = require("fs");

const webpack = require("webpack");
const rimraf = require("rimraf");
const { JSDOM } = require("jsdom");

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

      return resolve();
    });
  });
}

it("doesn't crash", async () => {
  await runTestingBuild();
});

it("prints out class names", async () => {
  expect.assertions(4);

  await runTestingBuild();
  const outputJS = fs.readFileSync(
    path.join(testingDir, "dist", "main.js"),
    "utf8"
  );
  const mockConsoleLog = jest.fn();
  const { window } = new JSDOM("", {
    runScripts: "dangerously"
  });
  window.console.log = mockConsoleLog;
  window.eval(outputJS);
  expect(mockConsoleLog).toHaveBeenCalledTimes(1);
  expect(mockConsoleLog).toHaveBeenCalledWith(expect.any(String));
  expect(mockConsoleLog).not.toHaveBeenCalledWith(undefined);
  expect(mockConsoleLog).not.toHaveBeenCalledWith(null);
});

it("reuses existing classname mappings from disk", async () => {
  const config = generateConfig(
    new SimplifyCssModulesPlugin({
      mappingFileName: "mappings.json"
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

it.each([true, false])(
  "removes unused references from CSS with noMangle = %s",
  async noMangle => {
    expect.assertions(4);

    const config = generateConfig(new SimplifyCssModulesPlugin({ noMangle }));

    await runTestingBuild(config);

    const outputMainJs = fs.readFileSync(
      path.join(testingDir, "dist", "main.js"),
      "utf8"
    );
    const outputChunkJs = fs.readFileSync(
      path.join(testingDir, "dist", "foo.js"),
      "utf8"
    );
    const outputMainCss = fs.readFileSync(
      path.join(testingDir, "dist", "main.css"),
      "utf8"
    );
    const outputChunkCss = fs.readFileSync(
      path.join(testingDir, "dist", "foo.css"),
      "utf8"
    );

    expect(outputMainJs).not.toMatch("unused");
    expect(outputMainCss).not.toMatch(/color:\s?red/);
    expect(outputChunkJs).not.toMatch("hi-there-not-used");
    expect(outputChunkCss).not.toMatch(/color:\s?purple/);
  }
);
