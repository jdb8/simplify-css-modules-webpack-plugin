const postcss = require("postcss");
const incstr = require("incstr");
const { ReplaceSource } = require("webpack-sources");

const deleteCssRulesPlugin = require("./postcss/deleteRules");
const manglePlugin = require("./postcss/mangle");

const MAGIC_PREFIX = "__CSS_MODULE__";

const handleAfterOptimizeChunkAssets = (chunks, compilation) => {
  chunks.forEach(chunk => {
    const nextId = incstr.idGenerator({ prefix: "y_", suffix: `_${chunk.id}` });

    const chunksByExt = { js: [], css: [] };
    chunk.files.forEach(file => {
      if (file.endsWith(".css")) {
        chunksByExt.css.push(file);
      } else if (file.endsWith(".js")) {
        chunksByExt.js.push(file);
      }
    });

    // We only care if there's css files to be analysed
    if (!chunksByExt.css.length) {
      return;
    }

    // As we replace the classnames, keep track of any classes we see
    // that can be considered "dead", i.e. no js files reference them
    const deadCssClasses = new Set();
    [...chunksByExt.css, ...chunksByExt.js].forEach(file => {
      const originalSourceValue = compilation.assets[file].source();
      const replaceSource = new ReplaceSource(compilation.assets[file]);

      // We're going to be mutating the contents of this object to keep
      // track of the css classname mappings
      const cssClasses = {};

      if (file.endsWith(".css")) {
        // Processing a css file involves running the mangle-css-selectors
        // plugin and replacing the original file. Also pass in `cssSelectors`
        // to collect up the mapping
        //
        // TODO: find a more elegant way of dealing with state here? Not sure
        // if postcss plugins must behave nicely with regards to caching - if
        // so, this isn't correct. Store state as comments in css and remove?
        const transformedCss = postcss([
          manglePlugin({
            idGenerator: nextId,
            cssClasses,
            requiredPrefix: MAGIC_PREFIX
          })
        ]).process(originalSourceValue).css;

        // Replace the entire source
        replaceSource.replace(
          0,
          originalSourceValue.length - 1,
          transformedCss
        );
      } else {
        // Js processing involves taking the collected css mappings and just
        // performing a straight regex on the file. Given that css modules are
        // fairly unique and we advise prefixing them with the plugin's `magicPrefix`,
        // it should be fairly safe to do this without more sophisticated parsing etc.
        Object.entries(cssClasses).forEach(([oldClassName, newClassName]) => {
          let replaced = false;
          const re = new RegExp(oldClassName, "g");
          let match;
          while ((match = re.exec(originalSourceValue)) !== null) {
            replaceSource.replace(
              match.index,
              match.index + match[0].length - 1,
              newClassName
            );
            replaced = true;
          }

          if (!replaced) {
            // If we didn't spot the classname anywhere in the chunk's js, mark it as dead
            deadCssClasses.add("." + newClassName);
          }
        });
      }

      compilation.assets[file] = replaceSource;
    });

    // Perform one final pass on the css files to remove any rules that we
    // saw weren't referenced at all in the chunk
    // TODO: merge this somehow with above logic to improve perf (is it slow?)
    chunksByExt.css.forEach(file => {
      const originalSourceValue = compilation.assets[file].source();
      const replaceSource = new ReplaceSource(compilation.assets[file]);
      const transformedCss = postcss([
        deleteCssRulesPlugin({ selectorsToDelete: deadCssClasses })
      ]).process(originalSourceValue).css;
      replaceSource.replace(0, originalSourceValue.length - 1, transformedCss);
      compilation.assets[file] = replaceSource;
    });
  });
};

class SimplifyCSSModulesPlugin {
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    compiler.hooks.compilation.tap("SimplifyCSSModulesPlugin", compilation => {
      compilation.hooks.afterOptimizeChunkAssets.tap(
        "SimplifyCSSModulesPlugin",
        chunks => handleAfterOptimizeChunkAssets(chunks, compilation)
      );
    });
  }

  // TODO: consider making this dynamic at import or instantiation time
  magicPrefix = MAGIC_PREFIX;
}

module.exports = SimplifyCSSModulesPlugin;
