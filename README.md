# simplify-css-modules-webpack-plugin

⚠️ Super alpha initial exploration, probably full of bad ideas `‾\_(ツ)_/‾` ⚠️

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

See the [testing dir](testing) for an example.

## Behaviour

The plugin will run on the js and css files produced by your build. It will run after assets have been optimised (i.e. after terser/other minifiers have run).

If it identifies CSS Modules, it will reduce the size of classnames via mangling and update the importing js file.

As a second step, any classnames that were not found referenced in the js files in the chunk will be purged from the css file.

## Why?

### Unique, short selectors

CSS Modules are great, but one problem they face is that it's possible to end up with the same rule in two different chunks depending on your `splitChunks` settings or use of dynamic imports.

If this happens, and the rule is loaded-in lazily (via a dynamic import), it can break styling of the page due to re-applying styles to any existing elements with that className, due to the way css specificity works (based on the rule order, not the html classname order).

### More aggressive tree-shaking

It's tricky to fully tree-shake css modules without resorting to a tool like PurgeCSS. The built-in options of `esModule` on both `css-loader` and the `mini-css-extract-plugin` loader provide some help, but leave behind unused rules in the extracted css files themselves.

Since we're iterating over the css module rules and finding connections between the js files that import from them, we can perform an additional pass using this information to remove unused rules that we otherwise wouldn't know about.


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
