const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const SimplifyCssModulesPlugin = require("../src");

module.exports = (pluginInstance = new SimplifyCssModulesPlugin()) => ({
  devtool: "source-map",
  mode: "production",
  module: {
    rules: [
      {
        test: /\.module.css$/i,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
            options: {
              esModule: true
            }
          },
          {
            loader: "css-loader",
            options: {
              esModule: true,
              sourceMap: true,
              modules: {
                // It's important to prefix your css-loader's localIdentName with
                // the plugin's "magic prefix" so that it's easier for the plugin
                // to identify css modules.
                localIdentName: `${SimplifyCssModulesPlugin.magicPrefix}[local]`
              }
            }
          }
        ]
      }
    ]
  },
  plugins: [pluginInstance, new MiniCssExtractPlugin()]
});
