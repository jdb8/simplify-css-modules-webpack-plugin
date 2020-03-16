const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const SimplifyCssModulesPlugin = require("../src");

module.exports = {
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
              modules: {
                // It's important to prefix your css-loader's localIdentName with
                // the plugin's "magic prefix" so that it's easier for the plugin
                // to identify css modules.
                // localIdentName: `${SimplifyCssModulesPlugin.magicPrefix}[hash:base64]`
                localIdentName: `${SimplifyCssModulesPlugin.magicPrefix}[local]`
              }
            }
          }
        ]
      }
    ]
  },
  plugins: [new SimplifyCssModulesPlugin(), new MiniCssExtractPlugin()]
};
