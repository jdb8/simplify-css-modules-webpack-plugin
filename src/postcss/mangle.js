const postcss = require("postcss");

module.exports = postcss.plugin("postcss-mangle-selectors", options => {
  const { idGenerator, cssClasses, requiredPrefix } = options;
  return root => {
    root.walkRules(rule => {
      rule.selectors = rule.selectors.map(selector => {
        if (!selector.startsWith("." + requiredPrefix)) {
          return selector;
        }

        const oldSelector = selector.replace(".", "");
        const newSelector = cssClasses[oldSelector] || idGenerator();
        cssClasses[oldSelector] = newSelector;
        return `.${newSelector}`;
      });
    });
  };
});
