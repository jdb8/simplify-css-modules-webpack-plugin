const postcss = require("postcss");

module.exports = postcss.plugin("postcss-delete-rules", options => {
  const { selectorsToDelete } = options;
  return root => {
    root.walkRules(rule => {
      const newSelectors = rule.selectors.filter(
        selector => !selectorsToDelete.has(selector)
      );
      if (newSelectors.length === 0) {
        rule.remove();
        return;
      }

      rule.selectors = newSelectors;
    });
  };
});
