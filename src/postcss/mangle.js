const postcss = require("postcss");

module.exports = postcss.plugin("postcss-mangle-selectors", options => {
  const { idGenerator, cssClasses, requiredPrefix } = options;
  return root => {
    root.walkRules(rule => {
      rule.selectors = rule.selectors.map(selector => {
        // If we don't see the required "magic prefix", we
        // know that this isn't a css module - just leave it alone
        if (!selector.startsWith("." + requiredPrefix)) {
          return selector;
        }

        // The selector itself includes the initial .
        const oldSelector = selector.replace(".", "");

        // We're dealing with a css module: but make sure that
        // if we've already processed this selector, we re-use
        // the name rather than making 2+ different ones
        const newSelector = cssClasses[oldSelector] || idGenerator();

        // Update the storage object we were passed in from our caller
        cssClasses[oldSelector] = newSelector;
        return `.${newSelector}`;
      });
    });
  };
});
