const postcss = require("postcss");
const selectorParser = require("postcss-selector-parser");

const transform = (selectorsToDelete, selectors) => {
  selectors.walkClasses(node => {
    // If any classes in any of these selectors are in the "to-be-deleted" set,
    // remove the entire selector rule. E.g., the following three selectors
    // have classnames of .foo, .lol, and .hello (and if we've identified)
    //
    // .foo[type="submit"], .lol:hover, .hello
    // ^-----------------^  ^--------^  ^----^
    //      selector           same       ya
    //
    // E.g. if 'foo' is in the deletion set, and our rule is
    // '.foo:hover > .bar, .baz', we would transform this into
    // '.baz' (the entire '.foo:hover > .bar' selector would be removed).
    if (selectorsToDelete.has(node.value)) {
      node.parent.remove();
    }
  });
};

module.exports = postcss.plugin("postcss-delete-rules", options => {
  const { selectorsToDelete } = options;
  const selectorTransformer = selectors =>
    transform(selectorsToDelete, selectors);
  return root => {
    root.walkRules(rule => {
      const transformedSelectors = selectorParser(
        selectorTransformer
      ).processSync(rule);

      // Remove the rule entirely if there are no
      // remaining selectors
      if (!transformedSelectors.length) {
        rule.remove();
        return;
      }

      rule.selector = transformedSelectors;
    });
  };
});
