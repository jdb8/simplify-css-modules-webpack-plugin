# simplify-css-modules-webpack-plugin

[![npm](https://badgen.net/npm/v/simplify-css-modules-webpack-plugin)](https://www.npmjs.com/package/simplify-css-modules-webpack-plugin) ![Build status](https://github.com/jdb8/simplify-css-modules-webpack-plugin/workflows/main/badge.svg)

⚠️ **Use with caution: this plugin is experimental!** ⚠️

## Installation

```bash
yarn add -D simplify-css-modules-webpack-plugin
```

## Usage

```js
// webpack.config.js
const SimplifyCssModulesPlugin = require("simplify-css-modules-webpack-plugin");

module.exports = {
  module: {
    rules: {
      test: /\.module.css$/i,
      use: [
        ...
        {
          loader: "css-loader",
          options: {
            esModule: true,
            modules: {
              // It's important to prefix your css-loader's localIdentName with
              // the plugin's "magic prefix" so that it's easier for the plugin
              // to identify css modules.
              localIdentName: `${SimplifyCssModulesPlugin.magicPrefix}[hash:base64]`
            }
          }
        }
      ]
    }
  },
  ...
  plugins: [new SimplifyCssModulesPlugin()]
};
```

**It's also strongly recommended to enable the `esModule: true` option on both `css-loader` and the `mini-css-extract-plugin` loader**. Doing so should produce smaller tree-shaken js and css bundles.

See the [config we generate in tests](testing/generate-config.js) for an example.

## Options

| Name                | Type      | Default   | Description                                                                                                                                                               |
|---------------------|-----------|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **mangle**          | `{Boolean}` | `true`      | Whether the plugin should mangle css module classnames to short alternatives (overrides your `localIdentName`)                                                            |
| **prune**           | `{Boolean}` | `true`      | Whether the plugin should remove unused css rules based on classes seen in your output js                                                                                 |
| **mappingFilePath** | `{String}`  | `undefined` | If set, stores a mapping of mangled classnames to the target location. Recommended when running multiple builds that need the same classnames (e.g. a separate SSR build) |

## Behaviour

The plugin will run on the js and css files produced by your build. It will run after assets have been optimised (i.e. after terser/other minifiers have run).

If it identifies CSS Modules, it will reduce the size of classnames via mangling and update the importing js file.

As a second step, any classnames that were not found referenced in the js files in the chunk will be purged from the css file.

## Why?

### Unique, short selectors

*Enabled by the `mangle` option!*

CSS Modules are great, but one problem they face is that it's possible to end up with the same rule in two different chunks depending on your `splitChunks` settings or use of dynamic imports.

If this happens, and the rule is loaded-in lazily (via a dynamic import), it can break styling of the page due to re-applying styles to any existing elements with that className, due to the way css specificity works (based on the rule order, not the html classname order).

### More aggressive tree-shaking

*Enabled by the `prune` option!*

It's tricky to fully tree-shake css modules without resorting to running a tool like PurgeCSS on your output files. The built-in options of `esModule` on both `css-loader` and the `mini-css-extract-plugin` loader provide some help, but leave behind unused rules in the extracted css files themselves.

Since we're iterating over the css module rules and finding connections between the js files that import from them, we can perform an additional pass using this information to remove unused rules that we otherwise wouldn't know about.

Under the hood, we use PurgeCSS, but directly pass it the list of classnames that we know we saw during the `mangle` pass. This way, we don't have to write a custom extractor and can be sure that only module classname rules will be removed.

## Known limitations

### css-loader / mini-css-extract-plugin inlining of class mappings

It's common for css-loader to export the entire mapping of classnames -> module class names into the js file importing them. If this happens, mangling will still take place but no classes will be pruned from the css file.

[This css-loader issue](https://github.com/webpack-contrib/css-loader/issues/1029) tracks a potential fix for some of these cases.

### Dynamic classname lookups

Any code that needs to look up the generated classname at runtime will run into the same problem as above: the bundle will include the entire mapping, which will signal to this plugin that every classname is "used". 

Where possible, avoid dynamic classname lookups. E.g.

```js
import styles from './styles.css';

// Avoid: entire classname mapping is required in the bundle
const myVar = Math.random() > 0.5 ? 'containerV1' : 'containerV2';
console.log(styles[myVar]);

// Prefer: styles can be inlined by terser, which removes the mapping and allows the classes
// to be pruned entirely from the css file by this plugin
const myStyle = Math.random() > 0.5 ? styles.containerV1 : styles.containerV2;
console.log(myStyle);
```

In both cases the mangling logic in the plugin will work, but the latter case will lead to smaller js and css bundles.
