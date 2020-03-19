const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const postcss = require("postcss");
const purgecss = require("purgecss");
const incstr = require("incstr");
const { ReplaceSource } = require("webpack-sources");
const makeDir = require("make-dir");
const debug = require("debug")("simplify-css-modules-webpack-plugin");

const manglePlugin = require("./postcss/mangle");

const MAGIC_PREFIX = "__CSS_MODULE__";

const writeFilePromise = promisify(fs.writeFile);

function mangleAndTrackCSS(
  filePath,
  originalSourceValue,
  cssClasses,
  nextId,
  noMangle
) {
  // Processing a css file involves running the mangle-css-selectors
  // plugin and replacing the original file. Also pass in `cssSelectors`
  // to collect up the mapping
  //
  // TODO: find a more elegant way of dealing with state here? Not sure
  // if postcss plugins must behave nicely with regards to caching - if
  // so, this isn't correct. Store state as comments in css and remove?
  return postcss([
    manglePlugin({
      idGenerator: nextId,
      cssClasses,
      requiredPrefix: MAGIC_PREFIX,
      disable: noMangle
    })
  ]).process(originalSourceValue, { from: filePath, to: filePath }).css;
}

function replaceClassesInlineInJS(
  originalSourceValue,
  replaceSource,
  cssClasses
) {
  // Js processing involves taking the collected css mappings and just
  // performing a straight regex on the file. Given that css modules are
  // fairly unique and we advise prefixing them with the plugin's `magicPrefix`,
  // it should be fairly safe to do this without more sophisticated parsing etc.
  const seen = [];
  Object.entries(cssClasses).forEach(([oldClassName, newClassName]) => {
    const re = new RegExp(oldClassName, "g");
    let match;
    while ((match = re.exec(originalSourceValue)) !== null) {
      replaceSource.replace(
        match.index,
        match.index + match[0].length - 1,
        newClassName
      );
      seen.push(newClassName);
    }
  });

  return seen;
}

async function deleteUnusedClasses(purger, cssSource, seenClasses) {
  const originalSourceValue = cssSource.source();
  const replaceSource = new ReplaceSource(cssSource);
  const extractorResult = {
    attributes: {
      names: [],
      values: []
    },
    // Our seen classes don't include the magic prefix, which still exists
    // in our representation of the css source: ensure we prefix
    classes: seenClasses.map(name => `${MAGIC_PREFIX}${name}`),
    ids: [],
    tags: [],
    undetermined: []
  };
  const [result] = await purger.getPurgedCSS(
    [{ raw: originalSourceValue }],
    extractorResult
  );
  const transformedCss = result.css;
  debug({
    rejectedCount: result.rejected.length,
    seenClassesCount: seenClasses.length
  });
  replaceSource.replace(0, originalSourceValue.length - 1, transformedCss);
  return replaceSource;
}

function removeMagicPrefix(cssSource) {
  const originalSourceValue = cssSource.source();
  const replaceSource = new ReplaceSource(cssSource);
  const re = new RegExp(MAGIC_PREFIX, "g");
  let match;
  while ((match = re.exec(originalSourceValue)) !== null) {
    replaceSource.replace(match.index, match.index + match[0].length - 1, "");
  }
  return replaceSource;
}

async function handleOptimizeAssets(assets, compilation, cssClasses, options) {
  const { noMangle, noDelete } = options;
  const files = Object.keys(assets).filter(fileName => fileName !== "*");

  const filesByExt = { js: [], css: [] };
  files.forEach(file => {
    if (file.endsWith(".css")) {
      filesByExt.css.push(file);
    } else if (file.endsWith(".js")) {
      filesByExt.js.push(file);
    }
  });

  let seenClasses = [];
  [...filesByExt.css, ...filesByExt.js].forEach((file, index) => {
    const sourceObj = compilation.assets[file];
    const originalSourceValue = sourceObj.source();
    const replaceSource = new ReplaceSource(sourceObj);
    const filePath = path.resolve(compilation.outputOptions.path, file);

    if (file.endsWith(".css")) {
      const nextId = incstr.idGenerator({
        prefix: "y_",
        suffix: `_${index}`
      });
      // Replace the entire source
      replaceSource.replace(
        0,
        originalSourceValue.length - 1,
        mangleAndTrackCSS(
          filePath,
          originalSourceValue,
          cssClasses,
          nextId,
          noMangle
        )
      );
    } else {
      seenClasses = [
        ...seenClasses,
        ...replaceClassesInlineInJS(
          originalSourceValue,
          replaceSource,
          cssClasses
        )
      ];
    }

    compilation.assets[file] = replaceSource;
  });

  if (!noDelete) {
    const purger = new purgecss.PurgeCSS();

    purger.options.rejected = true;

    // Whitelist all non-module selectors: we're only deleting css module classes
    purger.options.whitelistPatterns = [new RegExp(`^(?!${MAGIC_PREFIX}.*).*`)];

    // Perform one final pass on the css files to remove any rules that we
    // saw weren't referenced at all in the chunk
    // TODO: merge this somehow with above logic to improve perf (is it slow?)
    const replacements = filesByExt.css.map(async file => {
      return deleteUnusedClasses(purger, compilation.assets[file], seenClasses)
        .then(removeMagicPrefix)
        .then(replaceSource => (compilation.assets[file] = replaceSource));
    });

    await Promise.all(replacements);
  }

  filesByExt.css.forEach(file => {
    const replaceSource = removeMagicPrefix(compilation.assets[file]);
    compilation.assets[file] = replaceSource;
  });

  return true;
}

class SimplifyCSSModulesPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    const { mappingFilePath } = this.options;

    // We're going to be mutating the contents of this object to keep
    // track of the css classname mappings
    // If we've been passed a mapping file, use the pre-existing mappings
    let cssClasses = {};
    if (mappingFilePath && fs.existsSync(mappingFilePath)) {
      console.log(
        `[SimplifyCSSModulesPlugin] Found existing classname mapping file at ${mappingFilePath} - reading from disk.`
      );
      cssClasses = JSON.parse(fs.readFileSync(mappingFilePath, "utf8"));
    }

    compiler.hooks.compilation.tap("SimplifyCSSModulesPlugin", compilation => {
      compilation.hooks.optimizeAssets.tapPromise(
        "SimplifyCSSModulesPlugin",
        assets =>
          handleOptimizeAssets(assets, compilation, cssClasses, this.options)
      );
    });

    if (mappingFilePath) {
      compiler.hooks.emit.tapPromise(
        "SimplifyCSSModulesPlugin",
        async compiler => {
          console.log(
            `[SimplifyCSSModulesPlugin] Writing css classname mappings to ${mappingFilePath}.`
          );
          const jsonClassNameMapping = JSON.stringify(cssClasses);
          await makeDir(path.dirname(mappingFilePath));
          return writeFilePromise(mappingFilePath, jsonClassNameMapping);
        }
      );
    }
  }
}

// TODO: consider making this dynamic at import or instantiation time
SimplifyCSSModulesPlugin.magicPrefix = MAGIC_PREFIX;

module.exports = SimplifyCSSModulesPlugin;
