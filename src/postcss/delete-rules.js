const postcss = require("postcss");

module.exports = postcss.plugin("postcss-delete-rules", options => {
  const { selectorsToDelete } = options;
  return root => {
    root.walkRules(rule => {
      // Get a list of the selectors we want to keep
      const newSelectors = rule.selectors.filter(
        selector => !selectorsToDelete.has(selector)
      );

      // Remove the rule entirely if there are no
      // remaining selectors
      if (newSelectors.length === 0) {
        rule.remove();
        return;
      }

      rule.selectors = newSelectors;
    });
  };
});
