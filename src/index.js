const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const validateOptions = require("schema-utils");
const postcss = require("postcss");
const purgecss = require("purgecss");
const incstr = require("incstr");
const { ReplaceSource } = require("webpack-sources");
const makeDir = require("make-dir");
const debug = require("debug")("simplify-css-modules-webpack-plugin");
const { createHash } = require("webpack").util;

const pluginVersion = require("../package.json").version;

const schema = require("./plugin-options.json");
const manglePlugin = require("./postcss/mangle");

const MAGIC_PREFIX = "__CSS_MODULE__";
const PLUGIN_NAME = "SimplifyCSSModulesPlugin";

const writeFilePromise = promisify(fs.writeFile);

function mangleAndTrackCSS(
  filePath,
  originalSourceValue,
  cssClasses,
  nextId,
  mangle
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
      disable: !mangle
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
    // Break the name with quotes to avoid over-eager matching
    // We expect to see the oldClassName value quoted inside a css mapping object
    const re = new RegExp(`(${oldClassName})["']`, "g");
    let match;
    while ((match = re.exec(originalSourceValue)) !== null) {
      replaceSource.replace(
        match.index,
        match.index + match[1].length - 1,
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

function getClassnameGenerator(chunkId) {
  const nextId = incstr.idGenerator({
    suffix: chunkId
  });

  return () => {
    // Classnames can't start with digits, so prefix
    // with an underscore if we encounter one
    let classname = nextId();
    if (classname.match(/^\d/)) {
      classname = `_${classname}`;
    }
    return classname;
  };
}

async function handleOptimizeAssets(
  assets,
  compilation,
  cssClasses,
  options,
  fileChunkIdMapping
) {
  const { mangle = true, prune = true } = options;
  const files = Object.keys(assets).filter(fileName => fileName !== "*");

  const filesByExt = { js: [], css: [] };
  files
    .filter(file => fileChunkIdMapping.has(file))
    .forEach(file => {
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
      const chunkId = fileChunkIdMapping.get(file);
      const nextId = getClassnameGenerator(chunkId);
      // Replace the entire source
      replaceSource.replace(
        0,
        originalSourceValue.length - 1,
        mangleAndTrackCSS(
          filePath,
          originalSourceValue,
          cssClasses,
          nextId,
          mangle
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

  if (prune) {
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
  constructor(options = {}) {
    validateOptions(schema, options, {
      name: PLUGIN_NAME
    });
    this.options = options;
  }

  getIdentifyingString() {
    return JSON.stringify({
      name: PLUGIN_NAME,
      version: pluginVersion,
      options: this.options
    });
  }

  apply(compiler) {
    const { mappingFilePath } = this.options;

    // We're going to be mutating the contents of this object to keep
    // track of the css classname mappings
    // If we've been passed a mapping file, use the pre-existing mappings
    let cssClasses = {};
    if (mappingFilePath && fs.existsSync(mappingFilePath)) {
      console.log(
        `[${PLUGIN_NAME}] Found existing classname mapping file at ${mappingFilePath} - reading from disk.`
      );
      cssClasses = JSON.parse(fs.readFileSync(mappingFilePath, "utf8"));
    }

    compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
      const fileChunkIdMapping = new Map();
      compilation.hooks.afterOptimizeChunkAssets.tap(PLUGIN_NAME, chunks => {
        // Set up a mapping to keep track of files -> chunk ids
        // TODO: consider moving the entire optimization work to be done in `optimizeChunkAssets`,
        // using { stage: <high number> } to guarantee we run after terser
        chunks.forEach(chunk => {
          chunk.files.forEach(file => {
            fileChunkIdMapping.set(file, chunk.id);
          });
        });
      });

      compilation.hooks.contentHash.tap(PLUGIN_NAME, chunk => {
        // Update any contenthashes used in css files
        // This is mostly stolen from https://github.com/webpack-contrib/mini-css-extract-plugin/blob/1ffc393a2e377fe0cc341cfcbc5396e07a8e4077/src/index.js#L222
        // TODO: work out if there's a less hacky way to guarantee content hashes get updated
        const { outputOptions } = compilation;
        const { hashFunction, hashDigest, hashDigestLength } = outputOptions;
        const hash = createHash(hashFunction);

        hash.update(chunk.contentHash["css/mini-extract"] || "");
        hash.update(this.getIdentifyingString());
        chunk.contentHash["css/mini-extract"] = hash
          .digest(hashDigest)
          .substring(0, hashDigestLength);
      });

      // Regenerate `contenthash` for minified assets, since webpack 4 does not
      // wait for minification before calculating the contenthash
      // Mostly stolen from terser's workaround: https://github.com/webpack-contrib/terser-webpack-plugin/pull/44
      // TODO: update this if a less hacky solution presents itself
      const { mainTemplate, chunkTemplate } = compilation;
      for (const template of [mainTemplate, chunkTemplate]) {
        template.hooks.hashForChunk.tap(PLUGIN_NAME, (hash, chunk) => {
          hash.update(this.getIdentifyingString());
        });
      }

      compilation.hooks.optimizeAssets.tapPromise(PLUGIN_NAME, assets =>
        handleOptimizeAssets(
          assets,
          compilation,
          cssClasses,
          this.options,
          fileChunkIdMapping
        )
      );
    });

    if (mappingFilePath) {
      compiler.hooks.emit.tapPromise(PLUGIN_NAME, async compiler => {
        console.log(
          `[${PLUGIN_NAME}] Writing css classname mappings to ${mappingFilePath}.`
        );
        const jsonClassNameMapping = JSON.stringify(cssClasses);
        await makeDir(path.dirname(mappingFilePath));
        return writeFilePromise(mappingFilePath, jsonClassNameMapping);
      });
    }
  }
}

// TODO: consider making this dynamic at import or instantiation time
SimplifyCSSModulesPlugin.magicPrefix = MAGIC_PREFIX;

module.exports = SimplifyCSSModulesPlugin;
