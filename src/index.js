const postcss = require("postcss");
const purgecss = require("purgecss");
const incstr = require("incstr");
const { ReplaceSource } = require("webpack-sources");

const manglePlugin = require("./postcss/mangle");

const MAGIC_PREFIX = "__CSS_MODULE__";

function mangleAndTrackCSS(originalSourceValue, cssClasses, nextId, noMangle) {
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
  ]).process(originalSourceValue).css;
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
    classes: seenClasses,
    ids: [],
    tags: [],
    undetermined: []
  };
  const [result] = await purger.getPurgedCSS(
    [{ raw: originalSourceValue }],
    extractorResult
  );
  const transformedCss = result.css;
  replaceSource.replace(0, originalSourceValue.length - 1, transformedCss);
  return replaceSource;
}

async function handleOptimizeAssets(assets, compilation, options) {
  const { noMangle, noDelete } = options;
  const files = Object.keys(assets).filter(fileName => fileName !== "*");
  const nextId = incstr.idGenerator({
    prefix: "y_"
  });
  const filesByExt = { js: [], css: [] };
  files.forEach(file => {
    if (file.endsWith(".css")) {
      filesByExt.css.push(file);
    } else if (file.endsWith(".js")) {
      filesByExt.js.push(file);
    }
  });

  // We only care if there's css files to be analysed
  if (!filesByExt.css.length) {
    return;
  }

  // We're going to be mutating the contents of this object to keep
  // track of the css classname mappings
  const cssClasses = {};

  let seenClasses = [];
  [...filesByExt.css, ...filesByExt.js].forEach(file => {
    const originalSourceValue = compilation.assets[file].source();
    const replaceSource = new ReplaceSource(compilation.assets[file]);

    if (file.endsWith(".css")) {
      // Replace the entire source
      replaceSource.replace(
        0,
        originalSourceValue.length - 1,
        mangleAndTrackCSS(originalSourceValue, cssClasses, nextId, noMangle)
      );
    } else {
      seenClasses = replaceClassesInlineInJS(
        originalSourceValue,
        replaceSource,
        cssClasses
      );
    }

    compilation.assets[file] = replaceSource;
  });

  if (!noDelete) {
    const purger = new purgecss.PurgeCSS();

    // Perform one final pass on the css files to remove any rules that we
    // saw weren't referenced at all in the chunk
    // TODO: merge this somehow with above logic to improve perf (is it slow?)
    const replacements = filesByExt.css.map(async file => {
      return deleteUnusedClasses(
        purger,
        compilation.assets[file],
        seenClasses
      ).then(replaceSource => (compilation.assets[file] = replaceSource));
    });

    return Promise.all(replacements);
  }
}

class SimplifyCSSModulesPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    compiler.hooks.compilation.tap("SimplifyCSSModulesPlugin", compilation => {
      compilation.hooks.optimizeAssets.tapPromise(
        "SimplifyCSSModulesPlugin",
        assets => handleOptimizeAssets(assets, compilation, this.options)
      );
    });
  }
}

// TODO: consider making this dynamic at import or instantiation time
SimplifyCSSModulesPlugin.magicPrefix = MAGIC_PREFIX;

module.exports = SimplifyCSSModulesPlugin;
